import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { ProjectLoader, type FsEntry, type ProjectFS } from '../src/project.js'
import { walkLayers } from '../src/model.js'

/** The corpus on disk, behind the same interface the editor talks to. */
class DiskFS implements ProjectFS {
  written = new Map<string, string>()
  constructor(private root: string) {}
  listAll(): Promise<FsEntry[]> {
    return Promise.resolve([])
  }
  readText(path: string): Promise<string> {
    const held = this.written.get(path)
    return Promise.resolve(held ?? readFileSync(`${this.root}/${path}`, 'utf8'))
  }
  writeText(path: string, content: string): Promise<void> {
    this.written.set(path, content)
    return Promise.resolve()
  }
  exists(): Promise<boolean> {
    return Promise.resolve(true)
  }
  assetUrl(path: string): string {
    return path
  }
}

const MAP = 'levels/01_coop.tmj'

/**
 * A draft is the text a save would have written, parked in the browser. What
 * makes it trustworthy is that putting it back gives the same document - the
 * same guarantee the round-trip tests make about files.
 */
describe('a draft round-trips through text', () => {
  it('comes back as the same map it was taken from', async () => {
    const loader = new ProjectLoader(new DiskFS('examples/sokoban'))
    const loaded = await loader.loadMap(MAP)

    // Edit something, then take the draft the editor would have taken.
    const layer = [...walkLayers(loaded.map.layers)].find((l) => l.kind === 'tilelayer')!
    layer.data.set(0, 0, 7)
    loaded.map.properties.push({ name: 'draft', type: 'string', value: 'tak' })
    const text = loader.serializeMap(loaded.map, MAP, loaded.hints)

    const restored = await loader.adoptMap(MAP, text)
    expect(restored.path).toBe(MAP)
    const restoredLayer = [...walkLayers(restored.map.layers)].find((l) => l.kind === 'tilelayer')!
    expect(restoredLayer.data.get(0, 0)).toBe(7)
    // toMatchObject, not toEqual: parsing also records key order, which is the
    // point of the preservation machinery rather than part of the value.
    expect(restored.map.properties.at(-1)).toMatchObject({ name: 'draft', type: 'string', value: 'tak' })

    // And writing it again is byte-identical, so restoring costs no fidelity.
    expect(loader.serializeMap(restored.map, MAP, restored.hints)).toBe(text)
  })

  it('resolves tilesets for an adopted map, just like reading the file would', async () => {
    const loader = new ProjectLoader(new DiskFS('examples/sokoban'))
    const loaded = await loader.loadMap(MAP)
    const fresh = new ProjectLoader(new DiskFS('examples/sokoban'))
    const adopted = await fresh.adoptMap(MAP, loaded.text)
    expect(adopted.map.tilesets.length).toBeGreaterThan(0)
    expect(adopted.map.tilesets.every((ref) => ref.tileset !== undefined)).toBe(true)
  })

  it('keeps the text a map was loaded from, to compare a later save against', async () => {
    const fs = new DiskFS('examples/sokoban')
    const loader = new ProjectLoader(fs)
    const loaded = await loader.loadMap(MAP)
    expect(loaded.text).toBe(readFileSync(`examples/sokoban/${MAP}`, 'utf8'))
    const written = await loader.saveMap(loaded.map, MAP, loaded.hints)
    expect(fs.written.get(MAP)).toBe(written)
  })
})
