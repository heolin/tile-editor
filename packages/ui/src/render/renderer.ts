import type { Layer, MapObject, TileMap } from '@tile-editor/core'
import type { TileSourceIndex } from './tile-source'

export interface Camera {
  x: number
  y: number
  zoom: number
}

export interface Stamp {
  width: number
  height: number
  gids: number[]
}

export interface RenderOptions {
  camera: Camera
  showGrid: boolean
  showObjects: boolean
  activeLayerId?: number
  /** Tile under the pointer, highlighted with the current stamp. */
  hover?: { x: number; y: number }
  hoverStamp?: Stamp
  selectedObjectIds: readonly number[]
  /** Rectangle being dragged out by the rectangle tool, in tile coordinates. */
  marquee?: { x0: number; y0: number; x1: number; y1: number }
}

/**
 * The canvas backend sits behind this interface from the first commit, so the
 * PixiJS implementation can be swapped for a hand-written WebGL2 renderer
 * without touching a single tool (docs/PLAN.md section 3).
 */
export interface TileRenderer {
  mount(host: HTMLElement): void
  setDocument(map: TileMap, source: TileSourceIndex): Promise<void>
  draw(options: RenderOptions): void
  resize(): void
  /** Screen pixels to map pixels. */
  toWorld(clientX: number, clientY: number): { x: number; y: number }
  /** Map pixels to screen pixels. */
  toScreen(x: number, y: number): { x: number; y: number }
  /** The object whose drawn shape contains this world point, topmost first. */
  hitTestObject(layer: Layer, worldX: number, worldY: number): MapObject | undefined
  destroy(): void
}
