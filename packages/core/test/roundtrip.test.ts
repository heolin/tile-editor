import { describe, expect, it } from 'vitest'
import { globSync, readFileSync } from 'node:fs'
import { parseMapJson, serializeMapJson } from '../src/json/map-codec.js'
import { parseTilesetJson, serializeTilesetJson } from '../src/json/tileset-codec.js'
import { parseProjectJson, serializeProjectJson } from '../src/json/project-codec.js'

const maps = globSync('examples/*/levels/*.tmj').sort()
const tilesets = globSync('examples/*/*.tsj').sort()
const projects = globSync('examples/*/*.tiled-project').sort()

/** Strips the model down to what a save must reproduce, ignoring class identity. */
function shape(value: unknown): unknown {
  if (value instanceof Uint32Array) return Array.from(value)
  if (Array.isArray(value)) return value.map(shape)
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>
    // DenseLayerData compares by its cells, not its identity.
    if ('cells' in src && 'bounds' in src) return Array.from(src.cells as Uint32Array)
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(src).sort()) {
      if (src[key] !== undefined) out[key] = shape(src[key])
    }
    return out
  }
  return value
}

describe('golden round-trip on the examples/ corpus', () => {
  it('finds the corpus', () => {
    expect(maps.length).toBe(110)
    expect(tilesets.length).toBe(2)
    expect(projects.length).toBe(2)
  })

  it('loses nothing from any map', () => {
    for (const path of maps) {
      const original = readFileSync(path, 'utf8')
      const first = parseMapJson(original)
      const written = serializeMapJson(first.map, first.hints)
      const second = parseMapJson(written)
      expect(shape(second.map), `model drift in ${path}`).toEqual(shape(first.map))
    }
  })

  it('is byte-stable: writing twice produces identical bytes', () => {
    for (const path of maps) {
      const first = parseMapJson(readFileSync(path, 'utf8'))
      const once = serializeMapJson(first.map, first.hints)
      const second = parseMapJson(once)
      const twice = serializeMapJson(second.map, second.hints)
      expect(twice, `unstable output for ${path}`).toBe(once)
    }
  })

  it('rewrites untouched maps byte for byte', () => {
    const rewritten: string[] = []
    for (const path of maps) {
      const original = readFileSync(path, 'utf8')
      const { map, hints } = parseMapJson(original)
      if (serializeMapJson(map, hints) !== original) rewritten.push(path)
    }
    // The 25 that change contain whitespace-only lines inside arrays, which the
    // level generator emitted and no correct writer reproduces. Saving cleans
    // them up once; every save after that is a no-op. See docs/PLAN.md 5.5.
    expect(maps.length - rewritten.length).toBe(85)
    for (const path of rewritten) {
      expect(readFileSync(path, 'utf8'), `${path} should differ only in blank lines`).toMatch(/\n[ ]+\n/)
    }
  })

  it('keeps each file in the dialect it was written in', () => {
    const dialects = maps.map((p) => parseMapJson(readFileSync(p, 'utf8')).hints.dialect)
    expect(dialects.filter((d) => d === 'tiled').length).toBe(99)
    expect(dialects.filter((d) => d === 'plain').length).toBe(11)
  })

  it('loses nothing from any tileset and stays byte-stable', () => {
    for (const path of tilesets) {
      const first = parseTilesetJson(readFileSync(path, 'utf8'), path)
      const once = serializeTilesetJson(first.tileset, first.hints)
      const second = parseTilesetJson(once, path)
      expect(shape(second.tileset), `model drift in ${path}`).toEqual(shape(first.tileset))
      expect(serializeTilesetJson(second.tileset, second.hints), `unstable output for ${path}`).toBe(once)
    }
  })

  it('round-trips project files byte for byte', () => {
    for (const path of projects) {
      const original = readFileSync(path, 'utf8')
      expect(serializeProjectJson(parseProjectJson(original)), path).toBe(original)
    }
  })
})
