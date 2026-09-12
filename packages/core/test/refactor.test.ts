import { describe, expect, it } from 'vitest'
import { createTileMap } from '../src/factory.js'
import { indexProperties } from '../src/lint.js'
import {
  applyInMap, applyInTileset, coerceValue, countInMap, countInTileset, isEmptyChange,
} from '../src/refactor.js'
import type { ObjectLayer, Property, TileMap, Tileset } from '../src/model.js'

const prop = (name: string, type: Property['type'], value: unknown): Property => ({ name, type, value })

function mapWith(objectProperties: Property[][]): TileMap {
  const map = createTileMap({
    width: 4, height: 4, tilewidth: 16, tileheight: 16,
    path: 'a.tmj', layers: [{ name: 'obiekty', kind: 'objectgroup' }],
  })
  const layer = map.layers[0] as ObjectLayer
  layer.objects = objectProperties.map((properties, i) => ({
    id: i + 1, name: '', className: '', x: 0, y: 0, width: 16, height: 16,
    rotation: 0, visible: true, shape: 'rectangle', properties,
  }))
  return map
}

function tilesetWith(tileProperties: Property[][]): Tileset {
  return {
    name: 'kafle', tilewidth: 16, tileheight: 16, tilecount: tileProperties.length,
    columns: 0, margin: 0, spacing: 0, properties: [],
    tiles: tileProperties.map((properties, id) => ({ id, properties })),
  } as unknown as Tileset
}

describe('renaming a property across a project', () => {
  it('counts before it touches anything', () => {
    const map = mapWith([[prop('railId', 'int', 1)], [prop('railId', 'int', 2)], [prop('kind', 'string', 'a')]])
    const change = { scope: 'object' as const, name: 'railId', rename: 'rail_id' }
    expect(countInMap(map, change)).toBe(2)
    // Counting is a dry run: the map is untouched by it.
    expect(map.layers.flatMap((l) => (l as ObjectLayer).objects.flatMap((o) => o.properties.map((p) => p.name))))
      .toEqual(['railId', 'railId', 'kind'])
  })

  it('renames every occurrence and leaves the rest alone', () => {
    const map = mapWith([[prop('railId', 'int', 1), prop('kind', 'string', 'a')], [prop('railId', 'int', 2)]])
    expect(applyInMap(map, { scope: 'object', name: 'railId', rename: 'rail_id' })).toBe(2)
    const names = (map.layers[0] as ObjectLayer).objects.map((o) => o.properties.map((p) => p.name))
    expect(names).toEqual([['rail_id', 'kind'], ['rail_id']])
  })

  it('touches only the scope it was given', () => {
    const map = mapWith([[prop('title', 'string', 'x')]])
    map.properties.push(prop('title', 'string', 'poziom'))
    expect(applyInMap(map, { scope: 'map', name: 'title', rename: 'name' })).toBe(1)
    expect(map.properties[0]!.name).toBe('name')
    expect((map.layers[0] as ObjectLayer).objects[0]!.properties[0]!.name).toBe('title')
  })

  it('reaches tile properties, which live in the tileset rather than the map', () => {
    const tileset = tilesetWith([[prop('kind', 'string', 'wall')], [prop('kind', 'string', 'floor')], []])
    const change = { scope: 'tile' as const, name: 'kind', rename: 'rodzaj' }
    expect(countInTileset(tileset, change)).toBe(2)
    expect(applyInTileset(tileset, change)).toBe(2)
    expect(tileset.tiles.map((t) => t.properties.map((p) => p.name))).toEqual([['rodzaj'], ['rodzaj'], []])
  })

  it('removes a property everywhere when asked', () => {
    const map = mapWith([[prop('debug', 'bool', true), prop('kind', 'string', 'a')], [prop('debug', 'bool', false)]])
    expect(applyInMap(map, { scope: 'object', name: 'debug', remove: true })).toBe(2)
    expect((map.layers[0] as ObjectLayer).objects.map((o) => o.properties.length)).toEqual([1, 0])
  })

  it('retypes values instead of reinterpreting them', () => {
    const map = mapWith([[prop('railId', 'string', '3')], [prop('railId', 'string', 'nie liczba')]])
    expect(applyInMap(map, { scope: 'object', name: 'railId', retype: 'int' })).toBe(2)
    const values = (map.layers[0] as ObjectLayer).objects.map((o) => o.properties[0]!)
    expect(values[0]).toMatchObject({ type: 'int', value: 3 })
    // Not a number: the empty value, so the mistake stays visible.
    expect(values[1]).toMatchObject({ type: 'int', value: 0 })
  })

  it('drops a declared type when the storage type changes under it', () => {
    const map = mapWith([[{ name: 'mode', type: 'string', value: 'coop', propertytype: 'Mode' }]])
    applyInMap(map, { scope: 'object', name: 'mode', retype: 'int' })
    expect((map.layers[0] as ObjectLayer).objects[0]!.properties[0]!.propertytype).toBeUndefined()
  })

  it('knows when it would do nothing', () => {
    expect(isEmptyChange({ scope: 'object', name: 'a' })).toBe(true)
    expect(isEmptyChange({ scope: 'object', name: 'a', rename: 'a' })).toBe(true)
    expect(isEmptyChange({ scope: 'object', name: 'a', rename: '' })).toBe(true)
    expect(isEmptyChange({ scope: 'object', name: 'a', rename: 'b' })).toBe(false)
    expect(isEmptyChange({ scope: 'object', name: 'a', remove: true })).toBe(false)
    expect(isEmptyChange({ scope: 'object', name: 'a', retype: 'int' })).toBe(false)
  })
})

describe('coercion', () => {
  it('keeps what converts and empties what does not', () => {
    expect(coerceValue('42', 'int')).toBe(42)
    expect(coerceValue('4.5', 'float')).toBe(4.5)
    expect(coerceValue('tak', 'int')).toBe(0)
    expect(coerceValue('true', 'bool')).toBe(true)
    expect(coerceValue('0', 'bool')).toBe(false)
    expect(coerceValue('#ff00aa', 'color')).toBe('#ff00aa')
    expect(coerceValue('czerwony', 'color')).toBe('')
    expect(coerceValue(7, 'string')).toBe('7')
  })
})

describe('the property index', () => {
  it('now counts tile properties, which are a third of the corpus', () => {
    const map = mapWith([[prop('railId', 'int', 1)]])
    const tileset = tilesetWith([[prop('kind', 'string', 'wall')], [prop('kind', 'string', 'floor')]])
    const index = indexProperties([{ path: 'a.tmj', map }], [tileset])
    expect(index.find((e) => e.scope === 'tile' && e.name === 'kind')).toMatchObject({ count: 2, type: 'string' })
    expect(index.find((e) => e.scope === 'object' && e.name === 'railId')).toMatchObject({ count: 1 })
  })
})
