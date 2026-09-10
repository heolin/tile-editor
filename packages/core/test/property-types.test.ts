import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  PropertyTypeRegistry, checkProperty, defaultValueFor, flagsToValues,
  parsePropertyTypes, serializePropertyTypes, storageTypeOf, valuesToFlags,
} from '../src/property-types.js'
import { parseProjectJson, serializeProjectJson } from '../src/json/project-codec.js'
import type { Property } from '../src/model.js'

const FIXTURE = 'packages/core/test/fixtures/tmx/examples.tiled-project'

const prop = (over: Partial<Property>): Property => ({ name: 'p', type: 'string', value: '', ...over })

describe('reading Tiled custom types', () => {
  const project = parseProjectJson(readFileSync(FIXTURE, 'utf8'))
  const registry = new PropertyTypeRegistry(project.propertyTypes)

  it('reads both enums and classes', () => {
    expect(project.propertyTypes.length).toBeGreaterThanOrEqual(10)
    const direction = registry.get('Direction')
    expect(direction).toMatchObject({ kind: 'enum', storageType: 'string', valuesAsFlags: false })
    if (direction?.kind !== 'enum') throw new Error('oczekiwano enuma')
    expect(direction.values).toEqual(['Up', 'Right', 'Down', 'Left'])

    const fixture = registry.get('Fixture')
    expect(fixture?.kind).toBe('class')
    if (fixture?.kind !== 'class') throw new Error('oczekiwano klasy')
    expect(fixture.members.map((m) => m.name)).toContain('friction')
    expect(fixture.useAs).toEqual(['property', 'object', 'tile'])
  })

  it('honours useAs when offering types', () => {
    // Exit is declared for objects and tiles only.
    expect(registry.usableOn('object').some((t) => t.name === 'Exit')).toBe(true)
    expect(registry.usableOn('layer').some((t) => t.name === 'Exit')).toBe(false)
    // Enums are usable anywhere.
    expect(registry.usableOn('layer').some((t) => t.name === 'Direction')).toBe(true)
  })

  it('round-trips the project file without losing a type', () => {
    const once = serializeProjectJson(project)
    const again = parseProjectJson(once)
    expect(again.propertyTypes.map((t) => t.name).sort()).toEqual(project.propertyTypes.map((t) => t.name).sort())
    expect(serializeProjectJson(again)).toBe(once)
  })
})

describe('checking a value against its type', () => {
  const registry = new PropertyTypeRegistry(
    parsePropertyTypes([
      { id: 1, name: 'Colour', type: 'enum', storageType: 'string', values: ['red', 'green'], valuesAsFlags: false },
      { id: 2, name: 'Index', type: 'enum', storageType: 'int', values: ['a', 'b', 'c'], valuesAsFlags: false },
      { id: 3, name: 'Flags', type: 'enum', storageType: 'int', values: ['x', 'y'], valuesAsFlags: true },
      { id: 4, name: 'Enemy', type: 'class', members: [{ name: 'hp', type: 'int', value: 1 }], useAs: ['object'] },
    ]),
  )

  it('accepts a value the enum declares', () => {
    expect(checkProperty(prop({ propertytype: 'Colour', value: 'red' }), registry)).toBeUndefined()
  })

  it('rejects one it does not', () => {
    const problem = checkProperty(prop({ propertytype: 'Colour', value: 'purple' }), registry)
    expect(problem?.message).toContain('nie należy do typu')
    expect(problem?.message).toContain('red, green')
  })

  it('checks int-backed enums by index', () => {
    expect(checkProperty(prop({ propertytype: 'Index', type: 'int', value: 2 }), registry)).toBeUndefined()
    expect(checkProperty(prop({ propertytype: 'Index', type: 'int', value: 9 }), registry)?.message).toContain('poza zakresem')
  })

  it('checks flag enums against the bits that exist', () => {
    expect(checkProperty(prop({ propertytype: 'Flags', type: 'int', value: 3 }), registry)).toBeUndefined()
    expect(checkProperty(prop({ propertytype: 'Flags', type: 'int', value: 8 }), registry)?.message).toContain('bity spoza')
  })

  it('flags a class value carrying fields the class has no room for', () => {
    const ok = prop({ propertytype: 'Enemy', type: 'class', value: { hp: 5 } })
    expect(checkProperty(ok, registry)).toBeUndefined()
    const bad = prop({ propertytype: 'Enemy', type: 'class', value: { hp: 5, mana: 3 } })
    expect(checkProperty(bad, registry)?.message).toContain('mana')
  })

  it('reports a type the project never declared', () => {
    expect(checkProperty(prop({ propertytype: 'Ghost' }), registry)?.message).toContain('nieznany typ')
  })

  it('leaves untyped properties alone', () => {
    expect(checkProperty(prop({ value: 'cokolwiek' }), registry)).toBeUndefined()
  })
})

describe('flag enums', () => {
  const flags = parsePropertyTypes([
    { id: 1, name: 'F', type: 'enum', storageType: 'int', values: ['a', 'b', 'c'], valuesAsFlags: true },
  ])[0]!
  if (flags.kind !== 'enum') throw new Error('oczekiwano enuma')

  it('maps between a bitmask and its entries', () => {
    expect(flagsToValues(flags, 5)).toEqual(['a', 'c'])
    expect(valuesToFlags(flags, ['a', 'c'])).toBe(5)
    expect(valuesToFlags(flags, [])).toBe(0)
  })
})

describe('defaults', () => {
  const types = parsePropertyTypes([
    { id: 1, name: 'Colour', type: 'enum', storageType: 'string', values: ['red', 'green'], valuesAsFlags: false },
    { id: 2, name: 'Enemy', type: 'class', members: [{ name: 'hp', type: 'int', value: 100 }], useAs: ['object'] },
  ])

  it('starts an enum at its first value and a class at its member defaults', () => {
    expect(defaultValueFor(types[0]!)).toBe('red')
    expect(defaultValueFor(types[1]!)).toEqual({ hp: 100 })
  })

  it('knows which scalar type a property must declare', () => {
    expect(storageTypeOf(types[0]!)).toBe('string')
    expect(storageTypeOf(types[1]!)).toBe('class')
  })
})
