import { Element, parse } from '../../parser'
import $ from 'cheerio'
import { TypedElement, RawTypeInfo, TypeInfoInjector, TypeInfoLoader } from '../../rimworld-types'
import core from './anty.json'

$._options.xmlMode = true

const exampleXML = `\
<?xml version="1.0" encoding="utf-8" ?>
<Defs>

  <BodyDef>
    <defName>Snake</defName>
    <label>snake</label>
    <corePart>
      <def>SnakeBody</def>
      <height>Middle</height>
      <depth>Outside</depth>
      <parts>
        <li>
          <def>Stomach</def>
          <coverage>0.05</coverage>
          <depth>Inside</depth>
        </li>
        <li>
          <def>Heart</def>
          <coverage>0.03</coverage>
          <depth>Inside</depth>
        </li>
        <li>
          <def>Lung</def>
          <customLabel>left lung</customLabel>
          <coverage>0.03</coverage>
          <depth>Inside</depth>
        </li>
        <li>
          <def>Lung</def>
          <customLabel>right lung</customLabel>
          <coverage>0.03</coverage>
          <depth>Inside</depth>
        </li>
        <li>
          <def>Kidney</def>
          <customLabel>left kidney</customLabel>
          <coverage>0.03</coverage>
          <depth>Inside</depth>
        </li>
        <li>
          <def>Kidney</def>
          <customLabel>right kidney</customLabel>
          <coverage>0.03</coverage>
          <depth>Inside</depth>
        </li>
        <li>
          <def>Liver</def>
          <coverage>0.05</coverage>
          <depth>Inside</depth>
        </li>
        <li>
          <def>SnakeHead</def>
          <coverage>0.20</coverage>
          <groups>
            <li>HeadAttackTool</li>
          </groups>
          <parts>
            <li>
              <def>Skull</def>
              <coverage>0.30</coverage>
              <depth>Inside</depth>
              <parts>
                <li>
                  <def>Brain</def>
                  <coverage>0.50</coverage>
                  <depth>Inside</depth>
                </li>
              </parts>
            </li>
            <li>
              <def>Eye</def>
              <customLabel>left eye</customLabel>
              <coverage>0.10</coverage>
            </li>
            <li>
              <def>Eye</def>
              <customLabel>right eye</customLabel>
              <coverage>0.10</coverage>
            </li>
            <li>
              <def>Nose</def>
              <coverage>0.15</coverage>
            </li>
            <li>
              <def>SnakeMouth</def>
              <coverage>0.15</coverage>
              <groups>
                <li>Mouth</li>
              </groups>
            </li>
          </parts>
        </li>
      </parts>
    </corePart>
  </BodyDef>

</Defs>\
`

describe('TypeInfo injection test against BodyDef', () => {
  test('BodyDef.corePart.def', () => {
    const root = parse(exampleXML)

    const defName = $(root).find('Defs > BodyDef > defName').get(0)
    expect(defName).toBeInstanceOf(Element)

    const map = TypeInfoLoader.load(core as RawTypeInfo[])
    const injector = new TypeInfoInjector(map)

    injector.inject(root)

    const injectable = $(root).find('Defs > BodyDef > corePart > def').get(0)
    expect(injectable).toBeInstanceOf(TypedElement)
  })
})
