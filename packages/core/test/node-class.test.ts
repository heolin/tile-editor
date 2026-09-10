import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  PropertyTypeRegistry, classFor, classMemberStates, parsePropertyTypes,
  propertiesOutsideClass, setClassMember,
} from '../src/property-types.js'
import { lintMap } from '../src/lint.js'
import { parseMapJson } from '../src/json/map-codec.js'
import type { Property } from '../src/model.js'

const registry = new PropertyTypeRegistry(
  parsePropertyTypes([
    { id: 1, name: 'Colour', type: 'enum', storageType: 'string', values: ['red', 'blue'], valuesAsFlags: false },
    {
      id: 2, name: 'Enemy', type: 'class', useAs: ['object', 'tile'],
      members: [
        { name: 'hp', type: 'int', value: 100 },
        { name: 'colour', type: 'string', propertyType: 'Colour', value: 'red' },
      ],
    },
    { id: 3, name: 'Level', type: 'class', useAs: ['map'], members: [{ name: 'par', type: 'int', value: 0 }] },
  ]),
)

describe('a class used as a node type', () => {
  it('resolves only where useAs allows it', () => {
    expect(classFor('Enemy', registry, 'object')?.name).toBe('Enemy')
    expect(classFor('Enemy', registry, 'map')).toBeUndefined()
    expect(classFor('Level', registry, 'map')?.name).toBe('Level')
    expect(classFor('Colour', registry, 'object')).toBeUndefined()
    expect(classFor(undefined, registry, 'object')).toBeUndefined()
  })

  it('fills members from the class, marking which ones the node overrides', () => {
    const type = classFor('Enemy', registry, 'object')!
    const declared: Property[] = [{ name: 'hp', type: 'int', value: 7 }]
    const states = classMemberStates(type, declared)
    expect(states.map((s) => [s.member.name, s.value, s.overridden])).toEqual([
      ['hp', 7, true],
      ['colour', 'red', false],
    ])
  })

  it('writes a member only when it differs from the class default', () => {
    const type = classFor('Enemy', registry, 'object')!
    const [hp, colour] = type.members

    let props: Property[] = []
    props = setClassMember(props, hp!, 7)
    expect(props).toEqual([{ name: 'hp', type: 'int', value: 7, propertytype: undefined }])

    // Back to the default: Tiled drops the property rather than writing it.
    props = setClassMember(props, hp!, 100)
    expect(props).toEqual([])

    props = setClassMember(props, colour!, 'blue')
    expect(props[0]).toMatchObject({ name: 'colour', propertytype: 'Colour', value: 'blue' })
  })

  it('keeps properties that are not part of the class visible separately', () => {
    const type = classFor('Enemy', registry, 'object')!
    const props: Property[] = [
      { name: 'hp', type: 'int', value: 7 },
      { name: 'notes', type: 'string', value: 'x' },
    ]
    expect(propertiesOutsideClass(props, type).map((p) => p.name)).toEqual(['notes'])
    expect(propertiesOutsideClass(props, undefined)).toHaveLength(2)
  })
})

describe('lint on node classes', () => {
  const target = () => ({
    path: 'examples/tilt-ball/levels/story-01.tmj',
    map: parseMapJson(readFileSync('examples/tilt-ball/levels/story-01.tmj', 'utf8')).map,
  })
  const classFindings = (t: ReturnType<typeof target>) =>
    lintMap(t, { registry }).filter((f) => f.rule === 'unknown-class')

  it('reports a class the project never declared', () => {
    const t = target()
    const layer = t.map.layers[0]!
    if (layer.kind !== 'objectgroup') throw new Error('oczekiwano warstwy obiektów')
    layer.objects[0]!.className = 'Widmo'
    const [finding] = classFindings(t)
    expect(finding?.severity).toBe('warning')
    expect(finding?.message).toContain('Widmo')
    expect(finding?.objectId).toBe(layer.objects[0]!.id)
  })

  it('reports a class used somewhere its useAs does not cover', () => {
    const t = target()
    t.map.className = 'Enemy'
    expect(classFindings(t)[0]?.message).toContain('useAs')
  })

  it('reports an enum used where a class belongs', () => {
    const t = target()
    t.map.className = 'Colour'
    expect(classFindings(t)[0]?.message).toContain('enumem')
  })

  it('says nothing when the class fits', () => {
    const t = target()
    t.map.className = 'Level'
    expect(classFindings(t)).toHaveLength(0)
  })
})
