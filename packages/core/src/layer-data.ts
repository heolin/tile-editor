/**
 * Tile storage sits behind an interface from day one so that a chunked
 * implementation can be added when maps outgrow a dense array, without the
 * tools, renderer or codecs noticing. See docs/PLAN.md section 5.3.
 */
export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** Tiled's default chunk size for infinite maps. */
export const CHUNK_SIZE = 16

export interface Chunk {
  x: number
  y: number
  width: number
  height: number
  gids: number[]
}

/**
 * Splits dense data into the chunks an infinite map stores, dropping any chunk
 * that is entirely empty - which is the whole point of chunking.
 */
export function toChunks(data: LayerData, size = CHUNK_SIZE): Chunk[] {
  const { x: ox, y: oy, width, height } = data.bounds
  const startX = Math.floor(ox / size) * size
  const startY = Math.floor(oy / size) * size
  const chunks: Chunk[] = []
  for (let cy = startY; cy < oy + height; cy += size) {
    for (let cx = startX; cx < ox + width; cx += size) {
      const gids: number[] = []
      let empty = true
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const gid = data.get(cx + x, cy + y)
          if (gid !== 0) empty = false
          gids.push(gid)
        }
      }
      if (!empty) chunks.push({ x: cx, y: cy, width: size, height: size, gids })
    }
  }
  return chunks
}

/** Rebuilds a dense layer covering the union of the chunks. */
export function fromChunks(chunks: Chunk[]): DenseLayerData {
  if (chunks.length === 0) return new DenseLayerData(0, 0)
  const minX = Math.min(...chunks.map((c) => c.x))
  const minY = Math.min(...chunks.map((c) => c.y))
  const maxX = Math.max(...chunks.map((c) => c.x + c.width))
  const maxY = Math.max(...chunks.map((c) => c.y + c.height))
  const data = new DenseLayerData(maxX - minX, maxY - minY, undefined, minX, minY)
  for (const chunk of chunks) {
    for (let y = 0; y < chunk.height; y++) {
      for (let x = 0; x < chunk.width; x++) {
        const gid = chunk.gids[y * chunk.width + x] ?? 0
        if (gid !== 0) data.set(chunk.x + x, chunk.y + y, gid)
      }
    }
  }
  return data
}

export interface LayerData {
  readonly bounds: Bounds
  get(x: number, y: number): number
  set(x: number, y: number, gid: number): void
  clone(): LayerData
  /** Visits every non-empty cell. */
  forEach(fn: (x: number, y: number, gid: number) => void): void
  toArray(): number[]
}

export class DenseLayerData implements LayerData {
  readonly bounds: Bounds
  readonly cells: Uint32Array

  /**
   * `originX`/`originY` are non-zero only for infinite maps, whose layers cover
   * an arbitrary rectangle rather than starting at the origin.
   */
  constructor(width: number, height: number, cells?: Uint32Array, originX = 0, originY = 0) {
    this.bounds = { x: originX, y: originY, width, height }
    this.cells = cells ?? new Uint32Array(width * height)
  }

  static fromArray(
    width: number,
    height: number,
    data: readonly number[],
    originX = 0,
    originY = 0,
  ): DenseLayerData {
    const cells = new Uint32Array(width * height)
    const n = Math.min(cells.length, data.length)
    for (let i = 0; i < n; i++) cells[i] = (data[i] ?? 0) >>> 0
    return new DenseLayerData(width, height, cells, originX, originY)
  }

  private index(x: number, y: number): number {
    return (y - this.bounds.y) * this.bounds.width + (x - this.bounds.x)
  }

  private inside(x: number, y: number): boolean {
    return (
      x >= this.bounds.x &&
      y >= this.bounds.y &&
      x < this.bounds.x + this.bounds.width &&
      y < this.bounds.y + this.bounds.height
    )
  }

  get(x: number, y: number): number {
    return this.inside(x, y) ? this.cells[this.index(x, y)]! : 0
  }

  set(x: number, y: number, gid: number): void {
    if (this.inside(x, y)) this.cells[this.index(x, y)] = gid >>> 0
  }

  clone(): DenseLayerData {
    return new DenseLayerData(
      this.bounds.width,
      this.bounds.height,
      new Uint32Array(this.cells),
      this.bounds.x,
      this.bounds.y,
    )
  }

  forEach(fn: (x: number, y: number, gid: number) => void): void {
    const { x: ox, y: oy, width, height } = this.bounds
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const gid = this.cells[row * width + col]!
        if (gid !== 0) fn(ox + col, oy + row, gid)
      }
    }
  }

  toArray(): number[] {
    return Array.from(this.cells)
  }

  /** Returns a new buffer of the given size with content anchored at the origin. */
  resized(width: number, height: number): DenseLayerData {
    const next = new DenseLayerData(width, height, undefined, this.bounds.x, this.bounds.y)
    const w = Math.min(width, this.bounds.width)
    const h = Math.min(height, this.bounds.height)
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        next.set(this.bounds.x + col, this.bounds.y + row, this.get(this.bounds.x + col, this.bounds.y + row))
      }
    }
    return next
  }
}
