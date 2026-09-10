import { describe, expect, it } from 'vitest'
import { globSync, readFileSync } from 'node:fs'
import { applyFix, coercePropertyValue, lintProject } from '../src/lint.js'
import { parseMapJson } from '../src/json/map-codec.js'
import { allObjects } from '../src/model.js'

const load = () =>
  globSync('examples/tilt-ball/levels/*.tmj')
    .sort()
    .map((path) => ({ path, map: parseMapJson(readFileSync(path, 'utf8')).map }))

const railIds = (targets: ReturnType<typeof load>) => {
  const types = new Map<string, number>()
  for (const { map } of targets) {
    for (const object of allObjects(map)) {
      for (const property of object.properties) {
        if (property.name === 'railId') types.set(property.type, (types.get(property.type) ?? 0) + 1)
      }
    }
  }
  return types
}

describe('repairing a property used with two types', () => {
  it('offers a repair for railId, aimed at the type that already wins', () => {
    const findings = lintProject(load()).filter((f) => f.rule === 'conflicting-property-type')
    const railId = findings.find((f) => f.message.includes('railId'))
    expect(railId?.fix).toMatchObject({
      kind: 'normalize-property-type',
      scope: 'object',
      property: 'railId',
      to: 'int',
      count: 18,
    })
  })

  it('converts the minority and leaves the majority alone', () => {
    const targets = load()
    expect(railIds(targets)).toEqual(new Map([['int', 56], ['string', 18]]))

    const fix = lintProject(targets).find((f) => f.message.includes('railId'))!.fix!
    const changed = targets.reduce((sum, target) => sum + applyFix(target.map, fix), 0)

    expect(changed).toBe(18)
    expect(railIds(targets)).toEqual(new Map([['int', 74]]))
  })

  it('keeps the value each property meant', () => {
    const targets = load()
    const before = new Map<string, unknown>()
    for (const { path, map } of targets) {
      for (const object of allObjects(map)) {
        for (const property of object.properties) {
          if (property.name === 'railId') before.set(`${path}#${object.id}`, Number(property.value))
        }
      }
    }
    const fix = lintProject(targets).find((f) => f.message.includes('railId'))!.fix!
    for (const target of targets) applyFix(target.map, fix)

    for (const { path, map } of targets) {
      for (const object of allObjects(map)) {
        for (const property of object.properties) {
          if (property.name !== 'railId') continue
          expect(property.value, `${path}#${object.id}`).toBe(before.get(`${path}#${object.id}`))
          expect(typeof property.value).toBe('number')
        }
      }
    }
  })

  it('leaves the finding satisfied afterwards', () => {
    const targets = load()
    const fix = lintProject(targets).find((f) => f.message.includes('railId'))!.fix!
    for (const target of targets) applyFix(target.map, fix)
    const after = lintProject(targets).filter((f) => f.rule === 'conflicting-property-type')
    expect(after.some((f) => f.message.includes('railId'))).toBe(false)
  })
})

describe('coercion refuses to destroy what it cannot read', () => {
  it('parses numbers out of text', () => {
    expect(coercePropertyValue('42', 'int')).toBe(42)
    expect(coercePropertyValue('3.5', 'float')).toBe(3.5)
    expect(coercePropertyValue('3.9', 'int')).toBe(3)
  })

  it('leaves text that is not a number as it was', () => {
    expect(coercePropertyValue('zielony', 'int')).toBe('zielony')
  })

  it('does not rewrite a property whose value it could not convert', () => {
    const targets = load()
    const object = allObjects(targets[0]!.map)[0]!
    object.properties.push({ name: 'railId', type: 'string', value: 'lewy' })
    const fix = { kind: 'normalize-property-type', scope: 'object', property: 'railId', to: 'int', count: 1 } as const
    applyFix(targets[0]!.map, fix)
    const survivor = object.properties.find((p) => p.name === 'railId' && p.value === 'lewy')
    expect(survivor?.type).toBe('string')
  })
})
