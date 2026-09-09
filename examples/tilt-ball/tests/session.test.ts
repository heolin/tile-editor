import { describe, expect, it } from 'vitest';
import { levelsFor } from '../src/level/levels';
import { Session } from '../src/session';

/**
 * The seats are only used for the points array, so an empty roster is enough to
 * ask a session about the levels it was given.
 */
const session = (mode: 'story' | 'versus', queue: string[]): Session =>
  new Session(mode, 'easy', [], queue);

describe('the label beside the level name', () => {
  it('is nothing at all in story', () => {
    // The bug this pins: story played one level and the HUD counted the queue,
    // so it read "1 / 1" — a series announcing itself where there is no series.
    const first = levelsFor('story')[0]!;
    expect(session('story', [first.id]).seriesLabel()).toBeNull();
  });

  it('counts the boards in versus, where the queue IS the series', () => {
    const boards = levelsFor('versus').map((level) => level.id);
    const run = session('versus', boards);
    expect(run.seriesLabel()).toBe(`1/${boards.length}`);
    if (boards.length > 1) {
      run.advance();
      expect(run.seriesLabel()).toBe(`2/${boards.length}`);
    }
  });
});
