import { tileId, tilesetForGid, type TileMap, type Tileset } from '@tile-editor/core'
import { resolveFrom } from '@tile-editor/core'

/**
 * Where the pixels for a given global tile id actually live. Image-collection
 * tilesets - the only kind in the corpus - give every tile its own file, so a
 * frame is a whole image rather than a rectangle inside an atlas.
 */
export interface TileFrame {
  url: string
  /** Source rectangle inside `url`, in pixels. */
  sx: number
  sy: number
  sw: number
  sh: number
}

export interface TileSourceIndex {
  frame(gid: number): TileFrame | undefined
  /** Every distinct image this map needs, for preloading. */
  urls(): string[]
}

/**
 * Builds the gid to image mapping once per map load. Both tileset shapes are
 * handled: a collection of images, and a classic atlas with columns/spacing.
 */
export function buildTileSourceIndex(
  map: TileMap,
  assetUrl: (path: string) => string,
): TileSourceIndex {
  const frames = new Map<number, TileFrame>()

  for (const ref of map.tilesets) {
    const tileset: Tileset | undefined = ref.tileset
    if (!tileset) continue
    const basePath = tileset.sourcePath ?? ref.source ?? ''

    if (tileset.image) {
      // Atlas: derive each tile's rectangle from the grid.
      const columns = tileset.columns > 0
        ? tileset.columns
        : Math.max(1, Math.floor((tileset.imagewidth ?? 0) / Math.max(1, tileset.tilewidth)))
      const url = assetUrl(resolveFrom(basePath, tileset.image))
      for (let i = 0; i < tileset.tilecount; i++) {
        const col = i % columns
        const row = Math.floor(i / columns)
        frames.set(ref.firstgid + i, {
          url,
          sx: tileset.margin + col * (tileset.tilewidth + tileset.spacing),
          sy: tileset.margin + row * (tileset.tileheight + tileset.spacing),
          sw: tileset.tilewidth,
          sh: tileset.tileheight,
        })
      }
    }

    // Per-tile images override anything the atlas provided.
    for (const tile of tileset.tiles) {
      if (!tile.image) continue
      frames.set(ref.firstgid + tile.id, {
        url: assetUrl(resolveFrom(basePath, tile.image)),
        sx: 0,
        sy: 0,
        sw: tile.imagewidth ?? tileset.tilewidth,
        sh: tile.imageheight ?? tileset.tileheight,
      })
    }
  }

  return {
    frame: (gid) => frames.get(tileId(gid)),
    urls: () => [...new Set([...frames.values()].map((f) => f.url))],
  }
}

/**
 * Tiled anchors a tile object at its bottom-left corner unless the tileset says
 * otherwise. 655 of the corpus's 712 objects are stretched away from their
 * native size, so getting this right is the difference between a map that looks
 * correct and one that does not (docs/PLAN.md section 5.1).
 */
export function tileObjectAnchor(tileset: Tileset | undefined): { ax: number; ay: number } {
  switch (tileset?.objectalignment) {
    case 'topleft': return { ax: 0, ay: 0 }
    case 'top': return { ax: 0.5, ay: 0 }
    case 'topright': return { ax: 1, ay: 0 }
    case 'left': return { ax: 0, ay: 0.5 }
    case 'center': return { ax: 0.5, ay: 0.5 }
    case 'right': return { ax: 1, ay: 0.5 }
    case 'bottomleft': return { ax: 0, ay: 1 }
    case 'bottom': return { ax: 0.5, ay: 1 }
    case 'bottomright': return { ax: 1, ay: 1 }
    default: return { ax: 0, ay: 1 }
  }
}

export function tilesetOf(map: TileMap, gid: number): Tileset | undefined {
  return tilesetForGid(map, gid)?.tileset
}
