import { describe, expect, it } from 'vitest'
import { globSync, readFileSync } from 'node:fs'
import { parseTilesetXml, serializeTilesetXml } from '../src/xml/tileset-codec.js'
import { parseMapXml, serializeMapXml } from '../src/xml/map-codec.js'
import { parseTilesetJson, serializeTilesetJson } from '../src/json/tileset-codec.js'
import { DEFAULT_HINTS } from '../src/json/common.js'

/**
 * The editor must never delete a part of a file it does not understand. These
 * cover the shapes that used to vanish: wang sets, terrain, tileset grids and
 * per-tile sub-rectangles.
 */
describe('parts of a file the model does not understand', () => {
  it('keeps wang sets in a TSX the editor merely opened', () => {
    const path = 'packages/core/test/fixtures/tmx/desert.tsx'
    const source = readFileSync(path, 'utf8')
    expect(source).toContain('<wangsets>')
    const out = serializeTilesetXml(parseTilesetXml(source, path).tileset)
    expect(out).toContain('<wangsets>')
    // Every wang colour and tile survives, not just the wrapper.
    const count = (text: string, tag: string) => text.split(`<${tag}`).length - 1
    expect(count(out, 'wangcolor')).toBe(count(source, 'wangcolor'))
    expect(count(out, 'wangtile')).toBe(count(source, 'wangtile'))
  })

  it('keeps them across a second save, so nothing decays over time', () => {
    const path = 'packages/core/test/fixtures/tmx/desert.tsx'
    const once = serializeTilesetXml(parseTilesetXml(readFileSync(path, 'utf8'), path).tileset)
    const twice = serializeTilesetXml(parseTilesetXml(once, path).tileset)
    expect(twice).toBe(once)
  })

  it('keeps unmodelled JSON keys on a tileset and its tiles', () => {
    const source = JSON.stringify({
      name: 'x', type: 'tileset', tilewidth: 8, tileheight: 8, tilecount: 1,
      columns: 1, margin: 0, spacing: 0,
      wangsets: [{ name: 'w', type: 'corner', tile: -1, colors: [], wangtiles: [] }],
      grid: { orientation: 'orthogonal', width: 8, height: 8 },
      tiles: [{ id: 0, x: 4, y: 6, width: 8, height: 8 }],
    })
    const out = serializeTilesetJson(parseTilesetJson(source, 'a.tsj').tileset, DEFAULT_HINTS)
    const back = JSON.parse(out) as Record<string, unknown>
    expect(back.wangsets).toBeDefined()
    expect(back.grid).toEqual({ orientation: 'orthogonal', width: 8, height: 8 })
    expect((back.tiles as Record<string, unknown>[])[0]).toMatchObject({ x: 4, y: 6, width: 8, height: 8 })
  })

  it('keeps unmodelled children on every TMX fixture', () => {
    for (const path of globSync('packages/core/test/fixtures/tmx/*.tmx')) {
      const source = readFileSync(path, 'utf8')
      const out = serializeMapXml(parseMapXml(source).map)
      // Count the element types present, so nothing is silently dropped.
      const tags = [...source.matchAll(/<([a-z]+)[\s>/]/g)].map((m) => m[1])
      for (const tag of new Set(tags)) {
        expect(out.includes(`<${tag}`), `${path} lost <${tag}>`).toBe(true)
      }
    }
  })
})
