import { Def, DefDatabase, Document, Injectable, NameDatabase, parse, TypeInfoMap } from '@rwxml/analyzer'
import { EventEmitter } from 'events'
import { either } from 'fp-ts'
import _ from 'lodash'
import * as ono from 'ono'
import { serializeError } from 'serialize-error'
import { inject, Lifecycle, scoped } from 'tsyringe'
import TypedEventEmitter from 'typed-emitter'
import { v4 as uuid } from 'uuid'
import { CancellationToken, CancellationTokenSource } from 'vscode-languageserver'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import * as winston from 'winston'
import { DefManager } from './defManager'
import * as documentWithNodeMap from './documentWithNodeMap'
import defaultLogger, { className, logFormat } from './log'
import { About } from './mod'
import { ResourceStore } from './resourceStore'
import { RimWorldVersion, RimWorldVersionToken } from './RimWorldVersion'
import { TextDocumentManager } from './textDocumentManager'
import { TypeInfoMapProvider } from './typeInfoMapProvider'
import jsonStr from './utils/json'

type Events = {
  /**
   * defChanged event emitted when document is changed
   * @param updatedDocument the document that updated
   * @param dirtyNodes project-wide dirty node due to the document update
   */
  defChanged(updatedDocument: Document, dirtyNodes: (Injectable | Def)[]): void

  /**
   * @example listen this event to remove any diagnostics.
   */
  xmlDeleted(uri: string): void

  projectReloaded(): void
}

// TODO: impl disposable() for ContainerScoped classes.
@scoped(Lifecycle.ContainerScoped)
export class Project {
  private log = winston.createLogger({
    format: winston.format.combine(className(Project), logFormat),
    transports: [defaultLogger()],
  })

  private xmls: Map<string, Document> = new Map()
  public defManager: DefManager

  public readonly event = new EventEmitter() as TypedEventEmitter<Events>

  private reloadDebounceTimeout = 3000 // ms
  private cancelTokenSource = new CancellationTokenSource()

  private _state: 'ready' | 'reloading' | 'invalid' = 'invalid'
  get state(): 'ready' | 'reloading' | 'invalid' {
    return this._state
  }

  constructor(
    public readonly about: About,
    @inject(RimWorldVersionToken) public readonly version: RimWorldVersion,
    public readonly resourceStore: ResourceStore,
    private readonly typeInfoMapProvider: TypeInfoMapProvider,
    private readonly textDocumentManager: TextDocumentManager
  ) {
    this.defManager = new DefManager(new DefDatabase(), new NameDatabase(), new TypeInfoMap(), this.version)

    resourceStore.event.on('xmlChanged', this.onXMLChanged.bind(this))
    resourceStore.event.on('xmlDeleted', this.onXMLDeleted.bind(this))
    resourceStore.event.on('dllChanged', () => this.reloadProject('dll is changed.'))
    resourceStore.event.on('dllDeleted', () => this.reloadProject('dll is deleted.'))

    this.reloadProject('project initialize')
  }

  getXMLDocumentByUri(uri: string | URI): Document | undefined {
    if (uri instanceof URI) {
      uri = uri.toString()
    }

    return this.xmls.get(uri)
  }

  async getTextDocumentByUri(uri: string | URI): Promise<TextDocument | undefined> {
    if (uri instanceof URI) {
      uri = uri.toString()
    }

    if (!this.textDocumentManager.has(uri)) {
      return
    }

    const res = await this.textDocumentManager.get(uri)
    if (either.isLeft(res)) {
      this.log.error(`failed retrieving textDocument. err: ${res.left}`)
      return
    }

    return res.right
  }

  getXMLDocuments(): Document[] {
    return [...this.xmls.values()]
  }

  /**
   * reloadProject reset project and evaluate all xmls
   * uses debounce to limit reloading too often
   */
  private reloadProject = _.debounce(async (reason = '') => {
    const requestId = uuid()
    if (this.state === 'reloading') {
      this.reloadProject(reason)
      return
    }

    this.log.info(`reloading project... reason: ${reason}`, { id: requestId })
    this._state = 'reloading'

    this.cancelTokenSource.cancel()
    const cancelTokenSource = new CancellationTokenSource()
    this.cancelTokenSource = cancelTokenSource
    const cancelToken = this.cancelTokenSource.token

    this.log.info(`loading project resources...`, { id: requestId })
    this.resourceStore.reload('project reload')

    this.log.info(`clear project...`, { id: requestId })
    const err = await this.reset(requestId, cancelToken)

    if (cancelToken.isCancellationRequested) {
      this.log.info(`project evluation canceled.`, { id: requestId })
      cancelTokenSource.dispose()
      return
    }

    if (err) {
      this.log.error(`failed reset project. err: ${err}`)
    } else {
      this.log.info(`project cleared.`, { id: requestId })
      this.evaluteProject()
      this._state = 'ready'
      this.event.emit('projectReloaded')
      this.log.info(`project evaluated.`, { id: requestId })
    }

    cancelTokenSource.dispose()
    if (global.gc) {
      this.log.debug('trigger gc (project reloaded)')
      global.gc()
    }
  }, this.reloadDebounceTimeout)

  /**
   * reset project to initial state
   */
  private async reset(requestId: string = uuid(), cancelToken?: CancellationToken): Promise<ono.ErrorLike | null> {
    this.log.debug(
      // TODO: put uuid as log format
      `current project file dll count: ${this.resourceStore.dllFiles.size}`,
      { id: requestId }
    )
    this.log.silly(
      `dll files: ${jsonStr([...this.resourceStore.dllFiles].map((uri) => decodeURIComponent(uri.toString())))}`
    )

    const [typeInfoMap, err0] = await this.getTypeInfo(requestId)
    if (cancelToken?.isCancellationRequested) {
      return ono.ono(`[${requestId}] request canceled.`)
    }

    if (err0) {
      return ono.ono(`[${requestId}] failed fetching typeInfoMap. error: ${jsonStr(serializeError(err0))}`)
    }

    this.xmls = new Map()
    this.defManager = new DefManager(new DefDatabase(), new NameDatabase(), typeInfoMap, this.version)

    return null
  }

  async getTypeInfo(requestId: string = uuid()): Promise<[TypeInfoMap, Error | null]> {
    return this.typeInfoMapProvider.get(requestId)
  }

  /**
   * evaluteProject performs parsing on all document on resourceStore
   */
  private evaluteProject(): void {
    for (const [uri, raw] of this.resourceStore.xmls) {
      this.parseXML(uri, raw)
    }
  }

  private async onXMLChanged(uri: string): Promise<void> {
    const xml = this.resourceStore.xmls.get(uri)
    if (!xml) {
      this.log.warn(`file ${uri} is changed but xml not exists on resourceStore`)
      return
    }

    this.parseXML(uri, xml)
  }

  private async onXMLDeleted(uri: string): Promise<void> {
    this.parseXML(uri, '')
    this.xmls.delete(uri)

    this.event.emit('xmlDeleted', uri)
  }

  /**
   * parse XML and register/update/delete defs to project
   * @param uri uri of the file of the xml
   * @param raw xml string, must be parsable
   */
  private parseXML(uri: string, raw: string): void {
    const document = documentWithNodeMap.create(parse(raw, uri))

    this.xmls.set(uri, document)

    const dirtyDefs = this.defManager.update(document)
    if (this.state === 'ready') {
      this.event.emit('defChanged', document, dirtyDefs)
    }
  }
}
