import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  addImagesToTileset, addTileset, createTileset, findTilesetRef,
  isImageCollection, nextFirstGid, removeTileFromTileset, tileLabel, tilesetUsage,
} from '../src/tilesets.js'
import { parseMapJson } from '../src/json/map-codec.js'
import { parseTilesetJson, serializeTilesetJson } from '../src/json/tileset-codec.js'
import { DEFAULT_HINTS } from '../src/json/common.js'
import { walkLayers } from '../src/model.js'

const mapPath = 'examples/sokoban/levels/01_story.tmj'
const tilesetPath = 'examples/sokoban/sokoban.tsj'
const loadMap = () => parseMapJson(readFileSync(mapPath, 'utf8')).map
const loadTileset = () => parseTilesetJson(readFileSync(tilesetPath, 'utf8'), tilesetPath).tileset

describe('attaching tilesets to a map', () => {
  it('places the next tileset past the last tile of the previous one', () => {
    const map = loadMap()
    map.tilesets[0]!.tileset = loadTileset()
    // sokoban.tsj holds 31 tiles starting at gid 1.
    expect(nextFirstGid(map)).toBe(32)

    const extra = createTileset({ name: 'extra', tilewidth: 128, tileheight: 128 })
    extra.tilecount = 4
    const ref = addTileset(map, mapPath, 'examples/sokoban/extra.tsj', extra)
    expect(ref.firstgid).toBe(32)
    expect(ref.source).toBe('../extra.tsj')
    expect(nextFirstGid(map)).toBe(36)
  })

  it('recognises a tileset the map already references', () => {
    const map = loadMap()
    expect(findTilesetRef(map, mapPath, tilesetPath)).toBeDefined()
    expect(findTilesetRef(map, mapPath, 'examples/sokoban/other.tsj')).toBeUndefined()
  })
})

describe('detaching a tileset', () => {
  it('counts the tiles that would break', () => {
    const map = loadMap()
    map.tilesets[0]!.tileset = loadTileset()
    const used = tilesetUsage(map, map.tilesets[0]!)
    // Every non-empty cell in the map points into this tileset.
    let placed = 0
    for (const layer of walkLayers(map.layers)) {
      if (layer.kind === 'tilelayer') layer.data.forEach(() => placed++)
    }
    expect(used).toBe(placed)
    expect(used).toBeGreaterThan(0)
  })

  it('reports zero for a tileset nothing places', () => {
    const map = loadMap()
    map.tilesets[0]!.tileset = loadTileset()
    const extra = createTileset({ name: 'extra', tilewidth: 128, tileheight: 128 })
    extra.tilecount = 4
    const ref = addTileset(map, mapPath, 'examples/sokoban/extra.tsj', extra)
    expect(tilesetUsage(map, ref)).toBe(0)
  })
})

describe('image-collection tilesets', () => {
  it('creates one that Tiled will read back as a collection', () => {
    const tileset = createTileset({ name: 'nowy', tilewidth: 64, tileheight: 64 })
    expect(isImageCollection(tileset)).toBe(true)
    const text = serializeTilesetJson(tileset, DEFAULT_HINTS)
    const reread = parseTilesetJson(text, 'a/b.tsj').tileset
    expect(reread.columns).toBe(0)
    expect(reread.name).toBe('nowy')
    expect(serializeTilesetJson(reread, DEFAULT_HINTS)).toBe(text)
  })

  it('adds images with paths relative to the tileset file', () => {
    const tileset = createTileset({ name: 'nowy', tilewidth: 64, tileheight: 64 })
    const added = addImagesToTileset(tileset, 'art/tiles.tsj', ['art/sprites/a.png', 'other/b.png'], () => ({
      width: 32,
      height: 48,
    }))
    expect(added.map((t) => t.image)).toEqual(['sprites/a.png', '../other/b.png'])
    expect(added[0]).toMatchObject({ id: 0, imagewidth: 32, imageheight: 48 })
    expect(tileset.tilecount).toBe(2)
  })

  it('skips images the tileset already holds', () => {
    const tileset = createTileset({ name: 'nowy', tilewidth: 64, tileheight: 64 })
    addImagesToTileset(tileset, 'art/tiles.tsj', ['art/a.png'])
    const again = addImagesToTileset(tileset, 'art/tiles.tsj', ['art/a.png', 'art/b.png'])
    expect(again).toHaveLength(1)
    expect(tileset.tiles).toHaveLength(2)
  })

  it('keeps tilecount at the high-water mark when a tile is removed', () => {
    const tileset = createTileset({ name: 'nowy', tilewidth: 64, tileheight: 64 })
    addImagesToTileset(tileset, 'a.tsj', ['x.png', 'y.png', 'z.png'])
    expect(tileset.tilecount).toBe(3)
    removeTileFromTileset(tileset, 1)
    // Shrinking the count would renumber tile 2 and repoint every map using it.
    expect(tileset.tilecount).toBe(3)
    expect(tileset.tiles.map((t) => t.id)).toEqual([0, 2])
  })

  it('labels tiles by their image file name', () => {
    const tileset = loadTileset()
    expect(tileLabel(tileset.tiles[0]!)).toBe('ground_green')
  })
})

describe('tile animations', () => {
  it('survives a save and reload in both formats', async () => {
    const { parseTilesetXml, serializeTilesetXml } = await import('../src/xml/tileset-codec.js')
    const tileset = createTileset({ name: 'anim', tilewidth: 32, tileheight: 32 })
    addImagesToTileset(tileset, 'a.tsj', ['x.png', 'y.png'])
    tileset.tiles[0]!.animation = [
      { tileid: 0, duration: 100 },
      { tileid: 1, duration: 250 },
    ]

    const frames = (t: { animation?: { tileid: number; duration: number }[] }) =>
      t.animation?.map((f) => ({ tileid: f.tileid, duration: f.duration }))
    const expected = [
      { tileid: 0, duration: 100 },
      { tileid: 1, duration: 250 },
    ]

    const json = parseTilesetJson(serializeTilesetJson(tileset, DEFAULT_HINTS), 'a.tsj').tileset
    expect(frames(json.tiles[0]!)).toEqual(expected)

    const xml = parseTilesetXml(serializeTilesetXml(tileset), 'a.tsx').tileset
    expect(frames(xml.tiles[0]!)).toEqual(expected)
  })

  it('drops an empty animation rather than writing an empty element', async () => {
    const tileset = createTileset({ name: 'anim', tilewidth: 32, tileheight: 32 })
    addImagesToTileset(tileset, 'a.tsj', ['x.png'])
    tileset.tiles[0]!.animation = []
    const text = serializeTilesetJson(tileset, DEFAULT_HINTS)
    expect(text).not.toContain('animation')
  })
})
