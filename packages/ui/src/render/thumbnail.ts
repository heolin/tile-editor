import { parseGid, walkLayers, type MapObject, type TileMap } from '@tile-editor/core'
import { tileObjectAnchor, tilesetOf, type TileFrame, type TileSourceIndex } from './tile-source'

/**
 * A map drawn small, on a plain 2D canvas rather than through the WebGL
 * renderer - that one is busy holding the map being edited, and a project of
 * 115 levels needs dozens of these without fighting it for the context.
 *
 * Objects are drawn alongside tiles because in this corpus they carry the
 * content: a tilt-ball level is nothing but objects, and a thumbnail without
 * them would be an empty rectangle (docs/PLAN.md section 5.1).
 */

const images = new Map<string, Promise<HTMLImageElement | undefined>>()

function load(url: string): Promise<HTMLImageElement | undefined> {
  const held = images.get(url)
  if (held) return held
  const pending = new Promise<HTMLImageElement | undefined>((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image)
    // A missing image is a lint finding, not a reason to have no thumbnail.
    image.onerror = () => resolve(undefined)
    image.src = url
  })
  images.set(url, pending)
  return pending
}

export interface ThumbnailOptions {
  /** Longest side of the result, in CSS pixels. */
  size?: number
  background?: string
}

export async function renderThumbnail(
  map: TileMap,
  source: TileSourceIndex,
  options: ThumbnailOptions = {},
): Promise<string | undefined> {
  const size = options.size ?? 160
  const worldW = Math.max(1, map.width * map.tilewidth)
  const worldH = Math.max(1, map.height * map.tileheight)
  const scale = size / Math.max(worldW, worldH)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(worldW * scale))
  canvas.height = Math.max(1, Math.round(worldH * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined

  if (options.background) {
    ctx.fillStyle = options.background
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.imageSmoothingEnabled = true
  ctx.scale(scale, scale)

  // Every image the map needs, fetched once, before anything is drawn - the
  // draw order matters and awaiting mid-layer would scramble it.
  const loaded = new Map<string, HTMLImageElement>()
  await Promise.all(
    source.urls().map(async (url) => {
      const image = await load(url)
      if (image) loaded.set(url, image)
    }),
  )

  const draw = (frame: TileFrame, x: number, y: number, w: number, h: number, flip: { h: boolean; v: boolean }) => {
    const image = loaded.get(frame.url)
    if (!image) return
    ctx.save()
    ctx.translate(x + (flip.h ? w : 0), y + (flip.v ? h : 0))
    ctx.scale(flip.h ? -1 : 1, flip.v ? -1 : 1)
    ctx.drawImage(image, frame.sx, frame.sy, frame.sw, frame.sh, 0, 0, w, h)
    ctx.restore()
  }

  for (const layer of walkLayers(map.layers)) {
    if (!layer.visible) continue
    ctx.globalAlpha = layer.opacity
    if (layer.kind === 'tilelayer') {
      const { x: ox, y: oy, width, height } = layer.data.bounds
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const raw = layer.data.get(ox + col, oy + row)
          if (raw === 0) continue
          const frame = source.frame(raw)
          if (!frame) continue
          const { flipH, flipV } = parseGid(raw)
          draw(frame, (ox + col) * map.tilewidth, (oy + row) * map.tileheight, map.tilewidth, map.tileheight, { h: flipH, v: flipV })
        }
      }
    } else if (layer.kind === 'objectgroup') {
      for (const object of layer.objects) {
        if (!object.visible) continue
        drawObject(ctx, map, source, object, draw)
      }
    }
  }
  ctx.globalAlpha = 1

  return canvas.toDataURL('image/webp', 0.75)
}

function drawObject(
  ctx: CanvasRenderingContext2D,
  map: TileMap,
  source: TileSourceIndex,
  object: MapObject,
  draw: (frame: TileFrame, x: number, y: number, w: number, h: number, flip: { h: boolean; v: boolean }) => void,
): void {
  if (object.gid === undefined) return
  const frame = source.frame(object.gid)
  if (!frame) return
  const { flipH, flipV } = parseGid(object.gid)
  const width = object.width || map.tilewidth
  const height = object.height || map.tileheight
  // (x, y) is an anchor, not a corner - which corner it means is the tileset's
  // business, and getting it wrong shifts every object by its own size.
  const anchor = tileObjectAnchor(tilesetOf(map, object.gid))
  const left = object.x - anchor.ax * width
  const top = object.y - anchor.ay * height

  if (object.rotation) {
    ctx.save()
    ctx.translate(object.x, object.y)
    ctx.rotate((object.rotation * Math.PI) / 180)
    ctx.translate(-object.x, -object.y)
    draw(frame, left, top, width, height, { h: flipH, v: flipV })
    ctx.restore()
    return
  }
  draw(frame, left, top, width, height, { h: flipH, v: flipV })
}
