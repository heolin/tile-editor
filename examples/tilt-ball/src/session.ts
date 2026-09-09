import type { GameController } from '@playground/game-core';
import type { Difficulty } from '@kapsel/shared';
import { levelById } from './level/levels';
import type { LevelMode, LevelSpec } from './level/types';
import { rankResults, versusPoints, type PlayerResult } from './rules';

/**
 * What the setup screen decided, and what has happened since.
 *
 * One object built before the Phaser scenes and handed to all of them, the way
 * racing's `RaceSeries` is: the play scene, the results screen and the HUD all
 * need the same answers, and a scene's `init` data does not survive the trip
 * through the ready screen (which starts the next scene with no payload).
 */
export class Session {
  private index = 0;
  private points: number[];
  /** Results of the level just played, for the results screen to render. */
  private lastResults: PlayerResult[] = [];

  constructor(
    readonly mode: LevelMode,
    readonly difficulty: Difficulty,
    readonly seats: GameController[],
    /** Level ids in play order. Story mode is always exactly one. */
    private queue: string[],
  ) {
    if (queue.length === 0) throw new Error('tilt-ball: a session needs at least one level');
    this.points = seats.map(() => 0);
  }

  get levelIndex(): number {
    return this.index;
  }

  get levelCount(): number {
    return this.queue.length;
  }

  currentLevel(): LevelSpec {
    return levelById(this.queue[this.index]!);
  }

  /**
   * The "n / N" the HUD shows beside the level's name — and **only versus has
   * one**, because only versus is a series.
   *
   * A story session is one level, chosen on the setup screen and played on its
   * own, so a fraction there announces a series that does not exist (and, being
   * a one-level queue, announced it as "1 / 1"). Which rung of the ladder this
   * is belongs to the picker, which already says so.
   */
  seriesLabel(): string | null {
    return this.mode === 'versus' ? `${this.index + 1}/${this.queue.length}` : null;
  }

  isLastLevel(): boolean {
    return this.index === this.queue.length - 1;
  }

  /** Record a finished level and award versus points. Does not advance. */
  record(results: PlayerResult[]): void {
    this.lastResults = results;
    if (this.mode !== 'versus') return;
    rankResults(results).forEach((result, place) => {
      this.points[result.seat] =
        (this.points[result.seat] ?? 0) + versusPoints(place, result.timeMs !== null);
    });
  }

  results(): PlayerResult[] {
    return this.lastResults;
  }

  pointsFor(seat: number): number {
    return this.points[seat] ?? 0;
  }

  /** Standings across the series so far, best first. Versus only. */
  standings(): { seat: number; points: number }[] {
    return this.seats
      .map((_, seat) => ({ seat, points: this.pointsFor(seat) }))
      .sort((a, b) => b.points - a.points || a.seat - b.seat);
  }

  advance(): void {
    if (this.isLastLevel()) throw new Error('tilt-ball: advanced past the last level');
    this.index += 1;
  }
}

/**
 * The one mutable box the scenes share.
 *
 * A session is decided on the setup screen and replaced whenever the player
 * goes back to it or takes the next story level, but the scenes are constructed
 * once, before any of that. They therefore hold this rather than a `Session`,
 * and read it in `create()` — which is also where a scene restart re-reads it.
 */
export class SessionRef {
  private session: Session | null = null;

  set(session: Session): void {
    this.session = session;
  }

  require(): Session {
    if (this.session === null) throw new Error('tilt-ball: no session — the setup screen never ran');
    return this.session;
  }
}
