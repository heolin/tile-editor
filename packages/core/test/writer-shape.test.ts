import { describe, expect, it } from 'vitest'
import { globSync, readFileSync } from 'node:fs'
import { TILED_STYLE, WrappedNumbers, writeJson } from '../src/json/writer.js'

/**
 * Focused check on the formatting rules derived from the corpus: object members
 * indent one space past their container, array elements seven, tile data wraps
 * at the layer width, and forward slashes are escaped.
 */
describe('Tiled JSON formatting rules', () => {
  const clean = globSync('examples/*/levels/*.tmj')
    .sort()
    .find((p) => {
      const text = readFileSync(p, 'utf8')
      // Tiled dialect (tight colons) and free of the generator's blank lines.
      return !/\n[ ]+\n/.test(text) && !/":[ ]/.test(text)
    })!

  it('reproduces a Tiled-written map exactly', () => {
    const original = readFileSync(clean, 'utf8')
    const parsed = JSON.parse(original) as Record<string, unknown>
    for (const layer of parsed.layers as Record<string, unknown>[]) {
      if (Array.isArray(layer.data)) {
        layer.data = new WrappedNumbers(layer.data as number[], layer.width as number)
      }
    }
    expect(writeJson(parsed, TILED_STYLE), clean).toBe(original)
  })

  it('escapes forward slashes the way Tiled does', () => {
    expect(writeJson({ source: '../sokoban.tsj' }, TILED_STYLE)).toBe('{ "source":"..\\/sokoban.tsj"\n}')
  })

  it('wraps tile data at the layer width', () => {
    const out = writeJson({ data: new WrappedNumbers([1, 2, 3, 4], 2) }, TILED_STYLE)
    expect(out).toBe('{ "data":[1, 2,\n    3, 4]\n}')
  })
})
