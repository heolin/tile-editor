import { describe, expect, it } from 'vitest'
import { globSync, readFileSync } from 'node:fs'
import { lintMap, suggestEnums } from '../src/lint.js'
import { parseMapJson } from '../src/json/map-codec.js'
import { PropertyTypeRegistry, parsePropertyTypes } from '../src/property-types.js'

const load = (pattern: string) =>
  globSync(pattern)
    .sort()
    .map((path) => ({ path, map: parseMapJson(readFileSync(path, 'utf8')).map }))

describe('proposing enums from how a project already uses properties', () => {
  it('spots the closed sets in tilt-ball', () => {
    const suggestions = suggestEnums(load('examples/tilt-ball/levels/*.tmj'))
    const byName = new Map(suggestions.map((s) => [`${s.scope}.${s.property}`, s]))

    // Every level declares a mode, and there are exactly two of them.
    expect(byName.get('map.mode')?.values).toEqual(['story', 'versus'])
    // Lasers come in three colours across the whole project.
    expect(byName.get('object.laserColour')?.values).toEqual(['blue', 'green', 'yellow'])
  })

  it('spots them in sokoban too', () => {
    const suggestions = suggestEnums(load('examples/sokoban/levels/*.tmj'))
    const mode = suggestions.find((s) => s.property === 'mode')
    expect(mode?.values).toEqual(['coop', 'story'])
    expect(mode?.occurrences).toBeGreaterThan(70)
  })

  it('leaves free-form text alone', () => {
    const suggestions = suggestEnums(load('examples/sokoban/levels/*.tmj'))
    // Every level has its own title and its own solution string.
    expect(suggestions.some((s) => s.property === 'title')).toBe(false)
    expect(suggestions.some((s) => s.property === 'solution')).toBe(false)
  })
})

describe('checking properties against declared types', () => {
  const registry = new PropertyTypeRegistry(
    parsePropertyTypes([
      { id: 1, name: 'Mode', type: 'enum', storageType: 'string', values: ['story', 'versus'], valuesAsFlags: false },
    ]),
  )

  it('says nothing when the value fits', () => {
    const [target] = load('examples/tilt-ball/levels/story-01.tmj')
    const mode = target!.map.properties.find((p) => p.name === 'mode')!
    mode.propertytype = 'Mode'
    expect(lintMap(target!, { registry }).filter((f) => f.rule === 'property-type-mismatch')).toHaveLength(0)
  })

  it('reports the map and the property when it does not', () => {
    const [target] = load('examples/tilt-ball/levels/story-01.tmj')
    const mode = target!.map.properties.find((p) => p.name === 'mode')!
    mode.propertytype = 'Mode'
    mode.value = 'kooperacja'
    const [finding] = lintMap(target!, { registry }).filter((f) => f.rule === 'property-type-mismatch')
    expect(finding?.severity).toBe('error')
    expect(finding?.message).toContain('mode')
    expect(finding?.message).toContain('story, versus')
    expect(finding?.mapPath).toContain('story-01')
  })

  it('stays quiet when the project declares no types at all', () => {
    const [target] = load('examples/tilt-ball/levels/story-01.tmj')
    expect(lintMap(target!, { registry: new PropertyTypeRegistry([]) })).toHaveLength(0)
  })
})

describe('what the proposals deliberately skip', () => {
  const load = (pattern: string) =>
    globSync(pattern).sort().map((path) => ({ path, map: parseMapJson(readFileSync(path, 'utf8')).map }))

  it('does not propose an enum for numbers written as text', () => {
    // 18 objects in tilt-ball carry railId as a string and 56 as an int. Those
    // 18 form a tidy closed set, but naming it would freeze the bug in place.
    const suggestions = suggestEnums(load('examples/tilt-ball/levels/*.tmj'))
    expect(suggestions.some((s) => s.property === 'railId')).toBe(false)
  })

  it('still proposes the genuine sets in the same project', () => {
    const names = suggestEnums(load('examples/tilt-ball/levels/*.tmj')).map((s) => s.property)
    expect(names).toContain('mode')
    expect(names).toContain('laserColour')
    expect(names).toContain('edges')
  })
})
