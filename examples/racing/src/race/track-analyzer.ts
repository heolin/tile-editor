import { CHECKPOINTS, SPAWN, START_TILE, TILE } from '../constants';
import type { TmjMap, TmjTileLayer } from '../track/types';

const GID_MASK = 0x1fffffff;

export interface Cell {
  col: number;
  row: number;
}

export interface Spawn {
  x: number;
  y: number;
  headingRad: number;
}

export interface TrackAnalysis {
  startCell: Cell;
  axis: 'vertical' | 'horizontal';
  forward: { x: number; y: number };
  /** Along-road centerline of the start tile (visual reference). */
  finishLine: { a: { x: number; y: number }; b: { x: number; y: number } };
  checkpoints: Cell[];
  spawns: Spawn[];
  /**
   * The circuit as an ordered ROUTE — a single-tile-wide walk, for lap progress.
   *
   * **Not the drivable surface, and not usable as one.** Where the road is wider
   * than one tile the walk closes early: on track 1 it is 12 cells while the
   * racing line itself crosses 24. Anything asking "is this point on the road?"
   * against this gets false negatives on half the tarmac. Use the racing line
   * instead — it is the road centreline, with 60px of clearance either side at
   * the tightest point of any track — or the tile layer directly.
   */
  loop: Cell[];
}

const key = (c: Cell): string => `${c.col},${c.row}`;
const cellCenter = (c: Cell) => ({ x: c.col * TILE + TILE / 2, y: c.row * TILE + TILE / 2 });

function roadCells(layer: TmjTileLayer): Set<string> {
  const set = new Set<string>();
  for (let row = 0; row < layer.height; row++) {
    for (let col = 0; col < layer.width; col++) {
      if (layer.data[row * layer.width + col] !== 0) set.add(`${col},${row}`);
    }
  }
  return set;
}

function neighbours(c: Cell, road: Set<string>): Cell[] {
  return [
    { col: c.col, row: c.row - 1 },
    { col: c.col, row: c.row + 1 },
    { col: c.col - 1, row: c.row },
    { col: c.col + 1, row: c.row },
  ].filter((n) => road.has(key(n)));
}

/** Walk the road as an ordered loop from the start cell. */
function orderedLoop(start: Cell, road: Set<string>): Cell[] {
  const loop: Cell[] = [start];
  const visited = new Set([key(start)]);
  let cur = start;
  let prev: Cell | null = null;

  for (let guard = 0; guard < road.size + 2; guard++) {
    const nbrs = neighbours(cur, road).filter((n) => !prev || key(n) !== key(prev));
    if (nbrs.length === 0) break;
    if (nbrs.some((n) => key(n) === key(start)) && loop.length > 2) break; // closed
    const next = nbrs.find((n) => !visited.has(key(n))) ?? nbrs[0];
    if (key(next) === key(start)) break;
    visited.add(key(next));
    loop.push(next);
    prev = cur;
    cur = next;
  }
  return loop;
}

/**
 * `lineHeadingRad` is the baked racing line's direction where it crosses the
 * finish line. Pass it whenever the track has a baked line: the line is then the
 * single source of truth for which way round the circuit goes, so the spawn
 * heading, the finish gate, the steering assist and the rewind all agree. Without
 * it, `forward` falls back to the tile-adjacency walk, which picks a direction
 * independently and can disagree with the line.
 */
export function analyzeTrack(map: TmjMap, lineHeadingRad?: number): TrackAnalysis {
  const layer = map.layers.find((l): l is TmjTileLayer => l.type === 'tilelayer' && l.name === 'track');
  if (!layer) throw new Error('racing: no track layer to analyze');

  // Start tile
  let startCell: Cell | null = null;
  let axis: 'vertical' | 'horizontal' = 'vertical';
  for (let row = 0; row < layer.height && !startCell; row++) {
    for (let col = 0; col < layer.width; col++) {
      const gid = layer.data[row * layer.width + col] & GID_MASK;
      if (gid === START_TILE.vertical) {
        startCell = { col, row };
        axis = 'vertical';
        break;
      }
      if (gid === START_TILE.horizontal) {
        startCell = { col, row };
        axis = 'horizontal';
        break;
      }
    }
  }
  if (!startCell) {
    // Fallback: first road cell, vertical.
    const road = roadCells(layer);
    const first = road.values().next().value ?? '4,10';
    const [col, row] = first.split(',').map(Number);
    startCell = { col, row };
  }

  const road = roadCells(layer);
  const loop = orderedLoop(startCell, road);

  // Forward MUST lie along the start tile's road axis (vertical tile → up/down)
  // so cars sit parallel to the start road, never perpendicular. The racing
  // line's heading already runs along that axis at the finish, so quantising it
  // to the axis keeps its SIGN — which way round the circuit actually goes.
  const axisDirs =
    axis === 'vertical'
      ? [{ x: 0, y: -1 }, { x: 0, y: 1 }]
      : [{ x: 1, y: 0 }, { x: -1, y: 0 }];
  let forward: { x: number; y: number };
  if (lineHeadingRad !== undefined) {
    forward =
      axis === 'vertical'
        ? { x: 0, y: Math.sin(lineHeadingRad) >= 0 ? 1 : -1 }
        : { x: Math.cos(lineHeadingRad) >= 0 ? 1 : -1, y: 0 };
  } else {
    // No baked line: fall back to the direction the tile-adjacency walk heads.
    const next = loop[1] ?? startCell;
    const nextDir = {
      x: Math.sign(next.col - startCell.col),
      y: Math.sign(next.row - startCell.row),
    };
    forward =
      axisDirs.find((d) => d.x === nextDir.x && d.y === nextDir.y) ??
      axisDirs.find((d) => road.has(key({ col: startCell.col + d.x, row: startCell.row + d.y }))) ??
      axisDirs[0];
  }

  // Finish line: ACROSS the road (perpendicular to travel) through the tile
  // centre — the line cars actually cross. Vertical road → horizontal line.
  const c = cellCenter(startCell);
  const finishLine =
    axis === 'vertical'
      ? { a: { x: startCell.col * TILE, y: c.y }, b: { x: (startCell.col + 1) * TILE, y: c.y } }
      : { a: { x: c.x, y: startCell.row * TILE }, b: { x: c.x, y: (startCell.row + 1) * TILE } };

  // Checkpoints: evenly spaced cells around the loop (excluding the start).
  const checkpoints: Cell[] = [];
  if (loop.length > 1) {
    for (let i = 1; i <= CHECKPOINTS; i++) {
      const idx = Math.round((i * loop.length) / (CHECKPOINTS + 1)) % loop.length;
      if (idx !== 0) checkpoints.push(loop[idx]);
    }
  }

  const spawns = buildSpawns(c, forward);
  return { startCell, axis, forward, finishLine, checkpoints, spawns, loop };
}

function buildSpawns(center: { x: number; y: number }, forward: { x: number; y: number }): Spawn[] {
  const right = { x: -forward.y, y: forward.x }; // perpendicular
  const headingRad = Math.atan2(forward.y, forward.x);
  const spawns: Spawn[] = [];
  for (let i = 0; i < 4; i++) {
    const colSign = i % 2 === 0 ? -1 : 1;
    const back = SPAWN.ROW_START + Math.floor(i / 2) * SPAWN.ROW_GAP;
    spawns.push({
      x: center.x - forward.x * back + right.x * colSign * SPAWN.COL_OFFSET,
      y: center.y - forward.y * back + right.y * colSign * SPAWN.COL_OFFSET,
      headingRad,
    });
  }
  return spawns;
}
