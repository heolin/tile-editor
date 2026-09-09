/**
 * Who won, and what that is worth. Pure — `tests/rules.test.ts` covers it,
 * because the ordering is the one thing four players will argue about.
 */

export interface PlayerResult {
  seat: number;
  /** Time from the countdown to the goal, ms. `null` = never got there. */
  timeMs: number | null;
  deaths: number;
}

/**
 * Finishers first, fastest first; everyone else after, fewest deaths first.
 *
 * Ordering the non-finishers by deaths rather than leaving them in seat order
 * is the only signal available about how a run went for a player who never got
 * home — and in story mode, where a death ends a player's level, it separates
 * "died once at the last hole" from "never left the start".
 */
export function rankResults(results: PlayerResult[]): PlayerResult[] {
  return [...results].sort((a, b) => {
    if (a.timeMs !== null && b.timeMs !== null) return a.timeMs - b.timeMs;
    if (a.timeMs !== null) return -1;
    if (b.timeMs !== null) return 1;
    if (a.deaths !== b.deaths) return a.deaths - b.deaths;
    return a.seat - b.seat;
  });
}

/**
 * Versus points by finishing place. Flat-ish on purpose: the gap between first
 * and second is one board's worth of luck, and a series should still be alive
 * at the last level. A player who did not finish scores nothing.
 */
const PLACE_POINTS = [5, 3, 2, 1];

export function versusPoints(place: number, finished: boolean): number {
  if (!finished) return 0;
  return PLACE_POINTS[place] ?? 1;
}

/** `m:ss.t` — a board takes tens of seconds, so tenths are the useful digit. */
export function formatTime(ms: number): string {
  const tenths = Math.floor(ms / 100) % 10;
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

/** A level is cleared — and the next one unlocked — when ANY player finishes it. */
export function levelCleared(results: PlayerResult[]): boolean {
  return results.some((result) => result.timeMs !== null);
}

/** What a seat is doing right now, as far as the rules care. */
export interface SeatStatus {
  seat: number;
  state: 'rolling' | 'falling' | 'out' | 'home';
}

/**
 * Is anybody still trying to reach the goal?
 *
 * Rolling and mid-fall obviously count. In VERSUS a dead ball counts too — it is
 * on its way back to the start and the level is not over for it. In STORY it
 * does not: one life is the rule there, and everybody being out is exactly what
 * restarts the board.
 *
 * `exceptSeat` asks it about everyone else, which is the question the finish
 * window depends on: a player who finishes with nobody else out there has
 * nobody to wait for, and the countdown must not start at all.
 */
export function anyoneStillPlaying(
  seats: readonly SeatStatus[],
  mode: 'story' | 'versus',
  exceptSeat = -1,
): boolean {
  return seats.some(
    (seat) =>
      seat.seat !== exceptSeat &&
      (seat.state === 'rolling' ||
        seat.state === 'falling' ||
        (mode === 'versus' && seat.state === 'out')),
  );
}
