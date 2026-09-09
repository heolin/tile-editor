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

  constructor(width: number, height: number, cells?: Uint32Array) {
    this.bounds = { x: 0, y: 0, width, height }
    this.cells = cells ?? new Uint32Array(width * height)
  }

  static fromArray(width: number, height: number, data: readonly number[]): DenseLayerData {
    const cells = new Uint32Array(width * height)
    const n = Math.min(cells.length, data.length)
    for (let i = 0; i < n; i++) cells[i] = (data[i] ?? 0) >>> 0
    return new DenseLayerData(width, height, cells)
  }

  private index(x: number, y: number): number {
    return y * this.bounds.width + x
  }

  private inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.bounds.width && y < this.bounds.height
  }

  get(x: number, y: number): number {
    return this.inside(x, y) ? this.cells[this.index(x, y)]! : 0
  }

  set(x: number, y: number, gid: number): void {
    if (this.inside(x, y)) this.cells[this.index(x, y)] = gid >>> 0
  }

  clone(): DenseLayerData {
    return new DenseLayerData(this.bounds.width, this.bounds.height, new Uint32Array(this.cells))
  }

  forEach(fn: (x: number, y: number, gid: number) => void): void {
    const { width, height } = this.bounds
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const gid = this.cells[y * width + x]!
        if (gid !== 0) fn(x, y, gid)
      }
    }
  }

  toArray(): number[] {
    return Array.from(this.cells)
  }

  /** Resizes in place-ish, returning a new buffer with content anchored at 0,0. */
  resized(width: number, height: number): DenseLayerData {
    const next = new DenseLayerData(width, height)
    const w = Math.min(width, this.bounds.width)
    const h = Math.min(height, this.bounds.height)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) next.set(x, y, this.get(x, y))
    }
    return next
  }
}
