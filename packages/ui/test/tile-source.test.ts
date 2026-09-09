import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseMapXml, parseTilesetXml, resolveFrom } from '@tile-editor/core'
import { parseMapJson, parseTilesetJson } from '@tile-editor/core'
import { buildTileSourceIndex, tileObjectAnchor } from '../src/render/tile-source'

const asset = (p: string) => `/assets/${p}`

/**
 * An atlas tileset packs every tile into one image; a collection gives each its
 * own file. Getting the first case wrong renders the whole sheet in every cell,
 * which is exactly the bug this covers.
 */
describe('atlas tilesets', () => {
  const map = parseMapXml(readFileSync('packages/core/test/fixtures/tmx/desert.tmx', 'utf8')).map
  const tileset = parseTilesetXml(
    readFileSync('packages/core/test/fixtures/tmx/desert.tsx', 'utf8'),
    'packages/core/test/fixtures/tmx/desert.tsx',
  ).tileset

  it('slices a spaced atlas into per-tile rectangles', () => {
    map.tilesets[0]!.tileset = tileset
    const source = buildTileSourceIndex(map, asset)

    // tilewidth 32, spacing 1, margin 1, 8 columns.
    expect(source.frame(1)).toMatchObject({ sx: 1, sy: 1, sw: 32, sh: 32 })
    expect(source.frame(2)).toMatchObject({ sx: 34, sy: 1, sw: 32, sh: 32 })
    expect(source.frame(9)).toMatchObject({ sx: 1, sy: 34, sw: 32, sh: 32 })
    expect(source.frame(48)).toMatchObject({ sx: 1 + 7 * 33, sy: 1 + 5 * 33 })
  })

  it('reports the full image size so consumers can crop', () => {
    map.tilesets[0]!.tileset = tileset
    const frame = buildTileSourceIndex(map, asset).frame(1)!
    expect(frame.imageWidth).toBe(265)
    expect(frame.imageHeight).toBe(199)
    expect(frame.sw).toBeLessThan(frame.imageWidth)
  })

  it('loads every tile from a single image', () => {
    map.tilesets[0]!.tileset = tileset
    const source = buildTileSourceIndex(map, asset)
    expect(source.urls().length).toBe(1)
    expect(source.entries().length).toBe(48)
  })
})

describe('image-collection tilesets', () => {
  const map = parseMapJson(readFileSync('examples/sokoban/levels/01_story.tmj', 'utf8')).map
  const tileset = parseTilesetJson(
    readFileSync('examples/sokoban/sokoban.tsj', 'utf8'),
    'examples/sokoban/sokoban.tsj',
  ).tileset

  it('gives each tile its own whole image', () => {
    map.tilesets[0]!.tileset = tileset
    const source = buildTileSourceIndex(map, asset)
    const frame = source.frame(1)!
    expect(frame.sx).toBe(0)
    expect(frame.sy).toBe(0)
    expect(frame.sw).toBe(frame.imageWidth)
    expect(source.urls().length).toBe(31)
  })

  it('resolves tile images relative to the tileset, not the map', () => {
    map.tilesets[0]!.tileset = tileset
    const frame = buildTileSourceIndex(map, asset).frame(1)!
    expect(frame.url).toBe(asset(resolveFrom('examples/sokoban/sokoban.tsj', 'src/assets/art/ground/ground_green.png')))
  })
})

describe('tile object anchoring', () => {
  it('defaults to the bottom-left corner, as Tiled does', () => {
    expect(tileObjectAnchor(undefined)).toEqual({ ax: 0, ay: 1 })
  })

  it('honours objectalignment, which tilt-ball sets to center', () => {
    expect(tileObjectAnchor({ objectalignment: 'center' } as never)).toEqual({ ax: 0.5, ay: 0.5 })
    expect(tileObjectAnchor({ objectalignment: 'topleft' } as never)).toEqual({ ax: 0, ay: 0 })
  })
})
