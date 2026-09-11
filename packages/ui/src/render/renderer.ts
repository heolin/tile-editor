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
  /**
   * Bumped whenever the document changes. Panning and zooming leave it alone,
   * which lets the renderer keep the tile geometry it already built.
   */
  revision: number
  /** Milliseconds for animated tiles. Omit to hold every animation at frame 0. */
  timeMs?: number
  showGrid: boolean
  showObjects: boolean
  activeLayerId?: number
  /** Tile under the pointer, highlighted with the current stamp. */
  hover?: { x: number; y: number }
  hoverStamp?: Stamp
  selectedObjectIds: readonly number[]
  /** Suppressed while a drag is in progress, so handles do not chase the pointer. */
  showHandles?: boolean
  /** Rubber band for selecting objects, in world coordinates. */
  selectionRect?: { x0: number; y0: number; x1: number; y1: number }
  /** Rectangle being dragged out by the rectangle tool, in tile coordinates. */
  marquee?: { x0: number; y0: number; x1: number; y1: number }
  /** The standing tile selection, in tile coordinates. Masks every tile tool. */
  tileSelection?: { x: number; y: number; width: number; height: number }
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
