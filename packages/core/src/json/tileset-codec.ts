import type { ObjectAlignment, ObjectLayer, Tile, Tileset } from '../model.js'
import { DEFAULT_HINTS, bool, detectHints, emitOrdered, emitProperties, num, parseProperties, str, takePreserved, type FormatHints } from './common.js'
import { PLAIN_STYLE, TILED_STYLE, writeJson } from './writer.js'

const TILESET_KEYS = [
  'name', 'class', 'type', 'version', 'tiledversion', 'tilewidth', 'tileheight',
  'tilecount', 'columns', 'margin', 'spacing', 'image', 'imagewidth',
  'imageheight', 'transparentcolor', 'objectalignment', 'tileoffset', 'tiles',
  'properties', 'grid', 'wangsets', 'transformations', 'fillmode', 'tilerendersize',
] as const

const TILE_KEYS = [
  'id', 'class', 'type', 'probability', 'image', 'imagewidth', 'imageheight',
  'properties', 'animation', 'objectgroup', 'x', 'y', 'width', 'height',
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
    // Tile collision shapes ride along as a raw object layer; the map codec
    // owns object parsing, so this is kept opaque until v1.1 needs it.
    objectgroup: raw.objectgroup as unknown as ObjectLayer | undefined,
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
    animation: tile.animation?.map((f) => emitOrdered(f, { tileid: f.tileid, duration: f.duration })),
    objectgroup: tile.objectgroup as unknown,
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
