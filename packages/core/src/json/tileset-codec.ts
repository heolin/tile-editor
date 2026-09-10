import type { ObjectAlignment, ObjectLayer, Tile, Tileset } from '../model.js'
import { emitLayer, parseLayer } from './map-codec.js'
import { DEFAULT_HINTS, bool, detectHints, emitOrdered, emitProperties, num, parseProperties, str, takePreserved, type FormatHints } from './common.js'
import { PLAIN_STYLE, TILED_STYLE, writeJson } from './writer.js'

/**
 * Only keys this codec actually writes back belong here. Anything listed but
 * not emitted would be swallowed on read and lost on write, which is how
 * wangsets and grid used to disappear from a tileset the editor merely opened.
 */
const TILESET_KEYS = [
  'name', 'class', 'type', 'version', 'tiledversion', 'tilewidth', 'tileheight',
  'tilecount', 'columns', 'margin', 'spacing', 'image', 'imagewidth',
  'imageheight', 'transparentcolor', 'objectalignment', 'tileoffset', 'tiles',
  'properties',
] as const

const TILE_KEYS = [
  'id', 'class', 'type', 'probability', 'image', 'imagewidth', 'imageheight',
  'properties', 'animation', 'objectgroup',
] as const

const FRAME_KEYS = ['tileid', 'duration'] as const

function parseTile(raw: Record<string, unknown>): Tile {
  return {
    id: num(raw.id),
    className: (raw.class ?? raw.type) as string | undefined,
    probability: raw.probability as number | undefined,
    image: raw.image as string | undefined,
    imagewidth: raw.imagewidth as number | undefined,
    imageheight: raw.imageheight as number | undefined,
    properties: parseProperties(raw.properties),
    animation: Array.isArray(raw.animation)
      ? raw.animation.map((f) => {
          const src = f as Record<string, unknown>
          return { tileid: num(src.tileid), duration: num(src.duration), ...takePreserved(src, FRAME_KEYS) }
        })
      : undefined,
    // Tile collision shapes are a nested object layer. Modelling them properly
    // is what keeps a save from dropping them.
    objectgroup:
      raw.objectgroup === undefined
        ? undefined
        : (parseLayer({ type: 'objectgroup', ...(raw.objectgroup as Record<string, unknown>) }) as ObjectLayer),
    ...takePreserved(raw, TILE_KEYS),
  }
}

function emitTile(tile: Tile): Record<string, unknown> {
  const classKey = tile.keyOrder?.includes('class') ? 'class' : 'type'
  return emitOrdered(tile, {
    id: tile.id,
    [classKey]: tile.className,
    probability: tile.probability,
    image: tile.image,
    imagewidth: tile.imagewidth,
    imageheight: tile.imageheight,
    properties: emitProperties(tile.properties),
    // An empty frame list means "not animated"; Tiled omits the key entirely.
    animation: tile.animation && tile.animation.length > 0
      ? tile.animation.map((f) => emitOrdered(f, { tileid: f.tileid, duration: f.duration }))
      : undefined,
    objectgroup: tile.objectgroup ? emitLayer(tile.objectgroup) : undefined,
  })
}

export interface ParsedTileset {
  tileset: Tileset
  hints: FormatHints
}

export function parseTilesetJson(text: string, sourcePath?: string): ParsedTileset {
  const raw = JSON.parse(text) as Record<string, unknown>
  const tileset: Tileset = {
    name: str(raw.name),
    className: (raw.class) as string | undefined,
    tilewidth: num(raw.tilewidth, 32),
    tileheight: num(raw.tileheight, 32),
    tilecount: num(raw.tilecount),
    columns: num(raw.columns),
    margin: num(raw.margin),
    spacing: num(raw.spacing),
    image: raw.image as string | undefined,
    imagewidth: raw.imagewidth as number | undefined,
    imageheight: raw.imageheight as number | undefined,
    transparentcolor: raw.transparentcolor as string | undefined,
    objectalignment: raw.objectalignment as ObjectAlignment | undefined,
    tileoffset: raw.tileoffset as { x: number; y: number } | undefined,
    tiles: Array.isArray(raw.tiles) ? raw.tiles.map((t) => parseTile(t as Record<string, unknown>)) : [],
    properties: parseProperties(raw.properties),
    version: raw.version as string | undefined,
    tiledversion: raw.tiledversion as string | undefined,
    sourcePath,
    ...takePreserved(raw, TILESET_KEYS),
  }
  return { tileset, hints: detectHints(text) }
}

export function serializeTilesetJson(tileset: Tileset, hints: FormatHints = DEFAULT_HINTS): string {
  const out = emitOrdered(tileset, {
    columns: tileset.columns,
    image: tileset.image,
    imagewidth: tileset.imagewidth,
    imageheight: tileset.imageheight,
    margin: tileset.margin,
    name: tileset.name,
    class: tileset.className,
    objectalignment: tileset.objectalignment,
    properties: emitProperties(tileset.properties),
    spacing: tileset.spacing,
    tilecount: tileset.tilecount,
    tiledversion: tileset.tiledversion,
    tileheight: tileset.tileheight,
    tileoffset: tileset.tileoffset,
    tiles: tileset.tiles.length > 0 ? tileset.tiles.map(emitTile) : undefined,
    tilewidth: tileset.tilewidth,
    transparentcolor: tileset.transparentcolor,
    type: 'tileset',
    version: tileset.version,
  })
  const base = hints.dialect === 'plain' ? PLAIN_STYLE : TILED_STYLE
  return writeJson(out, { ...base, rootBraceInline: hints.rootBraceInline, trailingNewline: hints.trailingNewline })
}

export function findTile(tileset: Tileset, id: number): Tile | undefined {
  return tileset.tiles.find((t) => t.id === id)
}
