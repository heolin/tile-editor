import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createFromTemplate, createTileMap } from '../src/factory.js'
import { parseMapJson, serializeMapJson } from '../src/json/map-codec.js'
import { DEFAULT_HINTS } from '../src/json/common.js'
import { walkLayers } from '../src/model.js'

describe('creating a blank map', () => {
  const map = createTileMap({
    path: 'levels/new.tmj',
    width: 8,
    height: 6,
    tilewidth: 32,
    tileheight: 32,
    tilesets: [{ path: 'art/tiles.tsj', tilecount: 40 }],
    layers: [
      { name: 'kafle', kind: 'tilelayer' },
      { name: 'obiekty', kind: 'objectgroup' },
    ],
  })

  it('lays out the layers that were asked for', () => {
    const layers = [...walkLayers(map.layers)]
    expect(layers.map((l) => [l.name, l.kind])).toEqual([
      ['kafle', 'tilelayer'],
      ['obiekty', 'objectgroup'],
    ])
    expect(map.nextlayerid).toBe(3)
  })

  it('references tilesets relative to the new map, not the project root', () => {
    expect(map.tilesets).toEqual([{ firstgid: 1, source: '../art/tiles.tsj' }])
  })

  it('produces a file that reads back identically', () => {
    const text = serializeMapJson(map, DEFAULT_HINTS)
    const reread = parseMapJson(text).map
    expect(reread.width).toBe(8)
    expect(reread.height).toBe(6)
    expect([...walkLayers(reread.layers)].length).toBe(2)
    expect(serializeMapJson(reread, DEFAULT_HINTS)).toBe(text)
  })
})

describe('creating a map from a template', () => {
  const templatePath = 'examples/sokoban/levels/template.tmj'
  const template = parseMapJson(readFileSync(templatePath, 'utf8')).map

  it('keeps the structure and drops the content', () => {
    const map = createFromTemplate(template, { path: 'examples/sokoban/levels/new.tmj', templatePath })
    expect([...walkLayers(map.layers)].map((l) => l.name)).toEqual(['floor', 'goals', 'walls', 'things'])
    expect(map.properties.map((p) => p.name)).toEqual(template.properties.map((p) => p.name))
    for (const layer of walkLayers(map.layers)) {
      if (layer.kind === 'tilelayer') expect(layer.data.toArray().every((gid) => gid === 0)).toBe(true)
    }
  })

  it('leaves the template untouched', () => {
    const before = serializeMapJson(template, DEFAULT_HINTS)
    const map = createFromTemplate(template, { path: 'examples/sokoban/levels/new.tmj', templatePath, width: 3, height: 3 })
    map.layers[0]!.name = 'zmienione'
    expect(serializeMapJson(template, DEFAULT_HINTS)).toBe(before)
  })

  it('re-points tileset references at the new location', () => {
    const map = createFromTemplate(template, { path: 'examples/sokoban/new.tmj', templatePath })
    // The template sits in levels/ and points at ../sokoban.tsj; a map one
    // level up must point at it directly.
    expect(map.tilesets[0]!.source).toBe('sokoban.tsj')
  })

  it('can carry the content over when asked', () => {
    const source = parseMapJson(readFileSync('examples/sokoban/levels/01_story.tmj', 'utf8')).map
    const map = createFromTemplate(source, {
      path: 'examples/sokoban/levels/copy.tmj',
      templatePath: 'examples/sokoban/levels/01_story.tmj',
      keepContent: true,
    })
    const original = [...walkLayers(source.layers)].find((l) => l.kind === 'tilelayer')!
    const copied = [...walkLayers(map.layers)].find((l) => l.kind === 'tilelayer')!
    if (original.kind !== 'tilelayer' || copied.kind !== 'tilelayer') throw new Error('oczekiwano warstw kafli')
    expect(copied.data.toArray()).toEqual(original.data.toArray())
  })
})
