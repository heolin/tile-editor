import { RACE, TILE } from '../constants';
import type { RaceResult } from '../race-series';
import type { Car } from '../entities/car';
import type { TrackAnalysis } from './track-analyzer';

interface Pt {
  x: number;
  y: number;
}

interface CarState {
  prevX: number; // last frame position (for finish-gate crossing)
  prevY: number;
  prevProg: number; // last progress fraction (0..1) around the loop
  net: number; // signed accumulated revolutions (anti-cheat + direction)
  dir: number; // +1/−1 once the driving direction is known
  lapMarkFwd: number; // forward progress at the last counted lap (or gun)
  lap: number; // completed laps
  finished: boolean;
  finishMs: number;
}

/**
 * Laps are counted at an actual geometric crossing of a FINISH GATE — a line
 * perpendicular to the road at the start-cell centre — so a lap ticks over
 * exactly at the finish line, not a tile or two early when the car merely
 * enters the start tile. Loop PROGRESS (nearest loop cell, accumulated with
 * sign) is kept only as an anti-cheat guard: a crossing counts only after a
 * near-full forward revolution since the last lap, so jitter on the line,
 * reversing back over it, or cutting the course can't score a lap. The car
 * spawns behind the gate, so its first (gun) crossing has ~0 net progress and
 * is correctly ignored.
 */
export class RaceManager {
  private centers: Pt[];
  private gateA: Pt;
  private gateB: Pt;
  private forward: Pt;
  private states: CarState[];
  private startMs = 0;
  private finishOrder: number[] = [];

  constructor(
    analysis: TrackAnalysis,
    private laps: number,
    count: number,
  ) {
    this.centers = analysis.loop.map((c) => ({ x: c.col * TILE + TILE / 2, y: c.row * TILE + TILE / 2 }));

    // Finish gate: perpendicular to the road through the start-cell centre,
    // stretched ±1.5 tiles so it spans multi-lane roads (overshoot into grass
    // is harmless — cars can't drive there). Vertical road → horizontal gate.
    const sc = analysis.startCell;
    const c = { x: sc.col * TILE + TILE / 2, y: sc.row * TILE + TILE / 2 };
    const HALF = 0.7 * TILE; // spans the road strip, but not a neighbouring road
    if (analysis.axis === 'vertical') {
      this.gateA = { x: c.x - HALF, y: c.y };
      this.gateB = { x: c.x + HALF, y: c.y };
    } else {
      this.gateA = { x: c.x, y: c.y - HALF };
      this.gateB = { x: c.x, y: c.y + HALF };
    }
    this.forward = analysis.forward;

    this.states = Array.from({ length: count }, () => ({
      prevX: 0,
      prevY: 0,
      prevProg: 0,
      net: 0,
      dir: 0,
      lapMarkFwd: 0,
      lap: 0,
      finished: false,
      finishMs: 0,
    }));
  }

  start(nowMs: number, cars: Car[]): void {
    this.startMs = nowMs;
    cars.forEach((car, i) => {
      const s = this.states[i];
      s.prevX = car.x;
      s.prevY = car.y;
      s.prevProg = this.nearestProgress(car.x, car.y);
      s.net = 0;
      s.dir = 0;
      s.lapMarkFwd = 0;
      s.lap = 0;
    });
  }

  update(nowMs: number, cars: Car[]): void {
    cars.forEach((car, i) => {
      const s = this.states[i];
      if (s.finished) return;

      // Mid-swap: an animation owns this car's position, and it is sweeping
      // across the track rather than driving. Track `prev` so no later segment
      // spans the jump, but test nothing — a swap whose path happens to cross
      // the finish gate would otherwise bank a lap nobody drove.
      if (car.isSuspended) {
        s.prevX = car.x;
        s.prevY = car.y;
        return;
      }

      // Accumulate signed loop progress (direction + anti-cheat guard).
      const p = this.nearestProgress(car.x, car.y);
      let d = p - s.prevProg;
      if (d > 0.5) d -= 1;
      else if (d < -0.5) d += 1;
      s.net += d;
      s.prevProg = p;
      if (s.dir === 0 && Math.abs(s.net) > 0.2) s.dir = Math.sign(s.net);
      const netFwd = s.dir !== 0 ? s.net * s.dir : 0;

      // Count a lap only on a genuine forward crossing of the finish gate that
      // is backed by ~a full loop of progress since the last one.
      if (
        netFwd - s.lapMarkFwd > 0.7 &&
        this.crossedGateForward(s.prevX, s.prevY, car.x, car.y)
      ) {
        s.lap += 1;
        s.lapMarkFwd = netFwd;
        if (s.lap >= this.laps) {
          s.finished = true;
          s.finishMs = nowMs - this.startMs;
          this.finishOrder.push(i);
          car.setFinished();
        }
      }

      s.prevX = car.x;
      s.prevY = car.y;
    });
  }

  /**
   * A car was moved without driving there (the rewind). Only `prev` moves, so no
   * gate-crossing test spans the jump. `prevProg` is deliberately left alone:
   * next frame's progress delta then subtracts the ground the car was sent back
   * over, exactly as if it had reversed there — so a rewind costs real lap
   * progress and can't be used to shortcut the near-full-revolution lap guard.
   */
  notifyTeleport(i: number, x: number, y: number): void {
    const s = this.states[i];
    s.prevX = x;
    s.prevY = y;
  }

  /**
   * A car was moved somewhere else on the track and **keeps its own lap count** —
   * the replace powerup.
   *
   * `lap` is untouched — that is the point. What moves is the reference the next
   * lap is measured from: `prevProg` re-anchors to where the car now stands, and
   * `lapMarkFwd` to its current progress, so **the driver keeps their lap number
   * and drives a full loop from wherever they land to score the next one.**
   *
   * Re-anchoring `lapMarkFwd` is not optional. Leaving it alone looks neutral and
   * is not: a driver swapped forward keeps a lap mark set from their old
   * position, so their next gate crossing arrives with only `1 − jump` of a
   * revolution behind it. Measured against the `> 0.7` guard below, a forward
   * jump of 0.3 of a lap lands exactly on the threshold — so whether the powerup
   * hands out a free lap depends on how far the two cars happened to be apart.
   * With the mark moved, both directions cost exactly one loop and neither can
   * skip one.
   *
   * Contrast `notifyTeleport`, which the rewind uses: that one deliberately
   * leaves `prevProg` alone so the ground sent back over has to be re-driven.
   */
  notifySwap(i: number, x: number, y: number): void {
    const s = this.states[i];
    if (!s) return;
    s.prevX = x;
    s.prevY = y;
    s.prevProg = this.nearestProgress(x, y);
    s.lapMarkFwd = s.dir !== 0 ? s.net * s.dir : 0;
  }

  /** Current lap number to display (1-based, capped at total). */
  displayLap(i: number): number {
    return Math.min(this.states[i].lap + 1, this.laps);
  }

  /** Per-car lap tuning read: completed laps + forward progress this lap. */
  debugState(i: number): { lap: number; netFwd: number } {
    const s = this.states[i];
    return { lap: s.lap, netFwd: s.dir !== 0 ? s.net * s.dir : 0 };
  }

  isFinished(i: number): boolean {
    return this.states[i].finished;
  }

  allFinished(): boolean {
    return this.states.every((s) => s.finished);
  }

  results(): RaceResult[] {
    const res: RaceResult[] = [];
    let place = 1;
    for (const i of this.finishOrder) {
      res.push({ playerIndex: i, finished: true, timeMs: this.states[i].finishMs, place: place++ });
    }
    const dnf = this.states
      .map((s, i) => ({ s, i }))
      .filter((x) => !x.s.finished)
      .sort((a, b) => b.s.dir * b.s.net - a.s.dir * a.s.net);
    for (const { i } of dnf) {
      res.push({ playerIndex: i, finished: false, timeMs: this.laps * RACE.LAP_MS, place: place++ });
    }
    return res;
  }

  /** True if the segment prev→cur crosses the finish gate moving forward. */
  private crossedGateForward(px: number, py: number, x: number, y: number): boolean {
    if ((x - px) * this.forward.x + (y - py) * this.forward.y <= 0) return false;
    return segmentsIntersect(px, py, x, y, this.gateA.x, this.gateA.y, this.gateB.x, this.gateB.y);
  }

  private nearestProgress(x: number, y: number): number {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < this.centers.length; i++) {
      const dx = this.centers[i].x - x;
      const dy = this.centers[i].y - y;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return this.centers.length > 0 ? best / this.centers.length : 0;
  }
}

/** Do segments (p1→p2) and (p3→p4) intersect? Standard orientation test. */
function segmentsIntersect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  x4: number,
  y4: number,
): boolean {
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (d === 0) return false; // parallel
  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / d;
  const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / d;
  return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
}
