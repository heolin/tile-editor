import { DenseLayerData } from './layer-data.js'
import type { Layer, MapObject, ObjectLayer, TileLayer, TileMap, TilesetRef } from './model.js'
import { relativeFrom } from './paths.js'

export interface NewMapOptions {
  width: number
  height: number
  tilewidth: number
  tileheight: number
  /** Project-relative path of the map being created, used to relativise refs. */
  path: string
  /** Project-relative tileset paths the new map should reference. */
  tilesets?: { path: string; tilecount: number }[]
  layers?: { name: string; kind: 'tilelayer' | 'objectgroup' }[]
}

const DEFAULT_LAYERS: NonNullable<NewMapOptions['layers']> = [{ name: 'warstwa 1', kind: 'tilelayer' }]

export function createTileMap(options: NewMapOptions): TileMap {
  const map: TileMap = {
    version: '1.10',
    tiledversion: '1.11.2',
    orientation: 'orthogonal',
    renderorder: 'right-down',
    width: options.width,
    height: options.height,
    tilewidth: options.tilewidth,
    tileheight: options.tileheight,
    infinite: false,
    compressionlevel: -1,
    nextlayerid: 1,
    nextobjectid: 1,
    tilesets: [],
    layers: [],
    properties: [],
  }

  let firstgid = 1
  for (const entry of options.tilesets ?? []) {
    const ref: TilesetRef = { firstgid, source: relativeFrom(options.path, entry.path) }
    map.tilesets.push(ref)
    firstgid += Math.max(1, entry.tilecount)
  }

  for (const spec of options.layers ?? DEFAULT_LAYERS) {
    map.layers.push(makeLayer(map, spec.name, spec.kind))
    map.nextlayerid++
  }
  return map
}

function makeLayer(map: TileMap, name: string, kind: 'tilelayer' | 'objectgroup'): Layer {
  const base = {
    id: map.nextlayerid,
    name,
    opacity: 1,
    visible: true,
    offsetx: 0,
    offsety: 0,
    parallaxx: 1,
    parallaxy: 1,
    properties: [],
  }
  if (kind === 'objectgroup') {
    return { ...base, kind: 'objectgroup', draworder: 'topdown', objects: [] } satisfies ObjectLayer
  }
  return {
    ...base,
    kind: 'tilelayer',
    width: map.width,
    height: map.height,
    x: 0,
    y: 0,
    data: new DenseLayerData(map.width, map.height),
    encoding: 'csv',
  } satisfies TileLayer
}

/**
 * Builds a new map from an existing one, keeping the structure a project has
 * settled on - its layers, tilesets and map properties - and dropping the
 * content. Both example projects keep a hand-maintained `template.tmj` for
 * exactly this, so the editor may as well do it properly (docs/PLAN.md 5.2).
 */
export function createFromTemplate(
  template: TileMap,
  options: { path: string; templatePath: string; width?: number; height?: number; keepContent?: boolean },
): TileMap {
  const width = options.width ?? template.width
  const height = options.height ?? template.height
  const map: TileMap = {
    ...template,
    width,
    height,
    // Copy every collection so edits never reach back into the template.
    tilesets: template.tilesets.map((ref) => ({
      ...ref,
      source: ref.source ? relativeFrom(options.path, resolveAgainst(options.templatePath, ref.source)) : undefined,
    })),
    properties: template.properties.map((p) => ({ ...p })),
    layers: template.layers.map((layer) => cloneLayer(layer, width, height, options.keepContent ?? false)),
  }
  if (!options.keepContent) map.nextobjectid = 1
  return map
}

function resolveAgainst(fromFile: string, relative: string): string {
  const dir = fromFile.split('/').slice(0, -1).join('/')
  const parts: string[] = []
  for (const part of `${dir}/${relative}`.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

function cloneLayer(layer: Layer, width: number, height: number, keepContent: boolean): Layer {
  const properties = layer.properties.map((p) => ({ ...p }))
  switch (layer.kind) {
    case 'tilelayer':
      return {
        ...layer,
        properties,
        width,
        height,
        data: keepContent
          ? (layer.data as DenseLayerData).resized(width, height)
          : new DenseLayerData(width, height),
      }
    case 'objectgroup':
      return { ...layer, properties, objects: keepContent ? layer.objects.map((o) => ({ ...o })) : [] }
    case 'group':
      return { ...layer, properties, layers: layer.layers.map((l) => cloneLayer(l, width, height, keepContent)) }
    default:
      return { ...layer, properties }
  }
}

/**
 * A deep enough copy to paste: everything the model knows about, plus the
 * parts of the source file it only carries (`extra`, `keyOrder`), so a pasted
 * object writes out like the one it came from rather than a stripped version.
 */
export function cloneObject(object: MapObject, id: number): MapObject {
  const copy: MapObject = { ...object, id, properties: object.properties.map((p) => ({ ...p })) }
  // Assigned only when present: writing `polygon: undefined` would put the key
  // on the object, and the codecs go by which keys exist.
  if (object.polygon) copy.polygon = object.polygon.map((point) => ({ ...point }))
  if (object.polyline) copy.polyline = object.polyline.map((point) => ({ ...point }))
  if (object.text) copy.text = { ...object.text }
  if (object.extra) copy.extra = { ...object.extra }
  if (object.keyOrder) copy.keyOrder = [...object.keyOrder]
  return copy
}

/** The top-left corner of the box a set of objects hangs from. */
export function objectsOrigin(objects: readonly MapObject[]): { x: number; y: number } {
  return {
    x: Math.min(...objects.map((o) => o.x)),
    y: Math.min(...objects.map((o) => o.y)),
  }
}
