import type { RacingLineData } from '../track/types';

/** A sampled point on the racing line: where it is and which way it points. */
export interface LineSample {
  index: number;
  progress: number; // 0..1 around the lap, 0 = finish line
  x: number;
  y: number;
  headingRad: number;
}

/** Half-width of the windowed nearest-point search (in points). */
const SEARCH_WINDOW = 24;

/**
 * The baked racing line (road centreline) for one track: a closed list of
 * points at uniform arc-length spacing, `points[0]` sitting on the finish line.
 * Uniform spacing is what makes the cheap operations cheap — progress is
 * index / count, and "N px further along" is an index offset.
 *
 * Produced by tools/track-mesh/racing_line.py → games/racing/trackN.path.json.
 */
export class RacingLine {
  readonly count: number;
  readonly length: number;
  readonly spacing: number;
  private readonly xs: Float32Array;
  private readonly ys: Float32Array;

  constructor(data: RacingLineData) {
    this.count = data.points.length;
    this.length = data.length;
    this.spacing = data.spacing;
    this.xs = new Float32Array(this.count);
    this.ys = new Float32Array(this.count);
    data.points.forEach(([x, y], i) => {
      this.xs[i] = x;
      this.ys[i] = y;
    });
  }

  /**
   * Index of the closest line point to (x, y). With a `hint` (the caller's
   * previous result) only a window around it is scanned; if the best sits on the
   * window edge the car has jumped, so fall back to a full scan.
   */
  nearestIndex(x: number, y: number, hint?: number): number {
    if (hint === undefined) return this.scan(x, y, 0, this.count);
    const best = this.scan(x, y, hint - SEARCH_WINDOW, 2 * SEARCH_WINDOW + 1);
    const off = Math.abs(this.wrapDelta(best - hint));
    return off >= SEARCH_WINDOW ? this.scan(x, y, 0, this.count) : best;
  }

  /** Position + tangent heading at a point index. */
  sample(index: number): LineSample {
    const i = this.wrap(index);
    const a = this.wrap(i - 1);
    const b = this.wrap(i + 1);
    return {
      index: i,
      progress: i / this.count,
      x: this.xs[i],
      y: this.ys[i],
      headingRad: Math.atan2(this.ys[b] - this.ys[a], this.xs[b] - this.xs[a]),
    };
  }

  /** Sample at a lap fraction (wraps, so −0.05 is 5% back from the line). */
  at(progress: number): LineSample {
    const p = progress - Math.floor(progress);
    return this.sample(Math.round(p * this.count));
  }

  /** Index `distancePx` further along the line (negative = backwards). */
  advance(index: number, distancePx: number): number {
    return this.wrap(index + Math.round(distancePx / this.spacing));
  }

  /** Signed distance from the line at `index`: + right of it, − left. */
  lateralOffset(x: number, y: number, index: number): number {
    const s = this.sample(index);
    const nx = -Math.sin(s.headingRad); // line normal, pointing right of travel
    const ny = Math.cos(s.headingRad);
    return (x - s.x) * nx + (y - s.y) * ny;
  }

  /** Shortest signed index difference a→b around the loop. */
  wrapDelta(delta: number): number {
    const half = this.count / 2;
    let d = delta % this.count;
    if (d > half) d -= this.count;
    else if (d < -half) d += this.count;
    return d;
  }

  wrap(index: number): number {
    return ((index % this.count) + this.count) % this.count;
  }

  pointAt(index: number): { x: number; y: number } {
    const i = this.wrap(index);
    return { x: this.xs[i], y: this.ys[i] };
  }

  private scan(x: number, y: number, from: number, span: number): number {
    let best = 0;
    let bd = Infinity;
    for (let k = 0; k < span; k++) {
      const i = this.wrap(from + k);
      const dx = this.xs[i] - x;
      const dy = this.ys[i] - y;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }
}
