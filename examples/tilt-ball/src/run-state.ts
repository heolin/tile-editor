import type { BallState } from './entities/ball';
import type { LevelSpec, LockColour } from './level/types';

/**
 * The live state of the level being played, shared between the play scene that
 * writes it and the HUD scene that draws it.
 *
 * A plain object rather than events: the HUD redraws every frame anyway (four
 * clocks are always running), so an event per change would be more moving parts
 * for the same picture. It is created once per game and RESET per level, so the
 * HUD keeps its reference across a story restart — which restarts the play
 * scene, and would otherwise leave the HUD holding a dead object.
 */
export interface SeatRun {
  seat: number;
  state: BallState;
  /** Time at the goal, ms. Null while still trying. */
  finishedAtMs: number | null;
  deaths: number;
}

export class RunState {
  levelTitle = '';
  /** "2/4" in a versus series; null in story, which is one level on its own. */
  seriesLabel: string | null = null;
  /** Milliseconds since the countdown ended. */
  elapsedMs = 0;
  running = false;
  seats: SeatRun[] = [];
  /** Lock colours this level uses, and which of them have been opened. */
  locksNeeded: LockColour[] = [];
  locksOpened: LockColour[] = [];
  /** Set by the play scene; called by the HUD when its countdown finishes. */
  startRun: () => void = () => {};
  /** Countdown to the end of the level once someone is home, ms. Null = none. */
  finishWindowMs: number | null = null;

  reset(level: LevelSpec, seatCount: number, seriesLabel: string | null): void {
    this.levelTitle = level.title;
    this.seriesLabel = seriesLabel;
    this.elapsedMs = 0;
    this.running = false;
    this.finishWindowMs = null;
    this.locksOpened = [];
    this.locksNeeded = [];
    this.seats = Array.from({ length: seatCount }, (_, seat) => ({
      seat,
      state: 'rolling' as BallState,
      finishedAtMs: null,
      deaths: 0,
    }));
  }
}
