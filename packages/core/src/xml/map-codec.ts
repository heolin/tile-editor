import { gunzipSync, gzipSync, unzlibSync, zlibSync } from 'fflate'
import { DenseLayerData, fromChunks, toChunks, type Chunk } from '../layer-data.js'
import type {
  Layer, MapObject, ObjectLayer, Orientation, Point, Property, PropertyType,
  RenderOrder, TextBlock, TileLayer, TileMap, TilesetRef,
} from '../model.js'
import { parseTilesetBody, serializeTilesetBody } from './tileset-codec.js'
import { attrBool, attrNum, attrStr, childNamed, childrenNamed, extraAttrs, parseXml, type XNode } from './reader.js'
import { writeXml, type XmlElement } from './writer.js'

/* ------------------------------------------------------------------ */
/* Properties                                                          */
/* ------------------------------------------------------------------ */

const PROPERTY_ATTRS = ['name', 'type', 'value', 'propertytype']

function parsePropertyValue(type: PropertyType, raw: string): unknown {
  switch (type) {
    case 'int': return Math.trunc(Number(raw) || 0)
    case 'float': return Number(raw) || 0
    case 'bool': return raw === 'true' || raw === '1'
    case 'object': return Number(raw) || 0
    default: return raw
  }
}

export function parsePropertiesNode(parent: XNode): Property[] {
  const container = childNamed(parent, 'properties')
  if (!container) return []
  return childrenNamed(container, 'property').map((node) => {
    const type = (attrStr(node, 'type') || 'string') as PropertyType
    // A multi-line string lives in the element body rather than an attribute.
    const raw = node.attrs.value ?? node.text
    return {
      name: attrStr(node, 'name'),
      type,
      value: parsePropertyValue(type, raw),
      propertytype: node.attrs.propertytype,
      extra: extraAttrs(node, PROPERTY_ATTRS),
      keyOrder: Object.keys(node.attrs),
    }
  })
}

function formatPropertyValue(prop: Property): string {
  if (prop.type === 'bool') return prop.value ? 'true' : 'false'
  return prop.value === undefined || prop.value === null ? '' : String(prop.value)
}

export function emitPropertiesNode(props: Property[]): XmlElement | undefined {
  if (props.length === 0) return undefined
  return {
    tag: 'properties',
    attrs: {},
    children: props.map((prop): XmlElement => {
      const value = formatPropertyValue(prop)
      const multiline = value.includes('\n')
      return {
        tag: 'property',
        attrs: {
          name: prop.name,
          // Tiled omits type for plain strings.
          type: prop.type === 'string' ? undefined : prop.type,
          propertytype: prop.propertytype,
          value: multiline ? undefined : value,
          ...(prop.extra as Record<string, string>),
        },
        text: multiline ? value : undefined,
      }
    }),
  }
}

/* ------------------------------------------------------------------ */
/* Tile data                                                           */
/* ------------------------------------------------------------------ */

function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, '')
  const bin = typeof atob === 'function' ? atob(clean) : Buffer.from(clean, 'base64').toString('binary')
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
  const out = new Array<number>(Math.floor(bytes.byteLength / 4))
  for (let i = 0; i < out.length; i++) out[i] = view.getUint32(i * 4, true)
  return out
}

function gidsToBytes(gids: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(gids.length * 4)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < gids.length; i++) view.setUint32(i * 4, (gids[i] ?? 0) >>> 0, true)
  return bytes
}

interface ParsedData {
  gids: number[]
  encoding: 'csv' | 'base64'
  compression?: TileLayer['compression']
  /** Present only for infinite maps, whose data arrives split into chunks. */
  chunks?: Chunk[]
}

function decodeBody(text: string, encoding: string, compression: string | undefined, node: XNode): number[] {
  if (encoding === 'csv') {
    return text
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => Number(part) >>> 0)
  }
  if (encoding === 'base64') {
    let bytes = decodeBase64(text)
    if (compression === 'gzip') bytes = gunzipSync(bytes)
    else if (compression === 'zlib') bytes = unzlibSync(bytes)
    else if (compression === 'zstd') throw new Error('Dane zstd nie są jeszcze obsługiwane')
    return bytesToGids(bytes)
  }
  return childrenNamed(node, 'tile').map((tile) => attrNum(tile, 'gid') >>> 0)
}

function parseData(node: XNode | undefined): ParsedData {
  if (!node) return { gids: [], encoding: 'csv' }
  const encoding = attrStr(node, 'encoding', 'xml')
  const compression = (node.attrs.compression || undefined) as TileLayer['compression']

  // An infinite map stores its data as a set of <chunk> elements instead.
  const chunkNodes = childrenNamed(node, 'chunk')
  if (chunkNodes.length > 0) {
    const chunks = chunkNodes.map((chunk): Chunk => ({
      x: attrNum(chunk, 'x'),
      y: attrNum(chunk, 'y'),
      width: attrNum(chunk, 'width'),
      height: attrNum(chunk, 'height'),
      gids: decodeBody(chunk.text, encoding, compression, chunk),
    }))
    return { gids: [], encoding: encoding === 'base64' ? 'base64' : 'csv', compression, chunks }
  }

  if (encoding === 'csv') {
    const gids = node.text
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => Number(part) >>> 0)
    return { gids, encoding: 'csv' }
  }
  if (encoding === 'base64') {
    let bytes = decodeBase64(node.text)
    if (compression === 'gzip') bytes = gunzipSync(bytes)
    else if (compression === 'zlib') bytes = unzlibSync(bytes)
    else if (compression === 'zstd') throw new Error('Dane zstd nie są jeszcze obsługiwane')
    return { gids: bytesToGids(bytes), encoding: 'base64', compression }
  }
  // The oldest form: one <tile gid="..."/> per cell.
  return { gids: childrenNamed(node, 'tile').map((tile) => attrNum(tile, 'gid') >>> 0), encoding: 'csv' }
}

function encodeBody(gids: readonly number[], layer: TileLayer, columns: number): { text: string; layout: 'raw' | 'indented' } {
  if (layer.encoding === 'csv') {
    const rows: string[] = []
    const height = Math.ceil(gids.length / Math.max(1, columns))
    for (let y = 0; y < height; y++) {
      const row = gids.slice(y * columns, (y + 1) * columns).join(',')
      rows.push(y === height - 1 ? row : row + ',')
    }
    return { text: rows.join('\n'), layout: 'raw' }
  }
  let bytes = gidsToBytes(gids)
  if (layer.compression === 'gzip') bytes = gzipSync(bytes)
  else if (layer.compression === 'zlib') bytes = zlibSync(bytes)
  return { text: encodeBase64(bytes), layout: 'indented' }
}

function emitData(layer: TileLayer, infinite: boolean): XmlElement {
  if (infinite || layer.chunked) {
    const chunks = toChunks(layer.data)
    return {
      tag: 'data',
      attrs: { encoding: layer.encoding, compression: layer.compression },
      children: chunks.map((chunk) => {
        const body = encodeBody(chunk.gids, layer, chunk.width)
        return {
          tag: 'chunk',
          attrs: { x: chunk.x, y: chunk.y, width: chunk.width, height: chunk.height },
          text: body.text,
          textLayout: body.layout,
        }
      }),
    }
  }
  const gids = layer.data.toArray()
  if (layer.encoding === 'csv') {
    const rows: string[] = []
    for (let y = 0; y < layer.height; y++) {
      const row = gids.slice(y * layer.width, (y + 1) * layer.width).join(',')
      rows.push(y === layer.height - 1 ? row : row + ',')
    }
    // Tiled writes CSV bodies flush against the left margin.
    return { tag: 'data', attrs: { encoding: 'csv' }, text: rows.join('\n'), textLayout: 'raw' }
  }
  let bytes = gidsToBytes(gids)
  if (layer.compression === 'gzip') bytes = gzipSync(bytes)
  else if (layer.compression === 'zlib') bytes = zlibSync(bytes)
  return {
    tag: 'data',
    attrs: { encoding: 'base64', compression: layer.compression },
    text: encodeBase64(bytes),
    textLayout: 'indented',
  }
}

/* ------------------------------------------------------------------ */
/* Objects                                                             */
/* ------------------------------------------------------------------ */

const OBJECT_ATTRS = ['id', 'name', 'type', 'class', 'x', 'y', 'width', 'height', 'rotation', 'visible', 'gid', 'template']
const TEXT_ATTRS = ['fontfamily', 'pixelsize', 'wrap', 'color', 'bold', 'italic', 'underline', 'strikeout', 'kerning', 'halign', 'valign']

function parsePoints(raw: string): Point[] {
  return raw
    .split(' ')
    .filter(Boolean)
    .map((pair) => {
      const [x, y] = pair.split(',')
      return { x: Number(x) || 0, y: Number(y) || 0 }
    })
}

const formatPoints = (points: Point[]): string => points.map((p) => `${p.x},${p.y}`).join(' ')

export function parseObjectNode(node: XNode): MapObject {
  const polygon = childNamed(node, 'polygon')
  const polyline = childNamed(node, 'polyline')
  const text = childNamed(node, 'text')
  const shape: MapObject['shape'] =
    node.attrs.gid !== undefined ? 'tile'
    : childNamed(node, 'ellipse') ? 'ellipse'
    : childNamed(node, 'point') ? 'point'
    : polygon ? 'polygon'
    : polyline ? 'polyline'
    : text ? 'text'
    : 'rectangle'

  return {
    id: attrNum(node, 'id'),
    name: attrStr(node, 'name'),
    className: attrStr(node, 'class') || attrStr(node, 'type'),
    x: attrNum(node, 'x'),
    y: attrNum(node, 'y'),
    width: attrNum(node, 'width'),
    height: attrNum(node, 'height'),
    rotation: attrNum(node, 'rotation'),
    visible: attrBool(node, 'visible', true),
    shape,
    gid: node.attrs.gid === undefined ? undefined : attrNum(node, 'gid') >>> 0,
    polygon: polygon ? parsePoints(attrStr(polygon, 'points')) : undefined,
    polyline: polyline ? parsePoints(attrStr(polyline, 'points')) : undefined,
    text: text
      ? {
          text: text.text,
          fontfamily: text.attrs.fontfamily,
          pixelsize: text.attrs.pixelsize ? Number(text.attrs.pixelsize) : undefined,
          wrap: text.attrs.wrap ? text.attrs.wrap !== '0' : undefined,
          color: text.attrs.color,
          bold: text.attrs.bold ? text.attrs.bold !== '0' : undefined,
          italic: text.attrs.italic ? text.attrs.italic !== '0' : undefined,
          underline: text.attrs.underline ? text.attrs.underline !== '0' : undefined,
          strikeout: text.attrs.strikeout ? text.attrs.strikeout !== '0' : undefined,
          kerning: text.attrs.kerning ? text.attrs.kerning !== '0' : undefined,
          halign: text.attrs.halign as TextBlock['halign'],
          valign: text.attrs.valign as TextBlock['valign'],
          extra: extraAttrs(text, TEXT_ATTRS),
        }
      : undefined,
    template: node.attrs.template,
    properties: parsePropertiesNode(node),
    extra: extraAttrs(node, OBJECT_ATTRS),
    keyOrder: Object.keys(node.attrs),
  }
}

export function emitObjectNode(obj: MapObject): XmlElement {
  const children: XmlElement[] = []
  const props = emitPropertiesNode(obj.properties)
  if (props) children.push(props)
  if (obj.shape === 'ellipse') children.push({ tag: 'ellipse', attrs: {} })
  if (obj.shape === 'point') children.push({ tag: 'point', attrs: {} })
  if (obj.polygon) children.push({ tag: 'polygon', attrs: { points: formatPoints(obj.polygon) } })
  if (obj.polyline) children.push({ tag: 'polyline', attrs: { points: formatPoints(obj.polyline) } })
  if (obj.text) {
    children.push({
      tag: 'text',
      attrs: {
        fontfamily: obj.text.fontfamily,
        pixelsize: obj.text.pixelsize,
        wrap: obj.text.wrap === undefined ? undefined : obj.text.wrap,
        color: obj.text.color,
        bold: obj.text.bold === undefined ? undefined : obj.text.bold,
        italic: obj.text.italic === undefined ? undefined : obj.text.italic,
        underline: obj.text.underline === undefined ? undefined : obj.text.underline,
        strikeout: obj.text.strikeout === undefined ? undefined : obj.text.strikeout,
        kerning: obj.text.kerning === undefined ? undefined : obj.text.kerning,
        halign: obj.text.halign,
        valign: obj.text.valign,
        ...(obj.text.extra as Record<string, string>),
      },
      text: obj.text.text,
      textLayout: 'indented',
    })
  }

  return {
    tag: 'object',
    attrs: {
      id: obj.id || undefined,
      name: obj.name || undefined,
      type: obj.className || undefined,
      gid: obj.gid,
      x: obj.x,
      y: obj.y,
      width: obj.width || undefined,
      height: obj.height || undefined,
      rotation: obj.rotation || undefined,
      visible: obj.visible ? undefined : false,
      template: obj.template,
      ...(obj.extra as Record<string, string>),
    },
    children,
  }
}

/* ------------------------------------------------------------------ */
/* Layers                                                              */
/* ------------------------------------------------------------------ */

const LAYER_ATTRS = [
  'id', 'name', 'class', 'width', 'height', 'x', 'y', 'opacity', 'visible',
  'offsetx', 'offsety', 'parallaxx', 'parallaxy', 'tintcolor', 'draworder',
  'repeatx', 'repeaty',
]

function parseLayerNode(node: XNode): Layer | undefined {
  const base = {
    id: attrNum(node, 'id'),
    name: attrStr(node, 'name'),
    className: node.attrs.class,
    opacity: attrNum(node, 'opacity', 1),
    visible: attrBool(node, 'visible', true),
    offsetx: attrNum(node, 'offsetx'),
    offsety: attrNum(node, 'offsety'),
    parallaxx: attrNum(node, 'parallaxx', 1),
    parallaxy: attrNum(node, 'parallaxy', 1),
    tintcolor: node.attrs.tintcolor,
    properties: parsePropertiesNode(node),
    extra: extraAttrs(node, LAYER_ATTRS),
    keyOrder: Object.keys(node.attrs),
  }

  switch (node.tag) {
    case 'layer': {
      const width = attrNum(node, 'width')
      const height = attrNum(node, 'height')
      const parsed = parseData(childNamed(node, 'data'))
      const data = parsed.chunks
        ? fromChunks(parsed.chunks)
        : DenseLayerData.fromArray(width, height, parsed.gids)
      return {
        ...base,
        kind: 'tilelayer',
        width: parsed.chunks ? data.bounds.width : width,
        height: parsed.chunks ? data.bounds.height : height,
        x: attrNum(node, 'x'),
        y: attrNum(node, 'y'),
        data,
        encoding: parsed.encoding,
        compression: parsed.compression,
        chunked: parsed.chunks ? true : undefined,
      }
    }
    case 'objectgroup':
      return {
        ...base,
        kind: 'objectgroup',
        draworder: (node.attrs.draworder as ObjectLayer['draworder']) ?? 'topdown',
        objects: childrenNamed(node, 'object').map(parseObjectNode),
      }
    case 'imagelayer': {
      const image = childNamed(node, 'image')
      return {
        ...base,
        kind: 'imagelayer',
        image: image ? attrStr(image, 'source') : '',
        repeatx: attrBool(node, 'repeatx', false),
        repeaty: attrBool(node, 'repeaty', false),
        transparentcolor: image?.attrs.trans,
      }
    }
    case 'group':
      return {
        ...base,
        kind: 'group',
        layers: node.children.map(parseLayerNode).filter((l): l is Layer => l !== undefined),
      }
    default:
      return undefined
  }
}

function emitLayerNode(layer: Layer, infinite: boolean): XmlElement {
  const common = {
    id: layer.id || undefined,
    name: layer.name || undefined,
    class: layer.className,
    opacity: layer.opacity === 1 ? undefined : layer.opacity,
    visible: layer.visible ? undefined : false,
    offsetx: layer.offsetx || undefined,
    offsety: layer.offsety || undefined,
    parallaxx: layer.parallaxx === 1 ? undefined : layer.parallaxx,
    parallaxy: layer.parallaxy === 1 ? undefined : layer.parallaxy,
    tintcolor: layer.tintcolor,
    ...(layer.extra as Record<string, string>),
  }
  const props = emitPropertiesNode(layer.properties)

  switch (layer.kind) {
    case 'objectgroup':
      return {
        tag: 'objectgroup',
        attrs: { ...common, draworder: layer.draworder === 'topdown' ? undefined : layer.draworder },
        children: [...(props ? [props] : []), ...layer.objects.map(emitObjectNode)],
      }
    case 'imagelayer':
      return {
        tag: 'imagelayer',
        attrs: { ...common, repeatx: layer.repeatx || undefined, repeaty: layer.repeaty || undefined },
        children: [
          ...(props ? [props] : []),
          { tag: 'image', attrs: { source: layer.image, trans: layer.transparentcolor } },
        ],
      }
    case 'group':
      return {
        tag: 'group',
        attrs: common,
        children: [...(props ? [props] : []), ...layer.layers.map((child) => emitLayerNode(child, infinite))],
      }
    default:
      return {
        tag: 'layer',
        attrs: { ...common, width: layer.width, height: layer.height, x: layer.x || undefined, y: layer.y || undefined },
        children: [...(props ? [props] : []), emitData(layer, infinite)],
      }
  }
}

/* ------------------------------------------------------------------ */
/* Map                                                                 */
/* ------------------------------------------------------------------ */

const MAP_ATTRS = [
  'version', 'tiledversion', 'orientation', 'renderorder', 'compressionlevel',
  'width', 'height', 'tilewidth', 'tileheight', 'hexsidelength', 'staggeraxis',
  'staggerindex', 'parallaxoriginx', 'parallaxoriginy', 'backgroundcolor',
  'nextlayerid', 'nextobjectid', 'infinite', 'class',
]

export function parseMapXml(text: string): { map: TileMap } {
  const node = parseXml(text)
  if (node.tag !== 'map') throw new Error(`Oczekiwano elementu <map>, znaleziono <${node.tag}>`)

  const tilesets: TilesetRef[] = childrenNamed(node, 'tileset').map((child) => ({
    firstgid: attrNum(child, 'firstgid', 1),
    source: child.attrs.source,
    // An embedded tileset is parsed in place; an external one is resolved by
    // the project loader, which knows how to find files.
    tileset: child.attrs.source === undefined ? parseTilesetBody(child) : undefined,
    extra: extraAttrs(child, ['firstgid', 'source']),
    keyOrder: Object.keys(child.attrs),
  }))

  const map: TileMap = {
    version: attrStr(node, 'version', '1.10'),
    tiledversion: node.attrs.tiledversion,
    orientation: (attrStr(node, 'orientation', 'orthogonal')) as Orientation,
    renderorder: (attrStr(node, 'renderorder', 'right-down')) as RenderOrder,
    width: attrNum(node, 'width'),
    height: attrNum(node, 'height'),
    tilewidth: attrNum(node, 'tilewidth', 32),
    tileheight: attrNum(node, 'tileheight', 32),
    infinite: attrBool(node, 'infinite', false),
    compressionlevel: attrNum(node, 'compressionlevel', -1),
    nextlayerid: attrNum(node, 'nextlayerid', 1),
    nextobjectid: attrNum(node, 'nextobjectid', 1),
    backgroundcolor: node.attrs.backgroundcolor,
    className: node.attrs.class,
    hexsidelength: node.attrs.hexsidelength ? attrNum(node, 'hexsidelength') : undefined,
    staggeraxis: node.attrs.staggeraxis as TileMap['staggeraxis'],
    staggerindex: node.attrs.staggerindex as TileMap['staggerindex'],
    parallaxoriginx: node.attrs.parallaxoriginx ? attrNum(node, 'parallaxoriginx') : undefined,
    parallaxoriginy: node.attrs.parallaxoriginy ? attrNum(node, 'parallaxoriginy') : undefined,
    tilesets,
    layers: node.children.map(parseLayerNode).filter((l): l is Layer => l !== undefined),
    properties: parsePropertiesNode(node),
    extra: extraAttrs(node, MAP_ATTRS),
    keyOrder: Object.keys(node.attrs),
  }
  return { map }
}

export function serializeMapXml(map: TileMap): string {
  const children: XmlElement[] = []
  const props = emitPropertiesNode(map.properties)
  if (props) children.push(props)

  for (const ref of map.tilesets) {
    if (ref.source !== undefined || !ref.tileset) {
      children.push({
        tag: 'tileset',
        attrs: { firstgid: ref.firstgid, source: ref.source, ...(ref.extra as Record<string, string>) },
      })
    } else {
      const embedded = serializeTilesetBody(ref.tileset)
      children.push({ ...embedded, attrs: { firstgid: ref.firstgid, ...embedded.attrs } })
    }
  }
  for (const layer of map.layers) children.push(emitLayerNode(layer, map.infinite))

  return writeXml({
    tag: 'map',
    attrs: {
      version: map.version,
      tiledversion: map.tiledversion,
      orientation: map.orientation,
      renderorder: map.renderorder,
      width: map.width,
      height: map.height,
      tilewidth: map.tilewidth,
      tileheight: map.tileheight,
      hexsidelength: map.hexsidelength,
      staggeraxis: map.staggeraxis,
      staggerindex: map.staggerindex,
      parallaxoriginx: map.parallaxoriginx,
      parallaxoriginy: map.parallaxoriginy,
      backgroundcolor: map.backgroundcolor,
      class: map.className,
      infinite: map.infinite ? 1 : 0,
      nextlayerid: map.nextlayerid || undefined,
      nextobjectid: map.nextobjectid || undefined,
      ...(map.extra as Record<string, string>),
    },
    children,
  })
}
