import { gunzipSync, unzlibSync, gzipSync, zlibSync } from 'fflate'
import { DenseLayerData } from '../layer-data.js'
import type {
  GroupLayer, ImageLayer, Layer, MapObject, ObjectLayer, Orientation,
  Property, RenderOrder, TextBlock, TileLayer, TileMap, TilesetRef,
} from '../model.js'
import { DEFAULT_HINTS, bool, detectHints, emitOrdered, emitProperties, num, parseProperties, str, takePreserved, type FormatHints } from './common.js'
import { PLAIN_STYLE, TILED_STYLE, WrappedNumbers, writeJson } from './writer.js'

const MAP_KEYS = [
  'version', 'tiledversion', 'orientation', 'renderorder', 'width', 'height',
  'tilewidth', 'tileheight', 'infinite', 'compressionlevel', 'nextlayerid',
  'nextobjectid', 'backgroundcolor', 'class', 'hexsidelength', 'staggeraxis',
  'staggerindex', 'parallaxoriginx', 'parallaxoriginy', 'tilesets', 'layers',
  'properties', 'type',
] as const

// 'x' and 'y' are deliberately absent below: tile layers model them, every
// other layer kind carries Tiled's always-zero pair through `extra` untouched.
const LAYER_KEYS = [
  'id', 'name', 'class', 'type', 'opacity', 'visible', 'offsetx', 'offsety',
  'parallaxx', 'parallaxy', 'tintcolor', 'properties', 'width', 'height',
  'data', 'encoding', 'compression', 'chunks', 'draworder', 'objects', 'layers',
  'image', 'repeatx', 'repeaty', 'transparentcolor',
] as const

const OBJECT_KEYS = [
  'id', 'name', 'type', 'class', 'x', 'y', 'width', 'height', 'rotation',
  'visible', 'gid', 'ellipse', 'point', 'polygon', 'polyline', 'text',
  'template', 'properties',
] as const

const TEXT_KEYS = [
  'text', 'fontfamily', 'pixelsize', 'wrap', 'color', 'bold', 'italic',
  'underline', 'strikeout', 'kerning', 'halign', 'valign',
] as const

const TILESET_REF_KEYS = ['firstgid', 'source'] as const

/* ------------------------------------------------------------------ */
/* Tile data encoding                                                  */
/* ------------------------------------------------------------------ */

function decodeBase64(text: string): Uint8Array {
  const bin = typeof atob === 'function'
    ? atob(text)
    : Buffer.from(text, 'base64').toString('binary')
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function encodeBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let bin = ''
    for (const b of bytes) bin += String.fromCharCode(b)
    return btoa(bin)
  }
  return Buffer.from(bytes).toString('base64')
}

function bytesToGids(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out: number[] = new Array(Math.floor(bytes.byteLength / 4))
  for (let i = 0; i < out.length; i++) out[i] = view.getUint32(i * 4, true)
  return out
}

function gidsToBytes(gids: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(gids.length * 4)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < gids.length; i++) view.setUint32(i * 4, (gids[i] ?? 0) >>> 0, true)
  return bytes
}

function decodeTileData(raw: unknown, compression: string | undefined): number[] {
  if (Array.isArray(raw)) return raw as number[]
  if (typeof raw !== 'string') return []
  let bytes = decodeBase64(raw)
  if (compression === 'gzip') bytes = gunzipSync(bytes)
  else if (compression === 'zlib') bytes = unzlibSync(bytes)
  else if (compression === 'zstd') throw new Error('zstd tile data is not supported yet')
  return bytesToGids(bytes)
}

function encodeTileData(
  gids: readonly number[],
  encoding: 'csv' | 'base64',
  compression: string | undefined,
  columns: number,
): unknown {
  if (encoding === 'csv') return new WrappedNumbers(gids, columns)
  let bytes = gidsToBytes(gids)
  if (compression === 'gzip') bytes = gzipSync(bytes)
  else if (compression === 'zlib') bytes = zlibSync(bytes)
  return encodeBase64(bytes)
}

/* ------------------------------------------------------------------ */
/* Objects                                                             */
/* ------------------------------------------------------------------ */

function parseText(raw: Record<string, unknown>): TextBlock {
  return {
    text: str(raw.text),
    fontfamily: raw.fontfamily as string | undefined,
    pixelsize: raw.pixelsize as number | undefined,
    wrap: raw.wrap as boolean | undefined,
    color: raw.color as string | undefined,
    bold: raw.bold as boolean | undefined,
    italic: raw.italic as boolean | undefined,
    underline: raw.underline as boolean | undefined,
    strikeout: raw.strikeout as boolean | undefined,
    kerning: raw.kerning as boolean | undefined,
    halign: raw.halign as TextBlock['halign'],
    valign: raw.valign as TextBlock['valign'],
    ...takePreserved(raw, TEXT_KEYS),
  }
}

function parseObject(raw: Record<string, unknown>): MapObject {
  const shape: MapObject['shape'] =
    raw.gid !== undefined ? 'tile'
    : raw.ellipse === true ? 'ellipse'
    : raw.point === true ? 'point'
    : Array.isArray(raw.polygon) ? 'polygon'
    : Array.isArray(raw.polyline) ? 'polyline'
    : raw.text !== undefined ? 'text'
    : 'rectangle'

  return {
    id: num(raw.id),
    name: str(raw.name),
    // Tiled 1.9 renamed the object's "type" to "class"; both appear in the wild.
    className: str(raw.class ?? raw.type),
    x: num(raw.x),
    y: num(raw.y),
    width: num(raw.width),
    height: num(raw.height),
    rotation: num(raw.rotation),
    visible: bool(raw.visible, true),
    shape,
    gid: raw.gid === undefined ? undefined : num(raw.gid) >>> 0,
    polygon: Array.isArray(raw.polygon) ? (raw.polygon as { x: number; y: number }[]).map((p) => ({ x: p.x, y: p.y })) : undefined,
    polyline: Array.isArray(raw.polyline) ? (raw.polyline as { x: number; y: number }[]).map((p) => ({ x: p.x, y: p.y })) : undefined,
    text: raw.text !== undefined ? parseText(raw.text as Record<string, unknown>) : undefined,
    template: raw.template as string | undefined,
    properties: parseProperties(raw.properties),
    ...takePreserved(raw, OBJECT_KEYS),
  }
}

function emitObject(obj: MapObject): Record<string, unknown> {
  // Keep whichever spelling of the class key the source used.
  const usedClassKey = obj.keyOrder?.includes('class') ? 'class' : 'type'
  const known: Record<string, unknown> = {
    id: obj.id,
    name: obj.name,
    [usedClassKey]: obj.className,
    x: obj.x,
    y: obj.y,
    width: obj.width,
    height: obj.height,
    rotation: obj.rotation,
    visible: obj.visible,
    gid: obj.gid,
    ellipse: obj.shape === 'ellipse' ? true : undefined,
    point: obj.shape === 'point' ? true : undefined,
    polygon: obj.polygon,
    polyline: obj.polyline,
    text: obj.text ? emitOrdered(obj.text, {
      text: obj.text.text,
      fontfamily: obj.text.fontfamily,
      pixelsize: obj.text.pixelsize,
      wrap: obj.text.wrap,
      color: obj.text.color,
      bold: obj.text.bold,
      italic: obj.text.italic,
      underline: obj.text.underline,
      strikeout: obj.text.strikeout,
      kerning: obj.text.kerning,
      halign: obj.text.halign,
      valign: obj.text.valign,
    }) : undefined,
    template: obj.template,
    properties: emitProperties(obj.properties),
  }
  return emitOrdered(obj, known)
}

/* ------------------------------------------------------------------ */
/* Layers                                                              */
/* ------------------------------------------------------------------ */

function parseLayer(raw: Record<string, unknown>): Layer {
  const base = {
    id: num(raw.id),
    name: str(raw.name),
    className: raw.class as string | undefined,
    opacity: num(raw.opacity, 1),
    visible: bool(raw.visible, true),
    offsetx: num(raw.offsetx),
    offsety: num(raw.offsety),
    parallaxx: num(raw.parallaxx, 1),
    parallaxy: num(raw.parallaxy, 1),
    tintcolor: raw.tintcolor as string | undefined,
    properties: parseProperties(raw.properties),
    ...takePreserved(raw, LAYER_KEYS),
  }

  switch (str(raw.type)) {
    case 'objectgroup':
      return {
        ...base,
        kind: 'objectgroup',
        draworder: (raw.draworder as ObjectLayer['draworder']) ?? 'topdown',
        objects: Array.isArray(raw.objects) ? raw.objects.map((o) => parseObject(o as Record<string, unknown>)) : [],
      }
    case 'imagelayer':
      return {
        ...base,
        kind: 'imagelayer',
        image: str(raw.image),
        repeatx: bool(raw.repeatx, false),
        repeaty: bool(raw.repeaty, false),
        transparentcolor: raw.transparentcolor as string | undefined,
      }
    case 'group':
      return {
        ...base,
        kind: 'group',
        layers: Array.isArray(raw.layers) ? raw.layers.map((l) => parseLayer(l as Record<string, unknown>)) : [],
      }
    default: {
      const width = num(raw.width)
      const height = num(raw.height)
      const compression = raw.compression as string | undefined
      const gids = decodeTileData(raw.data, compression)
      return {
        ...base,
        kind: 'tilelayer',
        width,
        height,
        x: num(raw.x),
        y: num(raw.y),
        data: DenseLayerData.fromArray(width, height, gids),
        encoding: typeof raw.data === 'string' ? 'base64' : 'csv',
        compression: compression as TileLayer['compression'],
      }
    }
  }
}

function emitLayer(layer: Layer): Record<string, unknown> {
  const common: Record<string, unknown> = {
    id: layer.id,
    name: layer.name,
    class: layer.className,
    opacity: layer.opacity,
    visible: layer.visible,
    offsetx: layer.offsetx || undefined,
    offsety: layer.offsety || undefined,
    parallaxx: layer.parallaxx === 1 ? undefined : layer.parallaxx,
    parallaxy: layer.parallaxy === 1 ? undefined : layer.parallaxy,
    tintcolor: layer.tintcolor,
    properties: emitProperties(layer.properties),
  }

  switch (layer.kind) {
    case 'objectgroup':
      return emitOrdered(layer, {
        ...common,
        type: 'objectgroup',
        draworder: layer.draworder,
        objects: layer.objects.map(emitObject),
      })
    case 'imagelayer':
      return emitOrdered(layer, {
        ...common,
        type: 'imagelayer',
        image: layer.image,
        repeatx: layer.repeatx || undefined,
        repeaty: layer.repeaty || undefined,
        transparentcolor: layer.transparentcolor,
      })
    case 'group':
      return emitOrdered(layer, { ...common, type: 'group', layers: layer.layers.map(emitLayer) })
    default:
      return emitOrdered(layer, {
        ...common,
        type: 'tilelayer',
        width: layer.width,
        height: layer.height,
        x: layer.x,
        y: layer.y,
        data: encodeTileData(layer.data.toArray(), layer.encoding, layer.compression, layer.width),
        encoding: layer.encoding === 'base64' ? 'base64' : undefined,
        compression: layer.compression,
      })
  }
}

/* ------------------------------------------------------------------ */
/* Map                                                                 */
/* ------------------------------------------------------------------ */

function parseTilesetRef(raw: Record<string, unknown>): TilesetRef {
  return {
    firstgid: num(raw.firstgid, 1),
    source: raw.source as string | undefined,
    ...takePreserved(raw, TILESET_REF_KEYS),
  }
}

export interface ParsedMap {
  map: TileMap
  hints: FormatHints
}

export function parseMapJson(text: string): ParsedMap {
  const raw = JSON.parse(text) as Record<string, unknown>
  const map: TileMap = {
    version: str(raw.version, '1.10'),
    tiledversion: raw.tiledversion as string | undefined,
    orientation: (raw.orientation as Orientation) ?? 'orthogonal',
    renderorder: (raw.renderorder as RenderOrder) ?? 'right-down',
    width: num(raw.width),
    height: num(raw.height),
    tilewidth: num(raw.tilewidth, 32),
    tileheight: num(raw.tileheight, 32),
    infinite: bool(raw.infinite, false),
    compressionlevel: num(raw.compressionlevel, -1),
    nextlayerid: num(raw.nextlayerid, 1),
    nextobjectid: num(raw.nextobjectid, 1),
    backgroundcolor: raw.backgroundcolor as string | undefined,
    className: raw.class as string | undefined,
    hexsidelength: raw.hexsidelength as number | undefined,
    staggeraxis: raw.staggeraxis as TileMap['staggeraxis'],
    staggerindex: raw.staggerindex as TileMap['staggerindex'],
    parallaxoriginx: raw.parallaxoriginx as number | undefined,
    parallaxoriginy: raw.parallaxoriginy as number | undefined,
    tilesets: Array.isArray(raw.tilesets) ? raw.tilesets.map((t) => parseTilesetRef(t as Record<string, unknown>)) : [],
    layers: Array.isArray(raw.layers) ? raw.layers.map((l) => parseLayer(l as Record<string, unknown>)) : [],
    properties: parseProperties(raw.properties),
    ...takePreserved(raw, MAP_KEYS),
  }
  return { map, hints: detectHints(text) }
}

export function serializeMapJson(map: TileMap, hints: FormatHints = DEFAULT_HINTS): string {
  const out = emitOrdered(map, {
    compressionlevel: map.compressionlevel,
    height: map.height,
    infinite: map.infinite,
    layers: map.layers.map(emitLayer),
    nextlayerid: map.nextlayerid,
    nextobjectid: map.nextobjectid,
    orientation: map.orientation,
    properties: emitProperties(map.properties),
    renderorder: map.renderorder,
    tiledversion: map.tiledversion,
    tileheight: map.tileheight,
    tilesets: map.tilesets.map((t) => emitOrdered(t, { firstgid: t.firstgid, source: t.source })),
    tilewidth: map.tilewidth,
    type: 'map',
    version: map.version,
    width: map.width,
    backgroundcolor: map.backgroundcolor,
    class: map.className,
    hexsidelength: map.hexsidelength,
    staggeraxis: map.staggeraxis,
    staggerindex: map.staggerindex,
    parallaxoriginx: map.parallaxoriginx,
    parallaxoriginy: map.parallaxoriginy,
  })
  const base = hints.dialect === 'plain' ? PLAIN_STYLE : TILED_STYLE
  return writeJson(out, { ...base, rootBraceInline: hints.rootBraceInline, trailingNewline: hints.trailingNewline })
}
