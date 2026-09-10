import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js'
import { CompositeTilemap } from '@pixi/tilemap'
import { parseGid, tileId, walkLayers, type Layer, type MapObject, type TileMap } from '@tile-editor/core'
import type { RenderOptions, TileRenderer } from './renderer'
import { tileObjectAnchor, tilesetOf, type TileSourceIndex } from './tile-source'

/**
 * Maps Tiled's three transform bits onto the rotation index pixi-tilemap uses.
 * The corpus contains no diagonal flips, so that branch is written to spec and
 * has not been verified against real data.
 */
function rotateIndex(flipH: boolean, flipV: boolean, flipD: boolean): number {
  if (!flipD) {
    if (flipH && flipV) return 4
    if (flipH) return 12
    if (flipV) return 8
    return 0
  }
  if (flipH && flipV) return 7
  if (flipH) return 6
  if (flipV) return 2
  return 10
}

export class PixiTileRenderer implements TileRenderer {
  private app?: Application
  private host?: HTMLElement
  private world = new Container()
  private tileLayers = new Container()
  private objectLayer = new Container()
  /** Non-tile object shapes, which have no texture of their own. */
  private shapes = new Graphics()
  private labels = new Container()
  private labelPool: Text[] = []
  private overlay = new Graphics()
  private grid = new Graphics()
  private background = new Graphics()

  private map?: TileMap
  private source?: TileSourceIndex
  private textures = new Map<string, Texture>()
  /** One texture per gid, cropped out of its atlas where needed. */
  private tileTextures = new Map<number, Texture>()
  private spritePool: Sprite[] = []
  private tilemaps = new Map<number, CompositeTilemap>()
  private ready = false
  /** Document revision the tile and object geometry was last built for. */
  private builtRevision = -1
  /** gid -> animation frames, for the few tiles that declare one. */
  private animations = new Map<number, { gids: number[]; durations: number[]; total: number }>()
  /** Which animation frame each animated tile was last drawn at. */
  private builtFrameKey = ''

  async init(): Promise<void> {
    const app = new Application()
    await app.init({
      antialias: false,
      backgroundAlpha: 0,
      // Nothing animates on its own; every frame is drawn on demand so an idle
      // editor costs no battery (docs/PLAN.md section 2).
      autoStart: false,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      preference: 'webgl',
    })
    app.ticker.stop()
    this.app = app
    this.world.addChild(
      this.background,
      this.tileLayers,
      this.grid,
      this.objectLayer,
      this.shapes,
      this.labels,
      this.overlay,
    )
    app.stage.addChild(this.world)
    this.ready = true
  }

  mount(host: HTMLElement): void {
    if (!this.app) return
    this.host = host
    host.appendChild(this.app.canvas)
    this.app.canvas.style.display = 'block'
    this.app.canvas.style.width = '100%'
    this.app.canvas.style.height = '100%'
    this.resize()
  }

  resize(): void {
    if (!this.app || !this.host) return
    const rect = this.host.getBoundingClientRect()
    this.app.renderer.resize(Math.max(1, rect.width), Math.max(1, rect.height))
  }

  /** Identifies the document currently loaded, so callers can spot a change. */
  documentPath?: string

  async setDocument(map: TileMap, source: TileSourceIndex, path?: string): Promise<void> {
    this.map = map
    this.source = source
    const urls = source.urls()
    // Loading every tile image up front is fine at corpus scale (a few hundred
    // small files); a virtualised loader belongs with the tileset panel.
    const loaded = await Promise.allSettled(urls.map((url) => Assets.load<Texture>(url)))
    this.textures.clear()
    loaded.forEach((result, i) => {
      const url = urls[i]!
      if (result.status === 'fulfilled') this.textures.set(url, result.value)
    })
    // Animated tiles step through sibling tiles in the same tileset, so the
    // frame list is resolved to global ids once rather than per draw.
    this.animations.clear()
    for (const ref of map.tilesets) {
      for (const tile of ref.tileset?.tiles ?? []) {
        if (!tile.animation || tile.animation.length === 0) continue
        this.animations.set(ref.firstgid + tile.id, {
          gids: tile.animation.map((frame) => ref.firstgid + frame.tileid),
          durations: tile.animation.map((frame) => Math.max(1, frame.duration)),
          total: tile.animation.reduce((sum, frame) => sum + Math.max(1, frame.duration), 0),
        })
      }
    }

    // An atlas tileset packs many tiles into one image, so each gid needs its
    // own cropped view of that image rather than the whole thing.
    this.tileTextures.clear()
    for (const [gid, frame] of source.entries()) {
      const base = this.textures.get(frame.url)
      if (!base) continue
      const wholeImage =
        frame.sx === 0 &&
        frame.sy === 0 &&
        (frame.imageWidth === 0 || frame.sw === frame.imageWidth) &&
        (frame.imageHeight === 0 || frame.sh === frame.imageHeight)
      this.tileTextures.set(
        gid,
        wholeImage
          ? base
          : new Texture({ source: base.source, frame: new Rectangle(frame.sx, frame.sy, frame.sw, frame.sh) }),
      )
    }

    for (const tilemap of this.tilemaps.values()) tilemap.destroy()
    this.tilemaps.clear()
    this.tileLayers.removeChildren()
    this.builtRevision = -1
    this.documentPath = path
  }

  private textureFor(gid: number): Texture | undefined {
    return this.tileTextures.get(tileId(gid))
  }

  /** True when anything in this map declares an animation. */
  get hasAnimations(): boolean {
    return this.animations.size > 0
  }

  /** Resolves an animated tile to the frame showing at this moment. */
  private animatedGid(gid: number, timeMs: number | undefined): number {
    const animation = this.animations.get(tileId(gid))
    if (!animation) return gid
    if (timeMs === undefined) return (animation.gids[0] ?? gid) | (gid & 0xe0000000)
    let remaining = timeMs % animation.total
    for (let i = 0; i < animation.gids.length; i++) {
      remaining -= animation.durations[i]!
      if (remaining < 0) return (animation.gids[i] ?? gid) | (gid & 0xe0000000)
    }
    return (animation.gids[0] ?? gid) | (gid & 0xe0000000)
  }

  /** A signature of every animation's current frame, to spot a needed rebuild. */
  private frameKey(timeMs: number | undefined): string {
    if (this.animations.size === 0) return ''
    const parts: string[] = []
    for (const gid of this.animations.keys()) parts.push(String(this.animatedGid(gid, timeMs)))
    return parts.join(',')
  }

  private borrowSprite(): Sprite {
    const sprite = this.spritePool.pop() ?? new Sprite()
    sprite.visible = true
    return sprite
  }

  private drawTileLayers(options: RenderOptions): void {
    const map = this.map
    if (!map) return
    this.tileLayers.removeChildren()

    for (const layer of walkLayers(map.layers)) {
      if (layer.kind !== 'tilelayer' || !layer.visible) continue
      let tilemap = this.tilemaps.get(layer.id)
      if (!tilemap) {
        tilemap = new CompositeTilemap()
        this.tilemaps.set(layer.id, tilemap)
      }
      tilemap.clear()
      tilemap.alpha = layer.opacity
      tilemap.position.set(layer.offsetx, layer.offsety)

      layer.data.forEach((x, y, rawGid) => {
        const gid = this.animatedGid(rawGid, options.timeMs)
        const texture = this.textureFor(gid)
        if (!texture) return
        const { flipH, flipV, flipD } = parseGid(gid)
        const frame = this.source!.frame(gid)!
        // Tiled anchors oversized tiles at their bottom edge, so a 128px tile
        // on a 128px grid sits flush while a taller one overhangs upward.
        tilemap.tile(texture, x * map.tilewidth, y * map.tileheight - (frame.sh - map.tileheight), {
          tileWidth: frame.sw,
          tileHeight: frame.sh,
          rotate: rotateIndex(flipH, flipV, flipD),
        })
      })
      this.tileLayers.addChild(tilemap)
    }
  }

  /** Tiled colours an object layer through an optional `color` attribute. */
  private layerColor(layer: { extra?: Record<string, unknown> }): number {
    const raw = layer.extra?.color
    if (typeof raw !== 'string') return 0x4fd6bc
    const hex = raw.replace('#', '')
    const rgb = hex.length === 8 ? hex.slice(2) : hex
    const value = Number.parseInt(rgb, 16)
    return Number.isFinite(value) ? value : 0x4fd6bc
  }

  /**
   * Objects without a tile have no pixels of their own, so they are drawn as
   * outlines. The corpus contains none of these, but any map from Tiled can,
   * and an invisible object is worse than an ugly one.
   */
  private drawShape(obj: MapObject, color: number, width: number): void {
    const g = this.shapes
    const w = obj.width
    const h = obj.height
    const radians = (obj.rotation * Math.PI) / 180
    const place = (lx: number, ly: number) => ({
      x: obj.x + lx * Math.cos(radians) - ly * Math.sin(radians),
      y: obj.y + lx * Math.sin(radians) + ly * Math.cos(radians),
    })

    switch (obj.shape) {
      case 'point': {
        g.circle(obj.x, obj.y, width * 3).fill({ color, alpha: 0.8 }).stroke({ color, width })
        return
      }
      case 'polygon':
      case 'polyline': {
        const points = (obj.polygon ?? obj.polyline ?? []).map((p) => place(p.x, p.y))
        if (points.length < 2) return
        g.moveTo(points[0]!.x, points[0]!.y)
        for (const point of points.slice(1)) g.lineTo(point.x, point.y)
        if (obj.shape === 'polygon') {
          g.closePath().fill({ color, alpha: 0.12 })
        }
        g.stroke({ color, width })
        return
      }
      case 'ellipse': {
        // Pixi has no rotated-ellipse primitive, so trace one.
        const steps = 40
        for (let i = 0; i <= steps; i++) {
          const t = (i / steps) * Math.PI * 2
          const point = place((0.5 + Math.cos(t) / 2) * w, (0.5 + Math.sin(t) / 2) * h)
          if (i === 0) g.moveTo(point.x, point.y)
          else g.lineTo(point.x, point.y)
        }
        g.fill({ color, alpha: 0.12 }).stroke({ color, width })
        return
      }
      default: {
        const corners = [place(0, 0), place(w, 0), place(w, h), place(0, h)]
        g.moveTo(corners[0]!.x, corners[0]!.y)
        for (const point of corners.slice(1)) g.lineTo(point.x, point.y)
        g.closePath().fill({ color, alpha: 0.12 }).stroke({ color, width })
      }
    }
  }

  private borrowLabel(): Text {
    const label = this.labelPool.pop() ?? new Text({ text: '', style: { fontSize: 12, fill: 0xe7edec } })
    label.visible = true
    return label
  }

  private drawObjects(options: RenderOptions): void {
    const map = this.map
    if (!map) return
    // Return every sprite to the pool, then re-lease what this frame needs.
    for (const child of this.objectLayer.children) {
      const sprite = child as Sprite
      sprite.visible = false
      this.spritePool.push(sprite)
    }
    this.objectLayer.removeChildren()
    for (const child of this.labels.children) this.labelPool.push(child as Text)
    this.labels.removeChildren()
    this.shapes.clear()
    if (!options.showObjects) return

    const strokeWidth = 2 / options.camera.zoom

    for (const layer of walkLayers(map.layers)) {
      if (layer.kind !== 'objectgroup' || !layer.visible) continue
      const color = this.layerColor(layer)
      const ordered = layer.draworder === 'index' ? layer.objects : [...layer.objects].sort((a, b) => a.y - b.y)
      for (const obj of ordered) {
        if (!obj.visible) continue
        if (obj.gid === undefined) {
          this.drawShape(obj, color, strokeWidth)
          const caption = obj.name || obj.className
          if (caption) {
            const label = this.borrowLabel()
            label.text = caption
            label.style.fontSize = 12 / options.camera.zoom
            label.position.set(obj.x + strokeWidth * 2, obj.y + strokeWidth * 2)
            this.labels.addChild(label)
          }
          if (obj.shape === 'text' && obj.text) {
            const label = this.borrowLabel()
            label.text = obj.text.text
            label.style.fontSize = (obj.text.pixelsize ?? 16)
            label.scale.set(1)
            label.position.set(obj.x, obj.y)
            this.labels.addChild(label)
          }
          continue
        }
        const gid = this.animatedGid(obj.gid, options.timeMs)
        const texture = this.textureFor(gid)
        const frame = this.source?.frame(gid)
        if (!texture || !frame) continue

        const { flipH, flipV } = parseGid(gid)
        const { ax, ay } = tileObjectAnchor(tilesetOf(map, gid))
        const sprite = this.borrowSprite()
        sprite.texture = texture
        sprite.anchor.set(0, 0)
        sprite.alpha = layer.opacity

        const w = obj.width || frame.sw
        const h = obj.height || frame.sh
        const sx = (w / frame.sw) * (flipH ? -1 : 1)
        const sy = (h / frame.sh) * (flipV ? -1 : 1)
        sprite.scale.set(sx, sy)

        // The object's box in its own space, before rotation: the anchor tells
        // us where (obj.x, obj.y) sits inside it.
        const left = -ax * w
        const top = -ay * h
        // A negative scale draws away from the sprite's origin, so the origin
        // moves to the opposite edge of the box.
        const localX = flipH ? left + w : left
        const localY = flipV ? top + h : top

        const radians = (obj.rotation * Math.PI) / 180
        const cos = Math.cos(radians)
        const sin = Math.sin(radians)
        sprite.position.set(
          obj.x + localX * cos - localY * sin,
          obj.y + localX * sin + localY * cos,
        )
        sprite.rotation = radians
        this.objectLayer.addChild(sprite)
      }
    }
  }

  private drawGrid(options: RenderOptions): void {
    const map = this.map
    if (!map) return
    this.grid.clear()
    this.background.clear()
    const w = map.width * map.tilewidth
    const h = map.height * map.tileheight
    this.background.rect(0, 0, w, h).fill({ color: 0x0b1112, alpha: 0.85 })
    const width = 1 / options.camera.zoom
    // The map's own edge is always worth showing, grid or not.
    this.grid.rect(0, 0, w, h).stroke({ color: 0x4fd6bc, width: width * 1.5, alpha: 0.5 })
    if (!options.showGrid) return

    // A grid drawn at full strength over 16-pixel tiles washes the artwork out,
    // so it fades in as cells grow and disappears once they are too small to
    // aim at anyway.
    const cellPixels = Math.min(map.tilewidth, map.tileheight) * options.camera.zoom
    const alpha = Math.max(0, Math.min(1, (cellPixels - 10) / 26)) * 0.4
    if (alpha <= 0.01) return

    // Only the visible slice is worth drawing: a 200x200 map would otherwise
    // rebuild 400 line segments on every frame of a zoom.
    const view = this.app?.screen
    const left = view ? Math.max(0, Math.floor(-options.camera.x / options.camera.zoom / map.tilewidth)) : 0
    const top = view ? Math.max(0, Math.floor(-options.camera.y / options.camera.zoom / map.tileheight)) : 0
    const right = view
      ? Math.min(map.width, Math.ceil((view.width - options.camera.x) / options.camera.zoom / map.tilewidth) + 1)
      : map.width
    const bottom = view
      ? Math.min(map.height, Math.ceil((view.height - options.camera.y) / options.camera.zoom / map.tileheight) + 1)
      : map.height

    for (let x = left; x <= right; x++) {
      this.grid.moveTo(x * map.tilewidth, top * map.tileheight).lineTo(x * map.tilewidth, bottom * map.tileheight)
    }
    for (let y = top; y <= bottom; y++) {
      this.grid.moveTo(left * map.tilewidth, y * map.tileheight).lineTo(right * map.tilewidth, y * map.tileheight)
    }
    this.grid.stroke({ color: 0x000000, width, alpha })
  }

  private drawOverlay(options: RenderOptions): void {
    const map = this.map
    if (!map) return
    this.overlay.clear()
    const line = 2 / options.camera.zoom

    if (options.hover) {
      const stamp = options.hoverStamp
      const w = (stamp?.width ?? 1) * map.tilewidth
      const h = (stamp?.height ?? 1) * map.tileheight
      this.overlay
        .rect(options.hover.x * map.tilewidth, options.hover.y * map.tileheight, w, h)
        .stroke({ color: 0x4fd6bc, width: line, alpha: 0.9 })
    }

    if (options.marquee) {
      const { x0, y0, x1, y1 } = options.marquee
      const left = Math.min(x0, x1) * map.tilewidth
      const top = Math.min(y0, y1) * map.tileheight
      const width = (Math.abs(x1 - x0) + 1) * map.tilewidth
      const height = (Math.abs(y1 - y0) + 1) * map.tileheight
      this.overlay
        .rect(left, top, width, height)
        .fill({ color: 0x4fd6bc, alpha: 0.12 })
        .stroke({ color: 0x4fd6bc, width: line })
    }

    if (options.selectedObjectIds.length > 0) {
      const selected = new Set(options.selectedObjectIds)
      for (const layer of walkLayers(map.layers)) {
        if (layer.kind !== 'objectgroup') continue
        for (const obj of layer.objects) {
          if (!selected.has(obj.id)) continue
          this.strokeObjectBox(obj, line)
        }
      }
    }
  }

  /** Traces an object's box through its own rotation and anchor. */
  private objectCorners(obj: MapObject): { x: number; y: number }[] {
    const map = this.map!
    const { ax, ay } =
      obj.gid !== undefined ? tileObjectAnchor(tilesetOf(map, obj.gid)) : { ax: 0, ay: 0 }
    const w = obj.width || map.tilewidth
    const h = obj.height || map.tileheight
    const left = -ax * w
    const top = -ay * h
    const radians = (obj.rotation * Math.PI) / 180
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    return [
      [left, top],
      [left + w, top],
      [left + w, top + h],
      [left, top + h],
    ].map(([lx, ly]) => ({
      x: obj.x + lx! * cos - ly! * sin,
      y: obj.y + lx! * sin + ly! * cos,
    }))
  }

  private strokeObjectBox(obj: MapObject, width: number): void {
    const corners = this.objectCorners(obj)
    const first = corners[0]!
    this.overlay.moveTo(first.x, first.y)
    for (const point of corners.slice(1)) this.overlay.lineTo(point.x, point.y)
    this.overlay
      .closePath()
      .stroke({ color: 0x4fd6bc, width })
    for (const point of corners) {
      this.overlay.circle(point.x, point.y, width * 2.5).fill({ color: 0x4fd6bc })
    }
  }

  hitTestObject(layer: Layer, worldX: number, worldY: number): MapObject | undefined {
    if (layer.kind !== 'objectgroup' || !this.map) return undefined
    // Topmost first, matching what the user sees.
    for (let i = layer.objects.length - 1; i >= 0; i--) {
      const obj = layer.objects[i]!
      if (!obj.visible) continue
      if (obj.shape === 'point') {
        if (Math.hypot(worldX - obj.x, worldY - obj.y) <= this.map.tilewidth / 3) return obj
        continue
      }
      const outline = obj.polygon ?? obj.polyline
      if (outline && outline.length >= 3) {
        const radians = (obj.rotation * Math.PI) / 180
        const points = outline.map((p) => ({
          x: obj.x + p.x * Math.cos(radians) - p.y * Math.sin(radians),
          y: obj.y + p.x * Math.sin(radians) + p.y * Math.cos(radians),
        }))
        if (pointInPolygon(worldX, worldY, points)) return obj
        continue
      }
      if (pointInPolygon(worldX, worldY, this.objectCorners(obj))) return obj
    }
    return undefined
  }

  /** Wall time of the last draw, in milliseconds. Read by scripts/bench.mjs. */
  lastDrawMs = 0
  /** Draws since the renderer was created, for spotting redundant repaints. */
  drawCount = 0

  draw(options: RenderOptions): void {
    if (!this.app || !this.ready || !this.map) return
    const started = performance.now()
    const { camera } = options
    this.world.position.set(camera.x, camera.y)
    this.world.scale.set(camera.zoom)
    this.drawGrid(options)
    // Tile and object geometry depends only on the document, plus whichever
    // animation frame is showing. Rebuilding it for a pan or zoom cost 156 ms
    // a frame on a 50x50 map before this check.
    const frameKey = this.frameKey(options.timeMs)
    if (options.revision !== this.builtRevision || frameKey !== this.builtFrameKey) {
      this.drawTileLayers(options)
      this.drawObjects(options)
      this.builtRevision = options.revision
      this.builtFrameKey = frameKey
    }
    this.drawOverlay(options)
    this.app.render()
    this.lastDrawMs = performance.now() - started
    this.drawCount++
  }

  toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.app?.canvas.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    const local = this.world.worldTransform.applyInverse({
      x: clientX - rect.left,
      y: clientY - rect.top,
    })
    return { x: local.x, y: local.y }
  }

  toScreen(x: number, y: number): { x: number; y: number } {
    const point = this.world.worldTransform.apply({ x, y })
    return { x: point.x, y: point.y }
  }

  destroy(): void {
    for (const tilemap of this.tilemaps.values()) tilemap.destroy()
    this.tilemaps.clear()
    this.app?.destroy(true, { children: true })
    this.app = undefined
    this.ready = false
  }
}

function pointInPolygon(x: number, y: number, points: { x: number; y: number }[]): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!
    const b = points[j]!
    const intersects = a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
    if (intersects) inside = !inside
  }
  return inside
}

export async function createRenderer(): Promise<PixiTileRenderer> {
  const renderer = new PixiTileRenderer()
  await renderer.init()
  return renderer
}
