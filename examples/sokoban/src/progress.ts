import type { Difficulty } from '@kapsel/shared';
import type { LevelMode } from './level/types';

/**
 * What survives the run, in `localStorage`.
 *
 * Progress is ONE number per device: how many levels are open. Not per
 * difficulty (the ladder is the same ladder however much slack the budget
 * gives) and not per player (players here are controllers plugged into one
 * phone for one sitting, with no identity that outlives it) — the same rule the
 * purse, the orbs and the animal collection follow.
 *
 * Every access is wrapped: `localStorage` THROWS in a sandboxed WebView and in
 * private mode, and a level counter is never worth taking the game down for.
 */

const UNLOCKED_PREFIX = 'sokoban:unlocked:';
const BEST_PREFIX = 'sokoban:best:';

/** Levels open from the start. The first one, so there is something to tap. */
const MIN_UNLOCKED = 1;

/**
 * Open every board.
 *
 * ON in a dev server, so playing a batch of generated levels through does not
 * mean clearing sixty of them first. OFF in a build unless
 * `VITE_SOKOBAN_UNLOCK_ALL=true` says otherwise — the same shape the dev purse
 * uses in `app/src/main.ts`, and for the same reason: `vite build` sets
 * `import.meta.env.DEV` to false, so a DEV-only gate would silently do nothing
 * in the debug APK, which is where this is most wanted.
 *
 * `=false` turns it off in a dev server too, for when the ladder itself is
 * what is being worked on — which is what `progress.test.ts` sets, since a
 * test of the ladder cannot run with the ladder switched off. Read per call
 * rather than once at load for exactly that: a constant cannot be stubbed
 * after the module has been imported.
 */
function unlockAll(): boolean {
  const wanted = import.meta.env.VITE_SOKOBAN_UNLOCK_ALL?.trim().toLowerCase();
  return wanted === 'true' || (wanted !== 'false' && import.meta.env.DEV);
}

/** How many boards of this mode are open. The two ladders are independent. */
export function unlockedCount(mode: LevelMode): number {
  // Every caller compares this against a level count and clamps; none adds to
  // it. So "all of them" is any number past the longest ladder, and this needs
  // no idea of how many levels there are.
  if (unlockAll()) return Number.MAX_SAFE_INTEGER;
  try {
    const raw = window.localStorage.getItem(`${UNLOCKED_PREFIX}${mode}`);
    const value = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(value) && value > MIN_UNLOCKED ? value : MIN_UNLOCKED;
  } catch {
    return MIN_UNLOCKED;
  }
}

/**
 * Open the level after `index` (0-based). Returns true when this actually moved
 * the ladder — the results screen shows a "new level" line on that.
 */
export function unlockThrough(mode: LevelMode, index: number): boolean {
  const wanted = index + 2; // the level after the one just cleared
  if (wanted <= unlockedCount(mode)) return false;
  try {
    window.localStorage.setItem(`${UNLOCKED_PREFIX}${mode}`, String(wanted));
  } catch {
    // Unwritable storage: the player still finished the level and still gets
    // the next one this sitting — it just will not be there tomorrow.
  }
  return true;
}

/** The fewest moves this level has been finished in, at this difficulty. */
export function bestMoves(levelId: string, difficulty: Difficulty): number | null {
  try {
    const raw = window.localStorage.getItem(`${BEST_PREFIX}${levelId}:${difficulty}`);
    if (raw === null) return null;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Store `moves` if it beats the record. Returns true when it was a new best. */
export function recordMoves(levelId: string, difficulty: Difficulty, moves: number): boolean {
  const previous = bestMoves(levelId, difficulty);
  if (previous !== null && moves >= previous) return false;
  try {
    window.localStorage.setItem(`${BEST_PREFIX}${levelId}:${difficulty}`, String(Math.round(moves)));
  } catch {
    // As above — the run still ended with a number worth showing.
  }
  return true;
}
