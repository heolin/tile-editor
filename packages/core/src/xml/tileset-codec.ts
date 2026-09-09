import type { ObjectAlignment, Tile, Tileset } from '../model.js'
import { emitPropertiesNode, parsePropertiesNode } from './map-codec.js'
import { attrNum, attrStr, childNamed, childrenNamed, extraAttrs, parseXml, type XNode } from './reader.js'
import { writeXml, type XmlElement } from './writer.js'

const TILESET_ATTRS = [
  'firstgid', 'source', 'name', 'class', 'tilewidth', 'tileheight', 'spacing',
  'margin', 'tilecount', 'columns', 'objectalignment', 'version', 'tiledversion',
  'fillmode', 'tilerendersize',
]

const TILE_ATTRS = ['id', 'type', 'class', 'probability', 'x', 'y', 'width', 'height']

function parseTile(node: XNode): Tile {
  const image = childNamed(node, 'image')
  const animation = childNamed(node, 'animation')
  return {
    id: attrNum(node, 'id'),
    className: node.attrs.class ?? node.attrs.type,
    probability: node.attrs.probability ? attrNum(node, 'probability') : undefined,
    image: image ? attrStr(image, 'source') : undefined,
    imagewidth: image ? attrNum(image, 'width') : undefined,
    imageheight: image ? attrNum(image, 'height') : undefined,
    properties: parsePropertiesNode(node),
    animation: animation
      ? childrenNamed(animation, 'frame').map((frame) => ({
          tileid: attrNum(frame, 'tileid'),
          duration: attrNum(frame, 'duration'),
        }))
      : undefined,
    extra: extraAttrs(node, TILE_ATTRS),
    keyOrder: Object.keys(node.attrs),
  }
}

function emitTile(tile: Tile): XmlElement {
  const children: XmlElement[] = []
  const props = emitPropertiesNode(tile.properties)
  if (props) children.push(props)
  if (tile.image) {
    children.push({
      tag: 'image',
      attrs: { source: tile.image, width: tile.imagewidth, height: tile.imageheight },
    })
  }
  if (tile.animation && tile.animation.length > 0) {
    children.push({
      tag: 'animation',
      attrs: {},
      children: tile.animation.map((frame) => ({
        tag: 'frame',
        attrs: { tileid: frame.tileid, duration: frame.duration },
      })),
    })
  }
  return {
    tag: 'tile',
    attrs: {
      id: tile.id,
      type: tile.className,
      probability: tile.probability,
      ...(tile.extra as Record<string, string>),
    },
    children,
  }
}

/** Parses a <tileset> element, whether standalone or embedded inside a map. */
export function parseTilesetBody(node: XNode, sourcePath?: string): Tileset {
  const image = childNamed(node, 'image')
  const offset = childNamed(node, 'tileoffset')
  return {
    name: attrStr(node, 'name'),
    className: node.attrs.class,
    tilewidth: attrNum(node, 'tilewidth', 32),
    tileheight: attrNum(node, 'tileheight', 32),
    tilecount: attrNum(node, 'tilecount'),
    columns: attrNum(node, 'columns'),
    margin: attrNum(node, 'margin'),
    spacing: attrNum(node, 'spacing'),
    image: image ? attrStr(image, 'source') : undefined,
    imagewidth: image ? attrNum(image, 'width') : undefined,
    imageheight: image ? attrNum(image, 'height') : undefined,
    transparentcolor: image?.attrs.trans,
    objectalignment: node.attrs.objectalignment as ObjectAlignment | undefined,
    tileoffset: offset ? { x: attrNum(offset, 'x'), y: attrNum(offset, 'y') } : undefined,
    tiles: childrenNamed(node, 'tile').map(parseTile),
    properties: parsePropertiesNode(node),
    version: node.attrs.version,
    tiledversion: node.attrs.tiledversion,
    sourcePath,
    extra: extraAttrs(node, TILESET_ATTRS),
    keyOrder: Object.keys(node.attrs),
  }
}

export function serializeTilesetBody(tileset: Tileset): XmlElement {
  const children: XmlElement[] = []
  if (tileset.tileoffset) {
    children.push({ tag: 'tileoffset', attrs: { x: tileset.tileoffset.x, y: tileset.tileoffset.y } })
  }
  const props = emitPropertiesNode(tileset.properties)
  if (props) children.push(props)
  if (tileset.image) {
    children.push({
      tag: 'image',
      attrs: {
        source: tileset.image,
        trans: tileset.transparentcolor,
        width: tileset.imagewidth,
        height: tileset.imageheight,
      },
    })
  }
  for (const tile of tileset.tiles) children.push(emitTile(tile))

  return {
    tag: 'tileset',
    attrs: {
      version: tileset.version,
      tiledversion: tileset.tiledversion,
      name: tileset.name,
      class: tileset.className,
      tilewidth: tileset.tilewidth,
      tileheight: tileset.tileheight,
      spacing: tileset.spacing || undefined,
      margin: tileset.margin || undefined,
      tilecount: tileset.tilecount || undefined,
      columns: tileset.columns,
      objectalignment: tileset.objectalignment,
      ...(tileset.extra as Record<string, string>),
    },
    children,
  }
}

export function parseTilesetXml(text: string, sourcePath?: string): { tileset: Tileset } {
  const node = parseXml(text)
  if (node.tag !== 'tileset') throw new Error(`Oczekiwano elementu <tileset>, znaleziono <${node.tag}>`)
  return { tileset: parseTilesetBody(node, sourcePath) }
}

export function serializeTilesetXml(tileset: Tileset): string {
  return writeXml(serializeTilesetBody(tileset))
}
