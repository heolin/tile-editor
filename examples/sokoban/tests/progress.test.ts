import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bestMoves, recordMoves, unlockThrough, unlockedCount } from '../src/progress';

/**
 * The two ladders, and the fact that they are two.
 *
 * `localStorage` is stubbed rather than mocked away: these functions exist to
 * survive it throwing, and a test that never lets it throw would not say so.
 */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal('window', { localStorage: fakeStorage() });
  // A dev server opens every board so a batch of levels can be played through
  // without clearing the one before it. That is what these tests are about, so
  // they ask for the ladder back.
  vi.stubEnv('VITE_SOKOBAN_UNLOCK_ALL', 'false');
});

afterEach(() => vi.unstubAllEnvs());
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the unlock ladders', () => {
  it('open one board of each mode to begin with', () => {
    expect(unlockedCount('story')).toBe(1);
    expect(unlockedCount('coop')).toBe(1);
  });

  it('open the next board of the mode that was played', () => {
    expect(unlockThrough('coop', 0)).toBe(true);
    expect(unlockedCount('coop')).toBe(2);
  });

  it('leave the other mode where it was', () => {
    unlockThrough('coop', 0);
    expect(unlockedCount('story')).toBe(1);
  });

  it('do not move when a board already open is finished again', () => {
    unlockThrough('story', 0);
    expect(unlockThrough('story', 0)).toBe(false);
    expect(unlockedCount('story')).toBe(2);
  });

  it('do not go backwards when an earlier board is replayed', () => {
    unlockThrough('story', 0);
    unlockThrough('story', 1);
    expect(unlockedCount('story')).toBe(3);
    unlockThrough('story', 0);
    expect(unlockedCount('story')).toBe(3);
  });
});

describe('records', () => {
  it('keep the fewest moves, per level and per difficulty', () => {
    expect(recordMoves('coop-001', 'easy', 40)).toBe(true);
    expect(recordMoves('coop-001', 'easy', 50)).toBe(false);
    expect(bestMoves('coop-001', 'easy')).toBe(40);
    // A different difficulty is a different record: the same board with less
    // slack is not the same achievement.
    expect(bestMoves('coop-001', 'hard')).toBeNull();
  });
});

describe('storage that throws', () => {
  it('reads as a fresh ladder rather than taking the game down', () => {
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new Error('SecurityError: sandboxed');
      },
    });
    expect(unlockedCount('story')).toBe(1);
    expect(bestMoves('coop-001', 'easy')).toBeNull();
    expect(() => unlockThrough('story', 0)).not.toThrow();
    expect(() => recordMoves('coop-001', 'easy', 10)).not.toThrow();
  });
});
