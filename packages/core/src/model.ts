import type { LayerData } from './layer-data.js'

/**
 * The document model is format-agnostic: nothing here knows about JSON or XML.
 * Codecs on either side translate to and from it (docs/PLAN.md section 5.3).
 *
 * Every node carries `extra` and `keyOrder` so that fields this editor does not
 * understand survive a load/save cycle untouched, in their original position.
 */
export interface Preserving {
  /** Keys present in the source that the model does not model explicitly. */
  extra?: Record<string, unknown>
  /** Key order as found in the source, used to keep saves stable. */
  keyOrder?: string[]
}

export type PropertyType = 'string' | 'int' | 'float' | 'bool' | 'color' | 'file' | 'object' | 'class'

export interface Property extends Preserving {
  name: string
  type: PropertyType
  value: unknown
  /** Name of the custom type, when `type` is 'class'. */
  propertytype?: string
}

export type Orientation = 'orthogonal' | 'isometric' | 'staggered' | 'hexagonal'
export type RenderOrder = 'right-down' | 'right-up' | 'left-down' | 'left-up'
export type ObjectAlignment =
  | 'unspecified' | 'topleft' | 'top' | 'topright'
  | 'left' | 'center' | 'right'
  | 'bottomleft' | 'bottom' | 'bottomright'

export interface Point {
  x: number
  y: number
}

export type ObjectShape = 'rectangle' | 'ellipse' | 'point' | 'polygon' | 'polyline' | 'text' | 'tile'

export interface TextBlock extends Preserving {
  text: string
  fontfamily?: string
  pixelsize?: number
  wrap?: boolean
  color?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikeout?: boolean
  kerning?: boolean
  halign?: 'left' | 'center' | 'right' | 'justify'
  valign?: 'top' | 'center' | 'bottom'
}

export interface MapObject extends Preserving {
  id: number
  name: string
  /** Tiled calls this `type` in JSON and `class` in newer XML. */
  className: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  visible: boolean
  shape: ObjectShape
  /** Present when `shape` is 'tile'; includes transform flags. */
  gid?: number
  polygon?: Point[]
  polyline?: Point[]
  text?: TextBlock
  template?: string
  properties: Property[]
}

interface LayerBase extends Preserving {
  id: number
  name: string
  className?: string
  opacity: number
  visible: boolean
  offsetx: number
  offsety: number
  parallaxx: number
  parallaxy: number
  tintcolor?: string
  properties: Property[]
}

export interface TileLayer extends LayerBase {
  kind: 'tilelayer'
  width: number
  height: number
  x: number
  y: number
  data: LayerData
  /** How the source encoded the data, so a save can put it back the same way. */
  encoding: 'csv' | 'base64'
  compression?: 'gzip' | 'zlib' | 'zstd'
}

export interface ObjectLayer extends LayerBase {
  kind: 'objectgroup'
  draworder: 'topdown' | 'index'
  objects: MapObject[]
}

export interface ImageLayer extends LayerBase {
  kind: 'imagelayer'
  image: string
  repeatx: boolean
  repeaty: boolean
  transparentcolor?: string
}

export interface GroupLayer extends LayerBase {
  kind: 'group'
  layers: Layer[]
}

export type Layer = TileLayer | ObjectLayer | ImageLayer | GroupLayer

export interface Frame extends Preserving {
  tileid: number
  duration: number
}

export interface Tile extends Preserving {
  id: number
  className?: string
  probability?: number
  /** Set for image-collection tilesets, where every tile has its own file. */
  image?: string
  imagewidth?: number
  imageheight?: number
  properties: Property[]
  animation?: Frame[]
  /** Collision shapes, stored as a nested object layer exactly as Tiled does. */
  objectgroup?: ObjectLayer
}

export interface Tileset extends Preserving {
  name: string
  className?: string
  tilewidth: number
  tileheight: number
  tilecount: number
  /** Zero marks an image collection rather than an atlas. */
  columns: number
  margin: number
  spacing: number
  image?: string
  imagewidth?: number
  imageheight?: number
  transparentcolor?: string
  objectalignment?: ObjectAlignment
  tileoffset?: Point
  tiles: Tile[]
  properties: Property[]
  version?: string
  tiledversion?: string
  /** Absolute-ish path this tileset was loaded from, for relative resolution. */
  sourcePath?: string
}

/** A tileset as referenced from a map: either embedded or an external file. */
export interface TilesetRef extends Preserving {
  firstgid: number
  /** Relative path as written in the file; absent when embedded. */
  source?: string
  /** Populated once the referenced file has been resolved and loaded. */
  tileset?: Tileset
}

export interface TileMap extends Preserving {
  version: string
  tiledversion?: string
  orientation: Orientation
  renderorder: RenderOrder
  width: number
  height: number
  tilewidth: number
  tileheight: number
  infinite: boolean
  compressionlevel: number
  nextlayerid: number
  nextobjectid: number
  backgroundcolor?: string
  className?: string
  hexsidelength?: number
  staggeraxis?: 'x' | 'y'
  staggerindex?: 'even' | 'odd'
  parallaxoriginx?: number
  parallaxoriginy?: number
  tilesets: TilesetRef[]
  layers: Layer[]
  properties: Property[]
}

export interface TiledProject extends Preserving {
  folders: string[]
  automappingRulesFile?: string
  commands?: unknown[]
  extensionsPath?: string
  propertyTypes?: unknown[]
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function findProperty(props: Property[], name: string): Property | undefined {
  return props.find((p) => p.name === name)
}

export function propertyValue(props: Property[], name: string): unknown {
  return findProperty(props, name)?.value
}

/** Depth-first walk over a layer tree, groups included. */
export function* walkLayers(layers: Layer[]): Generator<Layer> {
  for (const layer of layers) {
    yield layer
    if (layer.kind === 'group') yield* walkLayers(layer.layers)
  }
}

export function allObjects(map: TileMap): MapObject[] {
  const out: MapObject[] = []
  for (const layer of walkLayers(map.layers)) {
    if (layer.kind === 'objectgroup') out.push(...layer.objects)
  }
  return out
}

/** Resolves a global tile id to the tileset that owns it. */
export function tilesetForGid(map: TileMap, gid: number): TilesetRef | undefined {
  const id = (gid >>> 0) & 0x1fffffff
  if (id === 0) return undefined
  let best: TilesetRef | undefined
  for (const ref of map.tilesets) {
    if (ref.firstgid <= id && (!best || ref.firstgid > best.firstgid)) best = ref
  }
  return best
}

export function localTileId(map: TileMap, gid: number): number | undefined {
  const ref = tilesetForGid(map, gid)
  if (!ref) return undefined
  return ((gid >>> 0) & 0x1fffffff) - ref.firstgid
}
