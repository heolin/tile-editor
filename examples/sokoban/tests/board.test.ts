import { describe, expect, it } from 'vitest';
import {
  crateAt,
  goalsLeft,
  restore,
  settle,
  snapshot,
  solved,
  startBoard,
  step,
  stuck,
  type BoardState,
} from '../src/board';
import type { CrateColour, Feature, LevelSpec } from '../src/level/types';

/**
 * Boards written as pictures, so a test says what it is about.
 *
 *   #  wall          .  brown goal      o  plain pit
 *   $  brown crate   ,  brown pit-goal  @  player one
 *   r  red crate     :  red goal        2  player two
 *
 * Every cell has floor unless it is off the picture; the walls do the blocking,
 * which is how the imported boards are built too.
 */
function board(rows: string[]): LevelSpec {
  const width = Math.max(...rows.map((row) => row.length));
  const height = rows.length;
  const cells = width * height;
  const level: LevelSpec = {
    id: 'test',
    title: 'test',
    mode: 'story',
    parMoves: 10,
    width,
    height,
    floor: new Array(cells).fill('floor'),
    walls: new Array(cells).fill(undefined),
    features: new Array<Feature | undefined>(cells).fill(undefined),
    crates: [],
    coins: [],
    starts: [{ x: 0, y: 0 }],
  };
  const crate = (x: number, y: number, colour: CrateColour): void => {
    level.crates.push({ x, y, colour });
  };
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      switch (row[x] ?? ' ') {
        case '#':
          level.walls[index] = 'wall';
          break;
        case '.':
          level.features[index] = { key: 'goal', pit: false, colour: 'brown' };
          break;
        case ':':
          level.features[index] = { key: 'goal', pit: false, colour: 'red' };
          break;
        case ',':
          level.features[index] = { key: 'pit', pit: true, colour: 'brown' };
          break;
        case 'o':
          level.features[index] = { key: 'pit', pit: true };
          break;
        case '$':
          crate(x, y, 'brown');
          break;
        case 'r':
          crate(x, y, 'red');
          break;
        case '@':
          level.starts[0] = { x, y };
          break;
        case '2':
          // A second start makes it a co-op board, and the loader would demand
          // exactly two of them.
          level.mode = 'coop';
          level.starts[1] = { x, y };
          break;
        default:
          break;
      }
    }
  });
  return level;
}

/** Where a seat is, as a string a failure message can show. */
const at = (state: BoardState, seat: number): string => {
  const player = state.players[seat];
  return player === undefined ? 'nowhere' : `${player.x},${player.y}`;
};

describe('walking', () => {
  it('takes one cell at a time', () => {
    const state = startBoard(board(['#####', '#@  #', '#####']));
    expect(step(state, 0, 'right')).not.toBeNull();
    expect(at(state, 0)).toBe('2,1');
    expect(state.moves).toBe(1);
  });

  it('is stopped by a wall, and costs nothing', () => {
    const state = startBoard(board(['###', '#@#', '###']));
    expect(step(state, 0, 'up')).toBeNull();
    expect(state.moves).toBe(0);
  });

  it('is stopped by the edge of the board', () => {
    const state = startBoard(board(['@']));
    expect(step(state, 0, 'left')).toBeNull();
  });
});

describe('pushing', () => {
  it('moves the crate one cell and follows it', () => {
    const state = startBoard(board(['#####', '#@$ #', '#####']));
    const result = step(state, 0, 'right');
    expect(result?.pushed?.to).toEqual({ x: 3, y: 1 });
    expect(crateAt(state, 3, 1)).toBeDefined();
    expect(state.pushes).toBe(1);
  });

  it('is refused when the crate has a wall behind it', () => {
    const state = startBoard(board(['####', '#@$#', '####']));
    expect(step(state, 0, 'right')).toBeNull();
    expect(crateAt(state, 2, 1)).toBeDefined();
  });

  it('is refused when the crate has another crate behind it', () => {
    const state = startBoard(board(['######', '#@$$ #', '######']));
    expect(step(state, 0, 'right')).toBeNull();
  });

  it('finishes the board when the last goal is filled', () => {
    const state = startBoard(board(['#####', '#@$.#', '#####']));
    expect(goalsLeft(state)).toBe(1);
    const result = step(state, 0, 'right');
    expect(result?.solved).toBe(true);
    expect(solved(state)).toBe(true);
  });
});

describe('pits', () => {
  it('swallow a crate and can then be walked over', () => {
    const state = startBoard(board(['#####', '#@$o#', '#####']));
    const result = step(state, 0, 'right');
    expect(result?.sank).toBe(true);
    // The crate is gone from the standing pieces, so nothing is in the way.
    expect(crateAt(state, 3, 1)).toBeUndefined();
    expect(step(state, 0, 'right')).not.toBeNull();
    expect(at(state, 0)).toBe('3,1');
  });

  it('block the player until they are filled', () => {
    const state = startBoard(board(['####', '#@o#', '####']));
    expect(step(state, 0, 'right')).toBeNull();
  });

  it('are satisfied by a crate of their own colour', () => {
    const state = startBoard(board(['#####', '#@$,#', '#####']));
    const result = step(state, 0, 'right');
    expect(result?.sank).toBe(true);
    expect(result?.solved).toBe(true);
  });

  it('are a dead end when they swallow a crate a goal was waiting for', () => {
    // One red crate, one red goal, and a pit between them. Counting is enough
    // to see that nothing can fill the goal once the crate is in the pit.
    const state = startBoard(board(['######', '#@ro:#', '######']));
    expect(stuck(state)).toBe(false);
    const result = step(state, 0, 'right');
    expect(result?.sank).toBe(true);
    expect(result?.stuck).toBe(true);
  });

  it('are not a dead end when a spare crate went in', () => {
    // Two brown crates, one goal: losing one to the pit is the point of it.
    const state = startBoard(board(['#######', '#@$o$.#', '#######']));
    const result = step(state, 0, 'right');
    expect(result?.sank).toBe(true);
    expect(result?.stuck).toBe(false);
  });
});

describe('taking a move back', () => {
  it('puts the player, the crate and the counters where they were', () => {
    const state = startBoard(board(['#####', '#@$ #', '#####']));
    const before = snapshot(state);
    step(state, 0, 'right');
    restore(state, before);
    expect(at(state, 0)).toBe('1,1');
    expect(crateAt(state, 2, 1)).toBeDefined();
    expect(state.moves).toBe(0);
    expect(state.pushes).toBe(0);
  });

  it('puts a sunk crate back on its feet', () => {
    // The scene never offers this — sinking clears the history — but `restore`
    // has to be able to, because the reset path uses the same machinery.
    const state = startBoard(board(['#####', '#@$o#', '#####']));
    const before = snapshot(state);
    step(state, 0, 'right');
    restore(state, before);
    expect(state.crates[0]!.sunk).toBe(false);
    expect(crateAt(state, 2, 1)).toBeDefined();
  });
});

describe('coins', () => {
  it('are taken by walking over them, once', () => {
    const level = board(['#####', '#@  #', '#####']);
    level.coins.push({ x: 2, y: 1 });
    const state = startBoard(level);
    expect(step(state, 0, 'right')?.coin).toEqual({ x: 2, y: 1 });
    expect(state.coins).toHaveLength(0);
    step(state, 0, 'left');
    expect(step(state, 0, 'right')?.coin).toBeUndefined();
  });
});

describe('two players on one board', () => {
  it('cannot walk into each other', () => {
    const state = startBoard(board(['######', '#@ 2 #', '######']));
    expect(step(state, 0, 'right')).not.toBeNull();
    // Seat 0 is now next to seat 1, and that is as far as it goes.
    expect(step(state, 0, 'right')).toBeNull();
    expect(at(state, 0)).toBe('2,1');
  });

  it('cannot push a crate onto each other', () => {
    const state = startBoard(board(['######', '#@$2 #', '######']));
    expect(step(state, 0, 'right')).toBeNull();
    expect(crateAt(state, 2, 1)).toBeDefined();
  });

  it('keeps hold of the cell it is still walking out of', () => {
    // Seat 0 steps away; until the scene says the step is over, the cell it
    // left is still occupied and seat 1 may not walk into it.
    const state = startBoard(board(['####', '#@ #', '#2 #', '####']));
    expect(step(state, 0, 'right')).not.toBeNull();
    expect(step(state, 1, 'up')).toBeNull();
    settle(state, 0);
    expect(step(state, 1, 'up')).not.toBeNull();
    expect(at(state, 1)).toBe('1,1');
  });

  it('gives the cell to whoever asked first when both want it', () => {
    const state = startBoard(board(['#####', '#@ 2#', '#####']));
    expect(step(state, 0, 'right')).not.toBeNull();
    expect(step(state, 1, 'left')).toBeNull();
  });

  it('counts both players\' steps into one total', () => {
    const state = startBoard(board(['######', '#@  2#', '######']));
    step(state, 0, 'right');
    step(state, 1, 'left');
    expect(state.moves).toBe(2);
  });

  it('puts both players back on a reset', () => {
    const state = startBoard(board(['######', '#@  2#', '######']));
    const before = snapshot(state);
    step(state, 0, 'right');
    step(state, 1, 'left');
    restore(state, before);
    expect(at(state, 0)).toBe('1,1');
    expect(at(state, 1)).toBe('4,1');
    expect(state.moves).toBe(0);
  });
});
