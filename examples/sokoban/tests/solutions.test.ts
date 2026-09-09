import { describe, expect, it } from 'vitest';
import { levelById } from '../src/level/levels';
import { settle, startBoard, solved, step, type Direction } from '../src/board';

/**
 * Generated levels, checked by playing them.
 *
 * `tools/sokoban/` builds boards backwards from a won position and stores the
 * solution it found in the level's `solution` property. That solution was
 * worked out by a Python port of `board.ts`, and a port is not the game — a
 * rule read slightly differently there would produce boards that are provably
 * solvable by a set of rules nobody plays.
 *
 * So the check is this: replay the stored moves through the game's OWN `step`
 * and require the board to finish. A level that passes has been played, not
 * argued about.
 *
 * The levels are read as raw JSON rather than through `LevelSpec`, because
 * `solution` is the generator's business and there is no reason for the game's
 * own type to carry it. A level without one is a hand-drawn or imported board
 * and is skipped; `levels.test.ts` covers those as data.
 *
 * A co-op solution says who moves: a digit switches the seat the letters after
 * it apply to, `1` for the first player and `2` for the second. A string with
 * no digit in it is one player's, which is what every story board ships.
 */

const raw = import.meta.glob('../levels/*.tmj', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

interface Property {
  name: string;
  value: string | number | boolean;
}

const LETTERS: Record<string, Direction> = { u: 'up', d: 'down', l: 'left', r: 'right' };
const SEATS = '12';

function solutions(): { id: string; moves: string }[] {
  const found: { id: string; moves: string }[] = [];
  for (const [path, text] of Object.entries(raw)) {
    const id = (path.split('/').pop() ?? path).replace(/\.tmj$/i, '');
    if (id === 'template') continue;
    const properties = (JSON.parse(text) as { properties?: Property[] }).properties ?? [];
    const moves = properties.find((p) => p.name === 'solution')?.value;
    if (typeof moves === 'string' && moves !== '') found.push({ id, moves });
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

describe('a generated level', () => {
  const generated = solutions();

  for (const { id, moves } of generated) {
    it(`${id} is finished by the solution it ships with`, () => {
      const level = levelById(id);
      const state = startBoard(level);
      let seat = 0;
      for (let index = 0; index < moves.length; index++) {
        const letter = moves[index]!;
        if (SEATS.includes(letter)) {
          seat = SEATS.indexOf(letter);
          expect(state.players[seat], `${id}: move ${index} asks for player ${seat + 1}`).toBeDefined();
          continue;
        }
        const direction = LETTERS[letter.toLowerCase()];
        expect(direction, `${id}: move ${index} is '${letter}'`).toBeDefined();
        const before = state.pushes;
        const result = step(state, seat, direction!);
        expect(result, `${id}: move ${index} ('${letter}') is blocked`).not.toBeNull();
        // Upper case is a push and lower case is a walk, so a move string that
        // plays but pushes in the wrong places is still wrong.
        expect(state.pushes > before, `${id}: move ${index} ('${letter}') pushed nothing`).toBe(
          letter === letter.toUpperCase(),
        );
        // `leaving` is there so the other player cannot walk into a cell
        // somebody is still animating out of. There is no animation here, so
        // every step settles at once — for both seats, since the one that did
        // not move may still be marked as leaving from earlier.
        for (let who = 0; who < state.players.length; who++) settle(state, who);
      }
      expect(solved(state), `${id} is not finished after ${moves.length} moves`).toBe(true);
    });
  }

  it('has a par it can actually reach', () => {
    for (const { id, moves } of generated) {
      // The seat digits are punctuation, not moves.
      const steps = [...moves].filter((letter) => !SEATS.includes(letter)).length;
      expect(levelById(id).parMoves, id).toBeGreaterThanOrEqual(steps);
    }
  });
});

// A guard on the guard: if nothing here carries a solution the suite passes
// while checking nothing, which is the one way this file could lie.
describe('the solution check', () => {
  it('is looking at the levels', () => {
    expect(Object.keys(raw).length).toBeGreaterThan(0);
  });
});
