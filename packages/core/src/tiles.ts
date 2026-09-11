import type { SetTilesCommand } from './commands.js'
import type { TileLayer } from './model.js'

/** A rectangular block of tiles, lifted from a tileset or from the map. */
export interface Stamp {
  width: number
  height: number
  gids: number[]
}

/**
 * A rectangle of cells on a tile layer, in tile coordinates. Identical in shape
 * to `Bounds`, but it means something different: what the user picked out, not
 * how far the layer reaches.
 */
export interface TileRegion {
  x: number
  y: number
  width: number
  height: number
}

/** Builds a region from two dragged corners, both of them inclusive. */
export function regionFromCorners(x0: number, y0: number, x1: number, y1: number): TileRegion {
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    width: Math.abs(x1 - x0) + 1,
    height: Math.abs(y1 - y0) + 1,
  }
}

export function regionContains(region: TileRegion, x: number, y: number): boolean {
  return x >= region.x && y >= region.y && x < region.x + region.width && y < region.y + region.height
}

/** The region trimmed to what the layer actually covers, or nothing left of it. */
export function clampRegion(region: TileRegion, layer: TileLayer): TileRegion | undefined {
  const b = layer.data.bounds
  const left = Math.max(region.x, b.x)
  const top = Math.max(region.y, b.y)
  const right = Math.min(region.x + region.width, b.x + b.width)
  const bottom = Math.min(region.y + region.height, b.y + b.height)
  if (right <= left || bottom <= top) return undefined
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** Reads a rectangle out of a tile layer as a reusable stamp. */
export function captureRegion(layer: TileLayer, region: TileRegion): Stamp {
  const gids: number[] = []
  for (let y = 0; y < region.height; y++) {
    for (let x = 0; x < region.width; x++) gids.push(layer.data.get(region.x + x, region.y + y))
  }
  return { width: region.width, height: region.height, gids }
}

/** Applies a stamp at a map position, respecting its footprint. */
export function paintStamp(command: SetTilesCommand, stamp: Stamp, x: number, y: number): void {
  for (let dy = 0; dy < stamp.height; dy++) {
    for (let dx = 0; dx < stamp.width; dx++) {
      command.add(x + dx, y + dy, stamp.gids[dy * stamp.width + dx] ?? 0)
    }
  }
}

/** Writes one gid across a whole region; `0` erases it. */
export function fillRegion(command: SetTilesCommand, region: TileRegion, gid: number): void {
  for (let y = 0; y < region.height; y++) {
    for (let x = 0; x < region.width; x++) command.add(region.x + x, region.y + y, gid)
  }
}

/** Four-way flood fill bounded by the layer. */
export function floodFill(
  layer: TileLayer,
  x: number,
  y: number,
  gid: number,
  command: SetTilesCommand,
): void {
  const target = layer.data.get(x, y)
  if (target === gid) return
  const { x: ox, y: oy, width, height } = layer.data.bounds
  const seen = new Uint8Array(width * height)
  const index = (cx: number, cy: number) => (cy - oy) * width + (cx - ox)
  const queue: number[] = [index(x, y)]
  seen[index(x, y)] = 1
  while (queue.length > 0) {
    const at = queue.pop()!
    const cx = ox + (at % width)
    const cy = oy + Math.floor(at / width)
    if (layer.data.get(cx, cy) !== target) continue
    command.add(cx, cy, gid)
    const neighbours = [
      [cx - 1, cy],
      [cx + 1, cy],
      [cx, cy - 1],
      [cx, cy + 1],
    ] as const
    for (const [nx, ny] of neighbours) {
      if (nx < ox || ny < oy || nx >= ox + width || ny >= oy + height) continue
      const ni = index(nx, ny)
      if (seen[ni]) continue
      seen[ni] = 1
      queue.push(ni)
    }
  }
}
