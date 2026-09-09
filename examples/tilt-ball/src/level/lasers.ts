import { LASER, SWITCH } from '../constants';
import { LASER_COLOURS, type LaserColour, type PlacedElement } from './types';

/**
 * The lasers on a board: which emitter belongs to which, and whether each beam
 * starts on.
 *
 * A beam is authored as **two objects of one colour** — a `laser_shooter_start`,
 * whose rotation says which way it fires, and a `laser_shooter_end` on that
 * line. The colour pairs them, so a board has at most one beam of each colour
 * and at most four in total.
 *
 * That colour replaced a solver. The first version put the beam's length in a
 * property, which made short beams unauthorable; the second cast a ray from
 * each emitter and took the nearest end on it, which paired correctly but meant
 * two emitters could never share a line of fire, and the thumbnail baker had to
 * carry a second copy of the search to draw the same beams. Pairing by colour is
 * a lookup, and the rotation is left doing one job: pointing.
 *
 * Pure, and shared by the game and the reachability model, so the beam a player
 * meets and the beam the level check reasons about are the same beam.
 */

/** How far off the line of fire the far end may sit and still be aimed at. */
const LATERAL_TOLERANCE = 24;

export interface Beam {
  colour: LaserColour;
  /** Muzzle of the firing end. */
  x1: number;
  y1: number;
  /** Muzzle of the receiving end. */
  x2: number;
  y2: number;
  /** Direction of fire, radians, in Tiled's clockwise-from-up convention. */
  angleRad: number;
  lengthPx: number;
  start: PlacedElement;
  end: PlacedElement;
}

/**
 * Every beam on a level, paired by colour.
 *
 * Throws on anything that would leave a hazard invisible or an emitter idle: a
 * colour with two starts or two ends, a start with no end, an end with no start,
 * an end behind the emitter or off its line.
 */
export function resolveBeams(levelId: string, elements: PlacedElement[]): Beam[] {
  const starts = byColour(levelId, elements, 'laser-start');
  const ends = byColour(levelId, elements, 'laser-end');
  const beams: Beam[] = [];

  for (const colour of LASER_COLOURS) {
    const start = starts.get(colour);
    const end = ends.get(colour);
    if (start === undefined && end === undefined) continue;
    if (start === undefined) {
      throw new Error(
        `tilt-ball: level ${levelId} has a ${colour} laser end at (${end!.x}, ${end!.y}) with no emitter — ` +
          `place a laser_shooter_start and set its laserColour to ${colour}`,
      );
    }
    if (end === undefined) {
      throw new Error(
        `tilt-ball: level ${levelId} has a ${colour} laser at (${start.x}, ${start.y}) firing into nothing — ` +
          `place a laser_shooter_end of the same colour on the line it points along`,
      );
    }

    const angleRad = (start.rotationDeg * Math.PI) / 180;
    // The art points up, so rotation 0 fires upward.
    const dir = { x: Math.sin(angleRad), y: -Math.cos(angleRad) };
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const along = dx * dir.x + dy * dir.y;
    const lateral = Math.hypot(dx - along * dir.x, dy - along * dir.y);
    if (along <= 0 || lateral > LATERAL_TOLERANCE) {
      throw new Error(
        `tilt-ball: level ${levelId} has its ${colour} laser at (${start.x}, ${start.y}) pointing away from ` +
          `its end at (${end.x}, ${end.y}) — turn the emitter to face it`,
      );
    }

    // Muzzle to muzzle: each emitter's own half-length is behind its face.
    const lengthPx = along - start.height / 2 - end.height / 2;
    if (lengthPx < LASER.minBeamPx) {
      throw new Error(
        `tilt-ball: level ${levelId} has its ${colour} emitters ${along.toFixed(0)}px apart, which leaves ` +
          `${lengthPx.toFixed(0)}px of beam — move them apart`,
      );
    }

    const x1 = start.x + dir.x * (start.height / 2);
    const y1 = start.y + dir.y * (start.height / 2);
    beams.push({
      colour,
      x1,
      y1,
      x2: x1 + dir.x * lengthPx,
      y2: y1 + dir.y * lengthPx,
      angleRad,
      lengthPx,
      start,
      end,
    });
  }

  return beams;
}

/**
 * Which beams are lit when the level starts, by colour.
 *
 * The levers say it: the art placed in the editor IS the state, so a board that
 * shows a lever down starts with that beam off. Every lever of one colour is
 * one control in several places, so they must agree — a board that shows the
 * same switch both up and down is a board whose picture is a lie, and it throws
 * rather than picking one. A colour with no lever at all burns permanently.
 */
export function initialLaserState(
  levelId: string,
  elements: PlacedElement[],
  beams: Beam[],
): Map<LaserColour, boolean> {
  const lit = new Map<LaserColour, boolean>(beams.map((beam) => [beam.colour, true]));
  const seen = new Map<LaserColour, boolean>();

  for (const element of elements) {
    if (element.def.kind !== 'switch') continue;
    const colour = element.laserColour;
    if (colour === undefined) {
      throw new Error(`tilt-ball: level ${levelId} has a switch at (${element.x}, ${element.y}) with no colour`);
    }
    if (!lit.has(colour)) {
      throw new Error(
        `tilt-ball: level ${levelId} has a ${colour} switch at (${element.x}, ${element.y}) with no ${colour} ` +
          'laser to switch',
      );
    }
    const on = element.def.switchOn === true;
    const already = seen.get(colour);
    if (already !== undefined && already !== on) {
      throw new Error(
        `tilt-ball: level ${levelId} has ${colour} switches placed both on and off — every lever of one ` +
          'colour is the same switch, so they all show the same state',
      );
    }
    seen.set(colour, on);
    lit.set(colour, on);
  }

  return lit;
}

/** A rotated rectangle: where a lever is solid. */
export interface PlateRect {
  cx: number;
  cy: number;
  width: number;
  height: number;
  /** Radians, clockwise, matching the object's rotation in Tiled. */
  angle: number;
}

/**
 * The solid part of a lever — the plate, not the handle. The plate sits low in
 * the art, so its centre is offset along the object's own down axis and turns
 * with it.
 *
 * Here rather than in the board because the reachability model needs the same
 * rectangle: a lever is a solid thing standing on the floor, and a level whose
 * only route is through one has to fail the check.
 */
export function switchPlate(element: PlacedElement): PlateRect {
  const scaleX = element.width / element.def.width;
  const scaleY = element.height / element.def.height;
  const angle = (element.rotationDeg * Math.PI) / 180;
  const offset = SWITCH.plateOffsetY * scaleY;
  return {
    cx: element.x - offset * Math.sin(angle),
    cy: element.y + offset * Math.cos(angle),
    width: SWITCH.plateWidth * scaleX,
    height: SWITCH.plateHeight * scaleY,
    angle,
  };
}

/** The one element of a kind per colour, throwing when a colour has two. */
function byColour(
  levelId: string,
  elements: PlacedElement[],
  kind: 'laser-start' | 'laser-end',
): Map<LaserColour, PlacedElement> {
  const found = new Map<LaserColour, PlacedElement>();
  for (const element of elements) {
    if (element.def.kind !== kind) continue;
    const colour = element.laserColour;
    if (colour === undefined) {
      throw new Error(
        `tilt-ball: level ${levelId} has a ${kind} at (${element.x}, ${element.y}) with no laserColour`,
      );
    }
    const clash = found.get(colour);
    if (clash !== undefined) {
      throw new Error(
        `tilt-ball: level ${levelId} has two ${colour} pieces of kind ${kind}, at (${clash.x}, ${clash.y}) ` +
          `and (${element.x}, ${element.y}) — one laser per colour, and there are four colours`,
      );
    }
    found.set(colour, element);
  }
  return found;
}
