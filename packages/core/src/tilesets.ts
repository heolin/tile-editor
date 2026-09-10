import { tileId } from './gid.js'
import type { Tile, TileMap, Tileset, TilesetRef } from './model.js'
import { walkLayers } from './model.js'
import { basename, extname, relativeFrom, resolveFrom } from './paths.js'

/**
 * Attaching and detaching tilesets is where global tile ids get dangerous: the
 * `firstgid` of one tileset depends on how many tiles the previous ones hold,
 * so anything that changes the list has to keep every placed tile pointing at
 * the same picture. The helpers here own that arithmetic.
 */

/** The id one past the end of the current tileset list. */
export function nextFirstGid(map: TileMap): number {
  let highest = 1
  for (const ref of map.tilesets) {
    const count = ref.tileset ? Math.max(1, ref.tileset.tilecount) : 1
    highest = Math.max(highest, ref.firstgid + count)
  }
  return highest
}

export function addTileset(map: TileMap, mapPath: string, tilesetPath: string, tileset: Tileset): TilesetRef {
  const ref: TilesetRef = {
    firstgid: nextFirstGid(map),
    source: relativeFrom(mapPath, tilesetPath),
    tileset,
  }
  map.tilesets.push(ref)
  return ref
}

/** How many placed tiles and tile objects would break if this ref went away. */
export function tilesetUsage(map: TileMap, ref: TilesetRef): number {
  const count = ref.tileset ? Math.max(1, ref.tileset.tilecount) : 1
  const from = ref.firstgid
  const to = ref.firstgid + count
  let used = 0
  for (const layer of walkLayers(map.layers)) {
    if (layer.kind === 'tilelayer') {
      layer.data.forEach((_x, _y, gid) => {
        const id = tileId(gid)
        if (id >= from && id < to) used++
      })
    } else if (layer.kind === 'objectgroup') {
      for (const obj of layer.objects) {
        if (obj.gid === undefined) continue
        const id = tileId(obj.gid)
        if (id >= from && id < to) used++
      }
    }
  }
  return used
}

/** Whether a map already references the tileset at this project path. */
export function findTilesetRef(map: TileMap, mapPath: string, tilesetPath: string): TilesetRef | undefined {
  return map.tilesets.find((ref) => ref.source && resolveFrom(mapPath, ref.source) === tilesetPath)
}

/* ------------------------------------------------------------------ */
/* Editing a tileset                                                   */
/* ------------------------------------------------------------------ */

export interface NewTilesetOptions {
  name: string
  tilewidth: number
  tileheight: number
}

/** Creates an empty image-collection tileset, the shape both games use. */
export function createTileset(options: NewTilesetOptions): Tileset {
  return {
    name: options.name,
    tilewidth: options.tilewidth,
    tileheight: options.tileheight,
    tilecount: 0,
    // Zero columns is what marks a collection rather than an atlas.
    columns: 0,
    margin: 0,
    spacing: 0,
    tiles: [],
    properties: [],
    version: '1.10',
    tiledversion: '1.11.2',
  }
}

export function isImageCollection(tileset: Tileset): boolean {
  return tileset.columns === 0 || tileset.image === undefined
}

/**
 * Appends images as new tiles. Ids continue past the highest in use rather than
 * filling gaps, so an id never quietly changes meaning between saves.
 */
export function addImagesToTileset(
  tileset: Tileset,
  tilesetPath: string,
  imagePaths: string[],
  sizeOf?: (path: string) => { width: number; height: number } | undefined,
): Tile[] {
  const existing = new Set(tileset.tiles.map((t) => t.image).filter(Boolean))
  let nextId = tileset.tiles.reduce((max, tile) => Math.max(max, tile.id + 1), 0)
  const added: Tile[] = []

  for (const imagePath of imagePaths) {
    const relative = relativeFrom(tilesetPath, imagePath)
    if (existing.has(relative)) continue
    const size = sizeOf?.(imagePath)
    const tile: Tile = {
      id: nextId++,
      image: relative,
      imagewidth: size?.width ?? tileset.tilewidth,
      imageheight: size?.height ?? tileset.tileheight,
      properties: [],
    }
    tileset.tiles.push(tile)
    added.push(tile)
    existing.add(relative)
  }

  tileset.tilecount = tileset.tiles.reduce((max, tile) => Math.max(max, tile.id + 1), 0)
  return added
}

export function removeTileFromTileset(tileset: Tileset, id: number): boolean {
  const index = tileset.tiles.findIndex((tile) => tile.id === id)
  if (index < 0) return false
  tileset.tiles.splice(index, 1)
  // tilecount stays at the high-water mark: shrinking it would renumber the
  // tiles after this one and repoint every map that uses them.
  return true
}

/** A readable label for a tile, preferring its image file name. */
export function tileLabel(tile: Tile): string {
  if (!tile.image) return `#${tile.id}`
  const base = basename(tile.image)
  const ext = extname(base)
  return ext ? base.slice(0, -ext.length) : base
}
