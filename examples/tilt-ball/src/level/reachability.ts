import blockBodies from '../assets/block-bodies.json';
import { CAPTURE_FRACTION, HOLE_RADIUS, KEY_GRAB_PAD, LASER } from '../constants';
import { initialLaserState, resolveBeams, switchPlate } from './lasers';
import { distanceToShape, killReach, obstacleShapeAt } from './obstacles';
import type { LaserColour, LevelSpec, LockColour, PlacedElement } from './types';
import { buildVoidGrid, voidAt } from './voids';

/**
 * Can this board actually be finished?
 *
 * A level is a picture until something walks it. Every wall, hole and beam is
 * placed by hand in Tiled, and the two ways a level goes wrong — the goal walled
 * off, or a key on the wrong side of the door that needs it — are both invisible
 * in the editor and expensive to find with four players waiting. So the same
 * question the plane-cave generator asks about its caves is asked here about
 * every authored board, in `tests/levels.test.ts`.
 *
 * The model is a flood fill of ball CENTRES on a grid, with everything the ball
 * cannot put its centre inside marked blocked:
 *
 * - a wall's baked hull, grown by the ball's radius,
 * - a death hole's capture disc (its rim is safe; its middle is not),
 * - a beam, grown the same way the game's own hit test grows it,
 * - the void, exactly as it is drawn — cut corners included,
 * - anything outside the board.
 *
 * The board's own edge is worth a line of its own. A framed board keeps the
 * ball's centre a radius clear of it, because there is a wall there. An open
 * board has no wall: the centre can reach the very edge, and one pixel past it
 * the ball is falling. So the margin is the difference between the two, and
 * getting it wrong would refuse a goal legitimately placed by an open edge.
 *
 * Rotating blocks are deliberately NOT blocking: they are out of the way for
 * most of their cycle, so treating them as walls would fail levels that are
 * perfectly playable. A level whose ONLY route is through a rotating block is
 * therefore not caught here — that one still needs a person.
 *
 * Locked walls are solved in rounds: fill with them closed, take every key the
 * fill reaches, open those colours, fill again. What that models is the actual
 * rule — a key opens its colour for everybody, permanently. "Reaches" there
 * means touching distance rather than standing on it, because that is what the
 * game asks for — see `keyInReach`.
 *
 * **Lasers with levers** ride the same rounds. A beam blocks only while it can
 * still be lit when the ball arrives: one that starts off is passable from the
 * first round, and one whose lever the fill can touch becomes passable in the
 * next. That is exact rather than generous, because a lever can be thrown both
 * ways as often as you like — reaching it means choosing the state. A lever
 * standing behind its own beam stays out of reach, and the beam keeps blocking.
 */

const HULLS = (blockBodies as { blocks: Record<string, { size: number[]; hull: number[][] }> }).blocks;

/** Grid step for the fill, px. A quarter of the small ball — fine enough that a
 *  64px gap is never missed, coarse enough that a board is a few thousand cells. */
const STEP = 16;

export interface ReachabilityReport {
  goalReached: boolean;
  /** Keys the ball can get to, in the order the rounds found them. */
  keysReached: LockColour[];
  /** Keys the level places that no round could reach. */
  keysUnreachable: LockColour[];
  /** True when a goal exists but stays locked because its key is out of reach. */
  goalStaysLocked: boolean;
}

export function analyseReachability(level: LevelSpec, ballRadius: number): ReachabilityReport {
  const starts = level.elements.filter((element) => element.def.kind === 'start');
  const goals = level.elements.filter((element) => element.def.kind === 'goal');
  const keys = level.elements.filter((element) => element.def.kind === 'key');
  if (starts.length === 0 || goals.length === 0) {
    return { goalReached: false, keysReached: [], keysUnreachable: [], goalStaysLocked: false };
  }

  const opened = new Set<LockColour>();
  const keysReached: LockColour[] = [];
  let reached = new Set<number>();

  // Beams the ball can be past: the ones already dark when the level starts,
  // plus — round by round — the ones whose lever it can get to.
  const beams = resolveBeams(level.id, level.elements);
  const darkened = new Set<LaserColour>();
  for (const [colour, on] of initialLaserState(level.id, level.elements, beams)) {
    if (!on) darkened.add(colour);
  }
  const levers = level.elements.filter((element) => element.def.kind === 'switch');

  // One round per lock opened or lever found, plus one: each round can only add
  // area, and a round that opens nothing new is the last one worth running.
  for (;;) {
    reached = fill(level, ballRadius, starts, opened, darkened);
    const freshKeys = keys.filter(
      (key) => !opened.has(key.def.lock!) && keyInReach(level, ballRadius, key, reached),
    );
    const freshLevers = levers.filter(
      (lever) => !darkened.has(lever.laserColour!) && leverInReach(level, ballRadius, lever, reached),
    );
    if (freshKeys.length === 0 && freshLevers.length === 0) break;
    for (const key of freshKeys) {
      opened.add(key.def.lock!);
      keysReached.push(key.def.lock!);
    }
    for (const lever of freshLevers) darkened.add(lever.laserColour!);
  }

  const openGoals = goals.filter((goal) => goal.def.lock === undefined || opened.has(goal.def.lock));
  const goalReached = openGoals.some((goal) => reached.has(cellOf(level, goal.x, goal.y)));

  return {
    goalReached,
    keysReached,
    keysUnreachable: keys.map((key) => key.def.lock!).filter((colour) => !opened.has(colour)),
    goalStaysLocked: openGoals.length === 0,
  };
}

/**
 * Distance from a point to the nearest wall, 0 when it is inside one.
 *
 * For the check that no hole, key, goal or start is buried under a block —
 * which is invisible in Tiled (the wall simply draws over it), does not show up
 * as unreachable (a covered hole is just a hole nobody falls into), and means
 * the piece is not in the level at all. Locked walls count: a key under the
 * door it opens is the same bug with an extra step.
 */
export function distanceToNearestWall(level: LevelSpec, x: number, y: number): number {
  const walls = level.elements.filter((element) => element.def.kind === 'block');
  if (walls.length === 0) return Number.POSITIVE_INFINITY;
  return Math.min(...walls.map((wall) => distanceToHull(x, y, worldHull(wall))));
}

function columns(level: LevelSpec): number {
  return Math.ceil(level.widthPx / STEP);
}

function cellOf(level: LevelSpec, x: number, y: number): number {
  const col = Math.min(Math.max(Math.round(x / STEP), 0), columns(level) - 1);
  const row = Math.min(Math.max(Math.round(y / STEP), 0), Math.ceil(level.heightPx / STEP) - 1);
  return row * columns(level) + col;
}

/** Flood fill of the cells a ball centre can occupy, from every start. */
/**
 * Can the ball touch this lever? Not "can it stand on it" — the plate is solid,
 * so the cells over it are blocked and the ball never gets its centre there.
 * A lever is in reach when a cell the fill DID reach is within a ball's radius
 * of the plate, which is the same thing the collision would be.
 */
/**
 * Can the ball take this key? Not "can it park on it" — the game hands a key
 * over on CONTACT (`Board.keyUnder`), so asking the fill to reach the key's own
 * cell asks for far more than the rule does. A key tucked into the free half of
 * a corner block sits nearer the diagonal than a ball's radius, which blocks the
 * cell it stands on while the ball can still roll up and touch it: story-22's
 * yellow key is 24px from that diagonal, against a small ball's radius of 32.
 *
 * The same shape as `leverInReach`, and the same reasoning. This does NOT let a
 * key buried inside a wall pass — that is its own check, `distanceToNearestWall`
 * in the same test file, and it is the one that catches a key nobody can see.
 */
function keyInReach(
  level: LevelSpec,
  ballRadius: number,
  key: PlacedElement,
  reached: Set<number>,
): boolean {
  // Mirrors `Board.keyUnder`: the key's own radius, the ball's, and the pad.
  const reach = Math.min(key.width, key.height) / 2 + ballRadius + KEY_GRAB_PAD;
  const cols = columns(level);
  for (const index of reached) {
    const x = (index % cols) * STEP;
    const y = Math.floor(index / cols) * STEP;
    if (Math.hypot(x - key.x, y - key.y) <= reach) return true;
  }
  return false;
}

function leverInReach(
  level: LevelSpec,
  ballRadius: number,
  lever: PlacedElement,
  reached: Set<number>,
): boolean {
  const plate = switchPlate(lever);
  const hull = boxHull(plate.cx, plate.cy, plate.width, plate.height, plate.angle);
  const cols = columns(level);
  // One grid step of slack: the nearest free cell centre sits up to that far
  // outside the ring of cells the plate blocks.
  const reach = ballRadius + STEP;
  for (const index of reached) {
    const x = (index % cols) * STEP;
    const y = Math.floor(index / cols) * STEP;
    if (Math.abs(x - plate.cx) > reach + plate.width || Math.abs(y - plate.cy) > reach + plate.height) {
      continue;
    }
    if (distanceToHull(x, y, hull) <= reach) return true;
  }
  return false;
}

function fill(
  level: LevelSpec,
  ballRadius: number,
  starts: PlacedElement[],
  opened: Set<LockColour>,
  darkened: Set<LaserColour>,
): Set<number> {
  const cols = columns(level);
  const rows = Math.ceil(level.heightPx / STEP);
  const blocked = buildBlocked(level, ballRadius, opened, darkened, cols, rows);

  const seen = new Set<number>();
  const queue: number[] = [];
  for (const start of starts) {
    // A start is somewhere the ball demonstrably is, so it seeds the fill even
    // if the grid thinks its exact centre is tight against something.
    const index = cellOf(level, start.x, start.y);
    if (seen.has(index)) continue;
    seen.add(index);
    queue.push(index);
  }

  while (queue.length > 0) {
    const index = queue.pop()!;
    const col = index % cols;
    const row = Math.floor(index / cols);
    const neighbours = [
      col > 0 ? index - 1 : -1,
      col < cols - 1 ? index + 1 : -1,
      row > 0 ? index - cols : -1,
      row < rows - 1 ? index + cols : -1,
    ];
    for (const next of neighbours) {
      if (next < 0 || seen.has(next) || blocked[next]) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

function buildBlocked(
  level: LevelSpec,
  ballRadius: number,
  opened: Set<LockColour>,
  darkened: Set<LaserColour>,
  cols: number,
  rows: number,
): Uint8Array {
  const blocked = new Uint8Array(cols * rows);
  const walls = level.elements
    .filter(
      (element) =>
        element.def.kind === 'block' &&
        !element.def.rotates &&
        (element.def.lock === undefined || !opened.has(element.def.lock)),
    )
    .map((element) => worldHull(element));

  // A laser's two ends are solid furniture, so they block a route like any wall.
  // A level whose only way past a beam is through an emitter has to fail here
  // rather than in front of four players.
  for (const element of level.elements) {
    if (element.def.kind !== 'laser-start' && element.def.kind !== 'laser-end') continue;
    const angle = (element.rotationDeg * Math.PI) / 180;
    walls.push(boxHull(element.x, element.y, element.width, element.height, angle));
  }

  // A lever's plate is solid too — the handle is not, and neither is modelled
  // as anything a ball can pass through.
  for (const element of level.elements) {
    if (element.def.kind !== 'switch') continue;
    const plate = switchPlate(element);
    walls.push(boxHull(plate.cx, plate.cy, plate.width, plate.height, plate.angle));
  }

  /**
   * Obstacles that never move: spikes, a wall saw, a saw with no rail. They sit
   * in one place and always kill, so they are walls here.
   *
   * A saw ON A RAIL is deliberately not blocking, for the same reason a
   * rotating block is not: it passes and comes back, and treating its whole
   * track as a wall would refuse levels whose route is simply a matter of
   * timing. A corridor that a rail saw genuinely seals is therefore not caught
   * here — that one still needs a person.
   */
  const still = level.elements
    .filter((element) => element.def.kind === 'obstacle' && element.railId === undefined)
    .map((element) => obstacleShapeAt(element, element.x, element.y));
  const bladeReach = killReach(ballRadius);

  const pits = level.elements
    .filter((element) => element.def.kind === 'hole')
    .map((element) => ({
      x: element.x,
      y: element.y,
      r:
        (element.def.large ? HOLE_RADIUS.large : HOLE_RADIUS.small) *
        (element.width / element.def.width) *
        CAPTURE_FRACTION,
    }));

  // Only the beams that are still lit at this point in the rounds.
  const beams = resolveBeams(level.id, level.elements).filter((beam) => !darkened.has(beam.colour));

  const beamReach = LASER.widthPx / 2 + ballRadius * LASER.ballFraction;

  const voids = buildVoidGrid(level);
  const edgeMargin = level.edges === 'open' ? 0 : ballRadius;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * STEP;
      const y = row * STEP;
      const index = row * cols + col;
      if (
        x < edgeMargin ||
        y < edgeMargin ||
        x > level.widthPx - edgeMargin ||
        y > level.heightPx - edgeMargin
      ) {
        blocked[index] = 1;
        continue;
      }
      // The void is not "outside" — it is a place on the board with nothing
      // under it, and the ball dies there rather than passing over.
      if (voidAt(voids, x, y)) {
        blocked[index] = 1;
        continue;
      }
      if (walls.some((hull) => distanceToHull(x, y, hull) < ballRadius)) {
        blocked[index] = 1;
        continue;
      }
      if (pits.some((pit) => Math.hypot(pit.x - x, pit.y - y) < pit.r)) {
        blocked[index] = 1;
        continue;
      }
      if (still.some((shape) => distanceToShape(shape, x, y) <= bladeReach)) {
        blocked[index] = 1;
        continue;
      }
      if (beams.some((beam) => segmentDistance(x, y, beam) < beamReach)) blocked[index] = 1;
    }
  }
  return blocked;
}

/** A rotated rectangle as a hull — for the pieces with no baked shape. */
function boxHull(
  cx: number,
  cy: number,
  w: number,
  h: number,
  angle: number,
): { x: number; y: number }[] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => ({ x: cx + x! * cos - y! * sin, y: cy + x! * sin + y! * cos }));
}

/** A block's baked hull, flipped, scaled, rotated and moved into world space. */
function worldHull(element: PlacedElement): { x: number; y: number }[] {
  const shape = HULLS[element.def.name];
  if (shape === undefined) {
    throw new Error(`tilt-ball: no baked body for '${element.def.name}'`);
  }
  const angle = (element.rotationDeg * Math.PI) / 180;
  const scaleX = (element.width / element.def.width) * (element.flipH ? -1 : 1);
  const scaleY = (element.height / element.def.height) * (element.flipV ? -1 : 1);
  return shape.hull.map(([hx, hy]) => {
    const sx = hx! * scaleX;
    const sy = hy! * scaleY;
    return {
      x: element.x + sx * Math.cos(angle) - sy * Math.sin(angle),
      y: element.y + sx * Math.sin(angle) + sy * Math.cos(angle),
    };
  });
}

/**
 * Distance from a point to a convex hull; 0 when the point is inside it.
 *
 * Winding-agnostic — inside means every edge sees the point on the SAME side,
 * whichever side that is. A mirrored block's hull runs the other way round, and
 * a test that assumed one winding would report the point outside every time.
 */
function distanceToHull(px: number, py: number, hull: { x: number; y: number }[]): number {
  let positive = 0;
  let negative = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0, j = hull.length - 1; i < hull.length; j = i++) {
    const a = hull[j]!;
    const b = hull[i]!;
    const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
    if (cross > 0) positive++;
    if (cross < 0) negative++;
    best = Math.min(best, segmentDistance(px, py, { x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
  }
  return positive === 0 || negative === 0 ? 0 : best;
}

function segmentDistance(
  px: number,
  py: number,
  segment: { x1: number; y1: number; x2: number; y2: number },
): number {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - segment.x1) * dx + (py - segment.y1) * dy) / lengthSq));
  return Math.hypot(px - (segment.x1 + t * dx), py - (segment.y1 + t * dy));
}
