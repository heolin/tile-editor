import { RAIL } from '../constants';
import type { PlacedElement } from './types';

/**
 * The track a saw rides: a set of tiles placed in Tiled, stitched into one
 * polyline.
 *
 * The geometry is small because the art makes it small. Both rail pieces are
 * square tiles whose track runs through the tile's CENTRE and leaves through
 * the middle of an edge — the straight one joins left to right, the corner
 * joins left to bottom, bending in the middle. Rotating and flipping the object
 * covers every other orientation, so those two local shapes are the whole
 * vocabulary and the solver only has to find which ends touch.
 *
 * Everything below the resolver — `pointOnPath`, `projectOnPath`,
 * `advanceOnPath` — knows nothing about levels, tiles or this game. That is
 * deliberate: a rail is a useful thing for a moving platform or a patrolling
 * enemy in any game here, and when it moves to `@kapsel/shared` only
 * `resolveRails` has to be given a different way of asking where the pieces are.
 *
 * Failure is always loud. A fork, a gap, a stray piece, a saw pointing at a
 * rail that does not exist: each is a level whose saw would otherwise stand
 * still or slide off into nothing, and neither says what went wrong.
 */

export interface Vec {
  x: number;
  y: number;
}

export interface RailPath {
  id: number;
  /** Corner to corner. A closed loop repeats its first point at the end. */
  points: Vec[];
  closed: boolean;
  lengthPx: number;
  /** Distance along the path at each point, so a lookup is a binary walk. */
  marks: number[];
}

/** Where a saw is on its rail, and which way it is going. */
export interface RailRider {
  distance: number;
  forward: boolean;
}

/**
 * The track through each piece of rail art, in FRACTIONS of the tile from its
 * centre: ±0.5 is the middle of an edge.
 *
 * Fractions rather than pixels so the art can be redrawn at another size
 * without this file knowing — which it was, when 140 px tiles turned out not to
 * sit on a 64 px grid.
 */
const SHAPES: Record<string, readonly Vec[]> = {
  chainsaw_rail: [
    { x: -0.5, y: 0 },
    { x: 0.5, y: 0 },
  ],
  chainsaw_rail_edge: [
    { x: -0.5, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0.5 },
  ],
};

interface Piece {
  element: PlacedElement;
  points: Vec[];
}

/** Every rail on a level, by the `railId` its pieces carry. */
export function resolveRails(levelId: string, elements: PlacedElement[]): Map<number, RailPath> {
  const byId = new Map<number, Piece[]>();
  for (const element of elements) {
    if (element.def.kind !== 'rail') continue;
    if (element.railId === undefined) {
      throw new Error(
        `tilt-ball: level ${levelId} has a rail at (${element.x}, ${element.y}) with no railId — ` +
          'give every piece of one track the same number',
      );
    }
    const shape = SHAPES[element.def.name];
    if (shape === undefined) {
      throw new Error(`tilt-ball: rail art '${element.def.name}' has no track shape`);
    }
    const piece = { element, points: shape.map((point) => toWorld(element, point)) };
    const found = byId.get(element.railId);
    if (found === undefined) byId.set(element.railId, [piece]);
    else found.push(piece);
  }

  const paths = new Map<number, RailPath>();
  for (const [id, pieces] of byId) paths.set(id, stitch(levelId, id, pieces));
  return paths;
}

/** Where a saw placed at (x, y) sits on its rail, and how far off it is. */
export function projectOnPath(path: RailPath, x: number, y: number): { distance: number; awayPx: number } {
  let best = { distance: 0, awayPx: Number.POSITIVE_INFINITY };
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1]!;
    const b = path.points[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSq));
    const away = Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
    if (away < best.awayPx) best = { distance: path.marks[i - 1]! + t * Math.sqrt(lengthSq), awayPx: away };
  }
  return best;
}

/** The point this far along the path. */
export function pointOnPath(path: RailPath, distance: number): Vec {
  const along = Math.max(0, Math.min(path.lengthPx, distance));
  let i = 1;
  while (i < path.marks.length - 1 && path.marks[i]! < along) i++;
  const a = path.points[i - 1]!;
  const b = path.points[i]!;
  const span = path.marks[i]! - path.marks[i - 1]!;
  const t = span === 0 ? 0 : (along - path.marks[i - 1]!) / span;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Move a rider along by `deltaPx`.
 *
 * A closed loop wraps. An open rail **turns round at its ends** and comes back,
 * which is the only ending that keeps a saw where the level put it — a saw that
 * teleported to the far end would jump through whatever is in between.
 *
 * The reflection loops rather than reflecting once, so a long frame or a fast
 * saw cannot overshoot past the other end and out of the path.
 */
export function advanceOnPath(path: RailPath, rider: RailRider, deltaPx: number): RailRider {
  if (path.lengthPx <= 0) return rider;
  let distance = rider.distance + (rider.forward ? deltaPx : -deltaPx);
  let forward = rider.forward;

  if (path.closed) {
    distance %= path.lengthPx;
    if (distance < 0) distance += path.lengthPx;
    return { distance, forward };
  }

  for (let guard = 0; guard < 64; guard++) {
    if (distance > path.lengthPx) {
      distance = 2 * path.lengthPx - distance;
      forward = false;
    } else if (distance < 0) {
      distance = -distance;
      forward = true;
    } else {
      break;
    }
  }
  return { distance: Math.max(0, Math.min(path.lengthPx, distance)), forward };
}

/** One rail piece's track point, from a fraction of the tile to the board. */
function toWorld(element: PlacedElement, point: Vec): Vec {
  const angle = (element.rotationDeg * Math.PI) / 180;
  const x = point.x * element.width * (element.flipH ? -1 : 1);
  const y = point.y * element.height * (element.flipV ? -1 : 1);
  return {
    x: element.x + x * Math.cos(angle) - y * Math.sin(angle),
    y: element.y + x * Math.sin(angle) + y * Math.cos(angle),
  };
}

/** Walk the pieces end to end and lay them out as one polyline. */
function stitch(levelId: string, id: number, pieces: Piece[]): RailPath {
  const where = (piece: Piece): string => `(${piece.element.x}, ${piece.element.y})`;
  const ends = (piece: Piece): [Vec, Vec] => [piece.points[0]!, piece.points[piece.points.length - 1]!];

  /** The other piece meeting this one at this end, if any. */
  const neighbourAt = (piece: Piece, end: Vec): Piece | undefined => {
    const touching = pieces.filter(
      (other) => other !== piece && ends(other).some((candidate) => near(candidate, end)),
    );
    if (touching.length > 1) {
      throw new Error(
        `tilt-ball: level ${levelId} forks rail ${id} at (${Math.round(end.x)}, ${Math.round(end.y)}) — ` +
          'a rail is one track, not a junction',
      );
    }
    return touching[0];
  };

  // Start at a free end when there is one; a rail with none is a closed loop.
  let start: Piece | undefined;
  let startAtFirst = true;
  for (const piece of pieces) {
    const [head, tail] = ends(piece);
    if (neighbourAt(piece, head) === undefined) {
      start = piece;
      startAtFirst = true;
      break;
    }
    if (neighbourAt(piece, tail) === undefined) {
      start = piece;
      startAtFirst = false;
      break;
    }
  }
  const closed = start === undefined;
  let current = start ?? pieces[0]!;
  let forwards = startAtFirst;

  const points: Vec[] = [];
  const visited = new Set<Piece>();
  for (;;) {
    if (visited.has(current)) break;
    visited.add(current);
    const ordered = forwards ? current.points : [...current.points].reverse();
    for (const point of ordered) {
      // The joint between two pieces is one point, not two.
      if (points.length === 0 || !near(points[points.length - 1]!, point)) points.push(point);
    }
    const exit = ordered[ordered.length - 1]!;
    const next = neighbourAt(current, exit);
    if (next === undefined) break;
    forwards = near(next.points[0]!, exit);
    current = next;
  }

  if (visited.size !== pieces.length) {
    const stray = pieces.find((piece) => !visited.has(piece))!;
    throw new Error(
      `tilt-ball: level ${levelId} has a piece of rail ${id} at ${where(stray)} that is not joined to ` +
        'the rest of it',
    );
  }
  if (closed) points.push(points[0]!);
  if (points.length < 2) {
    throw new Error(`tilt-ball: level ${levelId} has rail ${id} with no length`);
  }

  const marks = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    marks.push(marks[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return { id, points, closed, lengthPx: marks[marks.length - 1]!, marks };
}

function near(a: Vec, b: Vec): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= RAIL.jointTolerancePx;
}
