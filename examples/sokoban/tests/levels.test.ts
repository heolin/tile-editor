import { describe, expect, it } from 'vitest';
import { allLevels, levelsFor } from '../src/level/levels';
import { startBoard, standable } from '../src/board';
import { GRID } from '../src/constants';
import { SEATS } from '../src/level/tiled';
import { CRATE_COLOURS } from '../src/level/types';

/**
 * The shipped boards, checked as data. Parsing them is most of the test: the
 * loader throws on anything it cannot make sense of, so a level that reaches
 * these assertions has already passed every rule in `tiled.ts`.
 */
describe('the shipped levels', () => {
  const levels = allLevels();

  it('are all there', () => {
    expect(levels.length).toBeGreaterThan(0);
  });

  it('fit the board', () => {
    for (const level of levels) {
      expect(level.width, level.id).toBeLessThanOrEqual(GRID.width);
      expect(level.height, level.id).toBeLessThanOrEqual(GRID.height);
    }
  });

  it('start the player on ground they can stand on', () => {
    for (const level of levels) {
      const state = startBoard(level);
      for (const start of level.starts) {
        expect(standable(state, start.x, start.y), level.id).toBe(true);
      }
    }
  });

  it('have a crate for every goal, of the colour it wants', () => {
    for (const level of levels) {
      for (const colour of CRATE_COLOURS) {
        const wanted = level.features.filter((f) => f?.colour === colour).length;
        const crates = level.crates.filter((c) => c.colour === colour).length;
        expect(crates, `${level.id}: ${colour}`).toBeGreaterThanOrEqual(wanted);
      }
    }
  });

  it('are not already solved', () => {
    for (const level of levels) {
      const open = level.features.filter((feature, index) => {
        if (feature?.colour === undefined) return false;
        const x = index % level.width;
        const y = Math.floor(index / level.width);
        return !level.crates.some((c) => c.x === x && c.y === y && c.colour === feature.colour);
      });
      expect(open.length, level.id).toBeGreaterThan(0);
    }
  });

  it('carry the credit their licence requires', () => {
    // The imported sets may be used only while they stay credited. Nothing in
    // the UI shows it any more, so this is the last place the attribution
    // survives — and the boards themselves are due to be dropped before
    // release (TODO.md). Boards drawn here are ours and carry no source.
    for (const level of levels.filter((l) => l.id.startsWith('micro-'))) {
      expect(level.source, level.id).toBeDefined();
    }
  });

  it('give each mode the seats its boards are drawn for', () => {
    for (const level of levels) {
      expect(level.starts.length, level.id).toBe(SEATS[level.mode]);
    }
  });

  it('have at least one board in each mode', () => {
    for (const mode of ['story', 'coop'] as const) {
      expect(levelsFor(mode).length, mode).toBeGreaterThan(0);
    }
  });

  it('give every level a par worth budgeting against', () => {
    for (const level of levels) {
      expect(level.parMoves, level.id).toBeGreaterThan(0);
    }
  });
});
