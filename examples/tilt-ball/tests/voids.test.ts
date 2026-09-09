import { describe, expect, it } from 'vitest';
import { BALL, CELL, VOID } from '../src/constants';
import { analyseReachability } from '../src/level/reachability';
import type { BoardEdges, LevelSpec, PlacedElement, TileDef } from '../src/level/types';
import { buildVoidGrid, voidAt, voidCorners } from '../src/level/voids';

/**
 * The missing floor, on hand-built boards rather than shipped ones — a rule
 * about which cell is next to which is far easier to state as a picture than to
 * find in a level somebody painted.
 */

const VOID_TILE: TileDef = {
  name: 'void',
  key: 'tb-void',
  width: CELL,
  height: CELL,
  kind: 'void',
  bouncy: false,
  large: false,
  rotates: false,
};

const GOAL_TILE: TileDef = { ...VOID_TILE, name: 'hole_small_end', key: 'tb-hole_small_end', kind: 'goal' };
const START_TILE: TileDef = { ...VOID_TILE, name: 'hole_start', key: 'tb-hole_start', kind: 'start' };

function tile(def: TileDef, col: number, row: number, spanCols = 1, spanRows = 1): PlacedElement {
  return {
    def,
    x: (col + spanCols / 2) * CELL,
    y: (row + spanRows / 2) * CELL,
    width: spanCols * CELL,
    height: spanRows * CELL,
    rotationDeg: 0,
    flipH: false,
    flipV: false,
    rotatePeriodS: 0,
  };
}

function board(cols: number, rows: number, elements: PlacedElement[], edges: BoardEdges = 'wall'): LevelSpec {
  return {
    id: 'test',
    title: 'Test',
    mode: 'story',
    edges,
    widthPx: cols * CELL,
    heightPx: rows * CELL,
    backgroundKey: 'tb-background_brown',
    ballSize: 'small',
    elements,
  };
}

/** A board drawn as text: `V` is void, anything else is floor. */
function fromPicture(picture: string[], edges: BoardEdges = 'wall'): LevelSpec {
  const elements: PlacedElement[] = [];
  picture.forEach((line, row) => {
    [...line].forEach((cell, col) => {
      if (cell === 'V') elements.push(tile(VOID_TILE, col, row));
    });
  });
  return board(picture[0]!.length, picture.length, elements, edges);
}

/** A point that many px inside the given corner of a cell, diagonally. */
function nearCorner(col: number, row: number, dx: -1 | 1, dy: -1 | 1, inset: number) {
  return {
    x: (col + (dx < 0 ? 0 : 1)) * CELL - dx * inset,
    y: (row + (dy < 0 ? 0 : 1)) * CELL - dy * inset,
  };
}

describe('void tiles', () => {
  //   0123456
  // 0 VVVVVVV
  // 1 VGXVYGV   X is (2,1) — void above and to its right
  // 2 VGGGGGV   Y is (4,1) — void above and to its left
  // 3 VVVVVVV
  const notched = fromPicture([
    'VVVVVVV',
    'VGGVGGV',
    'VGGGGGV',
    'VVVVVVV',
  ]);

  it('has no floor where a void tile is', () => {
    const grid = buildVoidGrid(notched);
    expect(voidAt(grid, 3.5 * CELL, 1.5 * CELL)).toBe(true);
    expect(voidAt(grid, 2.5 * CELL, 1.5 * CELL)).toBe(false);
  });

  it('cuts the corner where two voids meet it, and only there', () => {
    const grid = buildVoidGrid(notched);
    // X: void above and to the right, so its top-right corner is gone. Two
    // pixels in from the corner is well outside the arc.
    const bitten = nearCorner(2, 1, 1, -1, 2);
    expect(voidAt(grid, bitten.x, bitten.y)).toBe(true);
    // Its bottom-left corner has floor on both sides and stays square.
    const square = nearCorner(2, 1, -1, 1, 2);
    expect(voidAt(grid, square.x, square.y)).toBe(false);
    // Y is the mirror image: the cut is on its top-left.
    const mirrored = nearCorner(4, 1, -1, -1, 2);
    expect(voidAt(grid, mirrored.x, mirrored.y)).toBe(true);
  });

  it('keeps the floor a radius in from a cut corner', () => {
    const grid = buildVoidGrid(notched);
    // Just inside the arc: this is still floor, and a ball standing here lives.
    const inside = nearCorner(2, 1, 1, -1, VOID.cornerRadius + 1);
    expect(voidAt(grid, inside.x, inside.y)).toBe(false);
  });

  it('lists each cut corner once, with the quadrant it belongs to', () => {
    const corners = voidCorners(buildVoidGrid(notched));
    const forX = corners.filter((corner) => corner.x === 3 * CELL && corner.y === 1 * CELL);
    expect(forX).toEqual([{ x: 3 * CELL, y: 1 * CELL, dx: 1, dy: -1 }]);
  });

  it('treats the outside of an open board as void, corners included', () => {
    const open = board(2, 2, [], 'open');
    const grid = buildVoidGrid(open);
    expect(voidAt(grid, -1, CELL)).toBe(true);
    expect(voidAt(grid, CELL, CELL)).toBe(false);
    // All four corners of the board are cut, and nothing else is.
    expect(voidCorners(grid)).toHaveLength(4);
  });

  it('leaves a framed board square, inside and out', () => {
    const grid = buildVoidGrid(board(2, 2, []));
    expect(voidAt(grid, -1, CELL)).toBe(false);
    expect(voidCorners(grid)).toHaveLength(0);
  });

  it('refuses a void that is not on the grid', () => {
    const off = board(4, 4, [{ ...tile(VOID_TILE, 1, 1), x: 1.5 * CELL + 7 }]);
    expect(() => buildVoidGrid(off)).toThrow(/not a multiple of 64/);
  });

  it('refuses a rotated void', () => {
    const turned = board(4, 4, [{ ...tile(VOID_TILE, 1, 1), rotationDeg: 45 }]);
    expect(() => buildVoidGrid(turned)).toThrow(/rotated/);
  });

  it('refuses a void hanging off the board', () => {
    const over = board(4, 4, [tile(VOID_TILE, 3, 3, 2, 1)]);
    expect(() => buildVoidGrid(over)).toThrow(/hangs off the board/);
  });
});

describe('void and reachability', () => {
  it('will not route a ball across the void', () => {
    // A 5x3 board cut in half by a column of void: the goal is on the far side.
    const split = fromPicture([
      'GGVGG',
      'GGVGG',
      'GGVGG',
    ]);
    split.elements.push(tile(START_TILE, 0, 1), tile(GOAL_TILE, 4, 1));
    expect(analyseReachability(split, BALL.smallRadius).goalReached).toBe(false);
  });

  it('lets an open board be finished at its very edge', () => {
    // Same board, no void and no frame: the goal sits in the outermost cell,
    // which a framed board would keep the ball's centre clear of.
    const open = board(5, 3, [tile(START_TILE, 0, 1), tile(GOAL_TILE, 4, 1)], 'open');
    expect(analyseReachability(open, BALL.smallRadius).goalReached).toBe(true);
  });
});
