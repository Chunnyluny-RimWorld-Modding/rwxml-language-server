import { Element, Injectable, Node, NodeWithChildren, Range, Text } from '@rwxml/analyzer'
import { AsEnumerable } from 'linq-es2015'
import { allowedNodeEnvironmentFlags } from 'process'
import { injectable } from 'tsyringe'
import { CompletionItem, CompletionItemKind, InsertTextFormat, TextEdit } from 'vscode-languageserver'
import { CodeCompletion } from '.'
import { getMatchingText } from '../../data-structures/trie-ext'
import { Project } from '../../project'
import { RangeConverter } from '../../utils/rangeConverter'

/*
1. trie 알고리즘을 기반으로 함?
2. string 을 각 단어별로 쪼갬, 이 것을 node 라고 부르자.
3. 각 node 는 string 에서 index 를 가짐
4. char 기반의 node map 이 있음
5. 현재 검색중인 문자열 길이보다 ...??? 이게 맞나?

원하는 것은 skip 을 구현하는 것.
그러면, skip 할 수 있게 pointer 를 줘야하나?
*/

@injectable()
export class DefNameCompletion {
  constructor(private readonly rangeConverter: RangeConverter) {}

  complete(project: Project, selection: Node, offset: number): CompletionItem[] {
    if (!this.shouldSuggestDefNames(selection, offset)) {
      return []
    }

    const node = selection instanceof Injectable ? selection : selection.parent
    if (!(node instanceof Injectable)) {
      return []
    }

    const fieldType = node.fieldInfo?.fieldType
    const defType = fieldType?.getDefType()
    const range = node.contentRange ?? new Range(offset, offset)
    const editRange = this.rangeConverter.toLanguageServerRange(range, node.document.uri)

    if (!(fieldType && defType && editRange)) {
      return []
    }

    const defs = AsEnumerable(project.defManager.getDef(defType))
      .Select((def) => def.getDefName())
      .Where((defName) => !!defName)
      .ToArray() as string[]

    const completionTexts = getMatchingText(defs, node.content ?? '')

    return completionTexts.map(
      (label) =>
        ({
          label,
          kind: CompletionItemKind.Value,
          textEdit: TextEdit.replace(editRange, label),
        } as CompletionItem)
    )
  }

  /**
   * is selecting <tag>|</tag> or <tag>...|...</tag> ?
   */
  private shouldSuggestDefNames(node: Node, offset: number): node is Element | Text {
    if (node instanceof Element && node.openTagRange.end === offset) {
      // after > ?
      return true
    } else if (node instanceof Text && node.parent instanceof Element && node.parent.contentRange?.include(offset)) {
      return true
    } else {
      return false
    }
  }
}
