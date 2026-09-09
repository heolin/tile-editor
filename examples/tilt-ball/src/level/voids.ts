import { CELL, VOID } from '../constants';
import type { LevelSpec } from './types';

/**
 * Where the floor is missing.
 *
 * Two things say it, and they are deliberately one model: a `void` tile placed
 * on the board, and — on a level whose `edges` are `open` — everything outside
 * the board. A ball whose CENTRE is over either of them falls, the same fall as
 * a wrong hole. That is the whole rule, and `voidAt` is the whole interface.
 *
 * The corners are why this is a grid rather than a list of rectangles. Where two
 * void cells meet at a corner of a floor cell, that corner is cut back by
 * `VOID.cornerRadius` so the floor reads as a shape and not as a stack of
 * squares — and "the two cells that meet at this corner" is a question only a
 * grid can answer. So a void tile must be aligned to the 64 grid and sized in
 * whole cells; anything else throws at load, by name.
 *
 * The alternative — free rectangles, each rounded on its own — was rejected
 * because two abutting voids would round away from each other and leave a
 * visible sliver of floor between them.
 */

export interface VoidGrid {
  cols: number;
  rows: number;
  /** 1 where the floor is missing, indexed `row * cols + col`. */
  cells: Uint8Array;
  /** True when the board has no frame, so everything off it is void as well. */
  openEdges: boolean;
}

/** A floor corner that gets cut back, in world px, with the quadrant it is. */
export interface VoidCorner {
  /** The corner point itself — the meeting of two cell edges. */
  x: number;
  y: number;
  /** Which corner of its floor cell: -1 is left/top, +1 is right/bottom. */
  dx: -1 | 1;
  dy: -1 | 1;
}

const QUADRANTS: readonly (readonly [-1 | 1, -1 | 1])[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

/**
 * Read the void tiles off a level. Throws on a tile that is rotated, off the
 * grid, sized in part-cells, or hanging off the board — each of those makes the
 * corner question unanswerable, and a level that loads with the floor in the
 * wrong place is worse than one that refuses to load.
 */
export function buildVoidGrid(level: LevelSpec): VoidGrid {
  if (level.widthPx % CELL !== 0 || level.heightPx % CELL !== 0) {
    throw new Error(
      `tilt-ball: level ${level.id} is ${level.widthPx}×${level.heightPx}px, which is not a whole number of ${CELL}px cells`,
    );
  }
  const cols = level.widthPx / CELL;
  const rows = level.heightPx / CELL;
  const cells = new Uint8Array(cols * rows);

  for (const element of level.elements) {
    if (element.def.kind !== 'void') continue;
    const where = `level ${level.id}, void at (${element.x}, ${element.y})`;
    if (element.rotationDeg !== 0) {
      throw new Error(`tilt-ball: ${where} is rotated ${element.rotationDeg}° — void tiles sit on the grid`);
    }
    const left = element.x - element.width / 2;
    const top = element.y - element.height / 2;
    for (const [value, name] of [
      [left, 'left edge'],
      [top, 'top edge'],
      [element.width, 'width'],
      [element.height, 'height'],
    ] as const) {
      if (!isCellMultiple(value)) {
        throw new Error(`tilt-ball: ${where} has a ${name} of ${value}px, which is not a multiple of ${CELL}`);
      }
    }
    const col0 = Math.round(left / CELL);
    const row0 = Math.round(top / CELL);
    const spanCols = Math.round(element.width / CELL);
    const spanRows = Math.round(element.height / CELL);
    if (col0 < 0 || row0 < 0 || col0 + spanCols > cols || row0 + spanRows > rows) {
      throw new Error(`tilt-ball: ${where} hangs off the board`);
    }
    for (let row = row0; row < row0 + spanRows; row++) {
      for (let col = col0; col < col0 + spanCols; col++) cells[row * cols + col] = 1;
    }
  }

  return { cols, rows, cells, openEdges: level.edges === 'open' };
}

/**
 * Is this cell missing its floor? Off the board counts as void on an open
 * board and as solid on a framed one — which is exactly the difference between
 * the two, expressed once.
 */
export function isVoidCell(grid: VoidGrid, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return grid.openEdges;
  return grid.cells[row * grid.cols + col] === 1;
}

/**
 * Is the point over nothing? The test is the DRAWN shape, rounded corners
 * included: black on the screen means no floor under it, and a ball standing on
 * a corner that has been cut away would be standing on a picture of a hole.
 *
 * Only the point's own cell is examined, so this stays O(1) per ball per frame.
 */
export function voidAt(grid: VoidGrid, x: number, y: number): boolean {
  const col = Math.floor(x / CELL);
  const row = Math.floor(y / CELL);
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return grid.openEdges;
  if (isVoidCell(grid, col, row)) return true;

  const r = VOID.cornerRadius;
  const localX = x - col * CELL;
  const localY = y - row * CELL;
  for (const [dx, dy] of QUADRANTS) {
    if (!isCut(grid, col, row, dx, dy)) continue;
    // The corner of the cell, and the centre of the arc that replaces it —
    // one radius inward along both axes.
    const cornerX = dx < 0 ? 0 : CELL;
    const cornerY = dy < 0 ? 0 : CELL;
    if (Math.abs(localX - cornerX) > r || Math.abs(localY - cornerY) > r) continue;
    if (Math.hypot(localX - (cornerX - dx * r), localY - (cornerY - dy * r)) > r) return true;
  }
  return false;
}

/**
 * Every floor corner that is cut back, for whatever has to draw the board —
 * the game and the thumbnail baker, which carries its own copy of this in
 * Python and has to agree with it.
 */
export function voidCorners(grid: VoidGrid): VoidCorner[] {
  const corners: VoidCorner[] = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (isVoidCell(grid, col, row)) continue;
      for (const [dx, dy] of QUADRANTS) {
        if (!isCut(grid, col, row, dx, dy)) continue;
        corners.push({
          x: (col + (dx < 0 ? 0 : 1)) * CELL,
          y: (row + (dy < 0 ? 0 : 1)) * CELL,
          dx,
          dy,
        });
      }
    }
  }
  return corners;
}

/**
 * A corner is cut when BOTH cells sharing it orthogonally are void. A void that
 * only touches the corner diagonally leaves it square: that is the floor's own
 * inside corner, and there is nothing there to round off.
 */
function isCut(grid: VoidGrid, col: number, row: number, dx: number, dy: number): boolean {
  return isVoidCell(grid, col + dx, row) && isVoidCell(grid, col, row + dy);
}

function isCellMultiple(value: number): boolean {
  // Tiled writes coordinates as floats, so a cell boundary can arrive as
  // 191.99999999999997. Anything further out than a hundredth of a pixel is a
  // tile the author really did drag off the grid.
  return Math.abs(value - Math.round(value / CELL) * CELL) < 0.01;
}
