import { describe, expect, it } from 'vitest'
import { globSync, readFileSync } from 'node:fs'
import { parseMapXml, serializeMapXml } from '../src/xml/map-codec.js'
import { parseTilesetXml, serializeTilesetXml } from '../src/xml/tileset-codec.js'
import { parseMapJson } from '../src/json/map-codec.js'
import { walkLayers } from '../src/model.js'

const tmx = globSync('packages/core/test/fixtures/tmx/*.tmx').sort()
const tsx = globSync('packages/core/test/fixtures/tmx/*.tsx').sort()

/** Compares the parts of the model a save has to reproduce. */
function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape)
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>
    if ('cells' in src && 'bounds' in src) return Array.from(src.cells as Uint32Array)
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(src).sort()) {
      // Formatting bookkeeping does not survive a format change, by design.
      if (key === 'keyOrder' || key === 'extra' || key === 'sourcePath') continue
      if (src[key] !== undefined) out[key] = shape(src[key])
    }
    return out
  }
  return value
}

describe('TMX codec against files Tiled wrote', () => {
  it('finds the fixtures', () => {
    expect(tmx.length).toBeGreaterThanOrEqual(5)
    expect(tsx.length).toBeGreaterThanOrEqual(1)
  })

  it('reads every fixture without losing tile data', () => {
    for (const path of tmx) {
      const { map } = parseMapXml(readFileSync(path, 'utf8'))
      expect(map.width, path).toBeGreaterThan(0)
      expect(map.height, path).toBeGreaterThan(0)
      const tileLayers = [...walkLayers(map.layers)].filter((l) => l.kind === 'tilelayer')
      for (const layer of tileLayers) {
        expect(layer.data.toArray().length, `${path} / ${layer.name}`).toBe(layer.width * layer.height)
      }
    }
  })

  it('decodes base64+zlib and csv to the same kind of data', () => {
    const desert = parseMapXml(readFileSync('packages/core/test/fixtures/tmx/desert.tmx', 'utf8')).map
    const ground = [...walkLayers(desert.layers)][0]!
    expect(ground.kind).toBe('tilelayer')
    if (ground.kind !== 'tilelayer') return
    expect(ground.encoding).toBe('base64')
    expect(ground.compression).toBe('zlib')
    // The desert map is solid ground: every cell is filled.
    expect(ground.data.toArray().every((gid) => gid !== 0)).toBe(true)
  })

  it('preserves transform flags carried in gids', () => {
    const hex = parseMapXml(readFileSync('packages/core/test/fixtures/tmx/test_hexagonal_tile_60x60x30.tmx', 'utf8')).map
    const layer = [...walkLayers(hex.layers)][0]!
    if (layer.kind !== 'tilelayer') throw new Error('oczekiwano warstwy kafli')
    const flagged = layer.data.toArray().filter((gid) => (gid & 0xe0000000) !== 0)
    expect(flagged.length).toBeGreaterThan(0)
  })

  it('is byte-stable: writing a parsed map twice gives identical bytes', () => {
    for (const path of tmx) {
      const first = parseMapXml(readFileSync(path, 'utf8'))
      const once = serializeMapXml(first.map)
      const twice = serializeMapXml(parseMapXml(once).map)
      expect(twice, `unstable output for ${path}`).toBe(once)
    }
  })

  it('loses nothing across a write and re-read', () => {
    for (const path of tmx) {
      const first = parseMapXml(readFileSync(path, 'utf8'))
      const second = parseMapXml(serializeMapXml(first.map))
      expect(shape(second.map), `model drift in ${path}`).toEqual(shape(first.map))
    }
  })

  it('round-trips external tilesets', () => {
    for (const path of tsx) {
      const first = parseTilesetXml(readFileSync(path, 'utf8'), path)
      const once = serializeTilesetXml(first.tileset)
      const second = parseTilesetXml(once, path)
      expect(shape(second.tileset), `model drift in ${path}`).toEqual(shape(first.tileset))
      expect(serializeTilesetXml(second.tileset), `unstable output for ${path}`).toBe(once)
    }
  })
})

describe('cross-format equivalence', () => {
  const maps = globSync('examples/*/levels/*.tmj').sort()

  it('carries the whole JSON corpus through XML without loss', () => {
    for (const path of maps) {
      const fromJson = parseMapJson(readFileSync(path, 'utf8')).map
      const throughXml = parseMapXml(serializeMapXml(fromJson)).map
      expect(shape(throughXml), `loss converting ${path} to TMX`).toEqual(shape(fromJson))
    }
  })
})
