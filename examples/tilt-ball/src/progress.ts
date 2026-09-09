import type { Difficulty } from '@kapsel/shared';

/**
 * What survives the run, in `localStorage`.
 *
 * Progress is ONE number per device: how many story levels are open. Not per
 * difficulty (the ladder is the same ladder however hard the ball is to steer)
 * and not per player (players here are controllers plugged into one phone for
 * one sitting, with no identity that outlives it) — the same rule the purse,
 * the orbs and the animal collection follow.
 *
 * Every access is wrapped: `localStorage` THROWS in a sandboxed WebView and in
 * private mode, and a level counter is never worth taking the game down for.
 */

const UNLOCKED_KEY = 'tilt-ball:unlocked';
const BEST_PREFIX = 'tilt-ball:best:';

/** Story levels open from the start. The first one, so there is something to tap. */
const MIN_UNLOCKED = 1;

/**
 * TEMPORARY, for authoring: every story level open, whatever the ladder says.
 *
 * Set back to `false` before this ships — with it on, a player never sees a
 * level unlock, which is most of what the story mode is for. It is a constant
 * rather than a stored flag on purpose: nothing can turn it on by accident, and
 * turning it off is one word.
 *
 * Two things follow from it while it is on, both harmless and both expected:
 * the picker opens on the LAST level rather than the furthest one reached,
 * because that is what "where you left off" now means, and `unlockThrough`
 * always reports that it moved nothing, so the results screen never shows the
 * "new level" flourish.
 */
const UNLOCK_EVERYTHING = true;

export function unlockedCount(): number {
  if (UNLOCK_EVERYTHING) return Number.MAX_SAFE_INTEGER;
  try {
    const raw = window.localStorage.getItem(UNLOCKED_KEY);
    const value = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(value) && value > MIN_UNLOCKED ? value : MIN_UNLOCKED;
  } catch {
    return MIN_UNLOCKED;
  }
}

/**
 * Open the level after `index` (0-based). Returns true when this actually moved
 * the ladder — the setup screen shows a "new level" flourish on that.
 */
export function unlockThrough(index: number): boolean {
  const wanted = index + 2; // the level after the one just cleared
  const current = unlockedCount();
  if (wanted <= current) return false;
  try {
    window.localStorage.setItem(UNLOCKED_KEY, String(wanted));
  } catch {
    // Unwritable storage: the player still finished the level and still gets
    // the next one this sitting — it just will not be there tomorrow.
  }
  return true;
}

export function bestTime(levelId: string, difficulty: Difficulty): number | null {
  try {
    const raw = window.localStorage.getItem(`${BEST_PREFIX}${levelId}:${difficulty}`);
    if (raw === null) return null;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Store `ms` if it beats the record. Returns true when it was a new best. */
export function recordTime(levelId: string, difficulty: Difficulty, ms: number): boolean {
  const previous = bestTime(levelId, difficulty);
  if (previous !== null && ms >= previous) return false;
  try {
    window.localStorage.setItem(`${BEST_PREFIX}${levelId}:${difficulty}`, String(Math.round(ms)));
  } catch {
    // As above — the run still ended with a time worth showing.
  }
  return true;
}
