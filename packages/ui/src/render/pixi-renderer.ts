import { Application, Assets, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js'
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
    this.world.addChild(this.background, this.tileLayers, this.grid, this.objectLayer, this.overlay)
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

  async setDocument(map: TileMap, source: TileSourceIndex): Promise<void> {
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
  }

  private textureFor(gid: number): Texture | undefined {
    return this.tileTextures.get(tileId(gid))
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

      layer.data.forEach((x, y, gid) => {
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
    if (!options.showObjects) return

    for (const layer of walkLayers(map.layers)) {
      if (layer.kind !== 'objectgroup' || !layer.visible) continue
      const ordered = layer.draworder === 'index' ? layer.objects : [...layer.objects].sort((a, b) => a.y - b.y)
      for (const obj of ordered) {
        if (!obj.visible || obj.gid === undefined) continue
        const texture = this.textureFor(obj.gid)
        const frame = this.source?.frame(obj.gid)
        if (!texture || !frame) continue

        const { flipH, flipV } = parseGid(obj.gid)
        const { ax, ay } = tileObjectAnchor(tilesetOf(map, obj.gid))
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
    if (!options.showGrid) return
    // Below roughly four screen pixels per cell the grid becomes noise.
    const step = map.tilewidth * options.camera.zoom < 4 ? 0 : 1
    if (step === 0) return
    const width = 1 / options.camera.zoom
    for (let x = 0; x <= map.width; x++) {
      this.grid.moveTo(x * map.tilewidth, 0).lineTo(x * map.tilewidth, h)
    }
    for (let y = 0; y <= map.height; y++) {
      this.grid.moveTo(0, y * map.tileheight).lineTo(w, y * map.tileheight)
    }
    this.grid.stroke({ color: 0x33443f, width, alpha: 0.7 })
    this.grid.rect(0, 0, w, h).stroke({ color: 0x4fd6bc, width: width * 1.5, alpha: 0.5 })
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
      if (pointInPolygon(worldX, worldY, this.objectCorners(obj))) return obj
    }
    return undefined
  }

  draw(options: RenderOptions): void {
    if (!this.app || !this.ready || !this.map) return
    const { camera } = options
    this.world.position.set(camera.x, camera.y)
    this.world.scale.set(camera.zoom)
    this.drawGrid(options)
    this.drawTileLayers(options)
    this.drawObjects(options)
    this.drawOverlay(options)
    this.app.render()
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
