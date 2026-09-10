import type { ObjectAlignment, ObjectLayer, Tile, Tileset } from '../model.js'
import { emitObjectNode, emitPropertiesNode, parseObjectNode, parsePropertiesNode } from './map-codec.js'
import { attrNum, attrStr, childNamed, childrenNamed, extraAttrs, parseXml, unknownChildren, type XNode } from './reader.js'
import { writeXml, type XmlElement } from './writer.js'

const TILESET_ATTRS = [
  'firstgid', 'source', 'name', 'class', 'tilewidth', 'tileheight', 'spacing',
  'margin', 'tilecount', 'columns', 'objectalignment', 'version', 'tiledversion',
  'fillmode', 'tilerendersize',
]

const TILE_ATTRS = ['id', 'type', 'class', 'probability', 'x', 'y', 'width', 'height']

/** Child elements each node models itself; anything else is carried verbatim. */
// 'grid' is deliberately absent: the model does not read it, so it has to be
// carried through verbatim rather than treated as understood.
const TILESET_CHILDREN = ['tileoffset', 'properties', 'image', 'tile'] as const
const TILE_CHILDREN = ['properties', 'image', 'animation', 'objectgroup'] as const

function parseTile(node: XNode): Tile {
  const image = childNamed(node, 'image')
  const animation = childNamed(node, 'animation')
  // Collision shapes live in an <objectgroup> nested inside the tile. Skipping
  // it here would silently drop every collision shape on save.
  const collision = childNamed(node, 'objectgroup')
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
    objectgroup: collision
      ? ({
          kind: 'objectgroup',
          id: attrNum(collision, 'id'),
          name: attrStr(collision, 'name'),
          opacity: attrNum(collision, 'opacity', 1),
          visible: collision.attrs.visible !== '0',
          offsetx: attrNum(collision, 'offsetx'),
          offsety: attrNum(collision, 'offsety'),
          parallaxx: attrNum(collision, 'parallaxx', 1),
          parallaxy: attrNum(collision, 'parallaxy', 1),
          draworder: (collision.attrs.draworder as ObjectLayer['draworder']) ?? 'index',
          objects: childrenNamed(collision, 'object').map(parseObjectNode),
          properties: parsePropertiesNode(collision),
        } satisfies ObjectLayer)
      : undefined,
    extra: extraAttrs(node, TILE_ATTRS),
    keyOrder: Object.keys(node.attrs),
    xmlChildren: unknownChildren(node, TILE_CHILDREN),
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
  if (tile.objectgroup) {
    const group = tile.objectgroup
    children.push({
      tag: 'objectgroup',
      attrs: {
        id: group.id || undefined,
        // Tiled writes draworder="index" on tile collision groups.
        draworder: group.draworder === 'index' ? 'index' : undefined,
      },
      children: group.objects.map(emitObjectNode),
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
  children.push(...((tile.xmlChildren as XmlElement[] | undefined) ?? []))
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
    // Wang sets, terrain types and the grid element all land here: the editor
    // does not model them yet, and dropping them would corrupt the file.
    xmlChildren: unknownChildren(node, TILESET_CHILDREN),
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
  children.push(...((tileset.xmlChildren as XmlElement[] | undefined) ?? []))

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
