import { OBSTACLE, OBSTACLES } from '../constants';
import type { PlacedElement } from './types';

/**
 * What an obstacle kills with.
 *
 * None of them has a physics body: like a beam, an obstacle is a distance test
 * run against the ball centres each frame, and touching one is death rather
 * than a bounce. A saw is not something to lean on.
 *
 * Each shape is measured off its art in art px around the art's centre
 * (`OBSTACLES` in constants), then scaled and turned with the object — so a
 * spike strip rotated 90° in Tiled kills along the wall it now hangs on, and a
 * half saw mounted upside down has its dome on the correct side.
 *
 * The centre is passed in rather than read off the element, because a saw on a
 * rail is somewhere else every frame.
 */

export interface WorldShape {
  kind: 'rect' | 'disc';
  cx: number;
  cy: number;
  /** Rect only. */
  halfW: number;
  halfH: number;
  /** Disc only. */
  radius: number;
  /** Radians, clockwise, as Tiled writes rotation. */
  angle: number;
}

/**
 * The art a piece of obstacle art belongs to, without its frame number:
 * `chainsaw_full_1` and `chainsaw_full_2` are one obstacle drawn twice.
 */
export function obstacleArt(name: string): string {
  return name.replace(/_[12]$/, '');
}

/** The other frame of a two-frame obstacle, or undefined for a still one. */
export function otherFrame(name: string): string | undefined {
  if (name.endsWith('_1')) return `${name.slice(0, -2)}_2`;
  if (name.endsWith('_2')) return `${name.slice(0, -2)}_1`;
  return undefined;
}

/** This obstacle's killing shape, with its centre put at (x, y). */
export function obstacleShapeAt(element: PlacedElement, x: number, y: number): WorldShape {
  const art = obstacleArt(element.def.name);
  const shape = OBSTACLES[art];
  if (shape === undefined) {
    throw new Error(
      `tilt-ball: obstacle art '${element.def.name}' has no shape in OBSTACLES — an obstacle that ` +
        'kills nowhere is a picture',
    );
  }
  const scaleX = element.width / element.def.width;
  const scaleY = element.height / element.def.height;
  const angle = (element.rotationDeg * Math.PI) / 180;
  // The shape's own offset inside the art turns with the art.
  const ox = shape.cx * scaleX * (element.flipH ? -1 : 1);
  const oy = shape.cy * scaleY * (element.flipV ? -1 : 1);
  const cx = x + ox * Math.cos(angle) - oy * Math.sin(angle);
  const cy = y + ox * Math.sin(angle) + oy * Math.cos(angle);

  if (shape.kind === 'disc') {
    // A disc cannot be squashed by a non-uniform scale without stopping being a
    // disc, so the smaller axis wins and the shape stays inside the picture.
    return {
      kind: 'disc',
      cx,
      cy,
      radius: shape.radius * Math.min(scaleX, scaleY),
      halfW: 0,
      halfH: 0,
      angle,
    };
  }
  return {
    kind: 'rect',
    cx,
    cy,
    halfW: shape.halfW * scaleX,
    halfH: shape.halfH * scaleY,
    radius: 0,
    angle,
  };
}

/** Distance from a point to the shape; 0 when the point is inside it. */
export function distanceToShape(shape: WorldShape, px: number, py: number): number {
  if (shape.kind === 'disc') {
    return Math.max(0, Math.hypot(px - shape.cx, py - shape.cy) - shape.radius);
  }
  // Into the rectangle's own frame, where the test is two clamps.
  const cos = Math.cos(-shape.angle);
  const sin = Math.sin(-shape.angle);
  const dx = px - shape.cx;
  const dy = py - shape.cy;
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  return Math.hypot(
    Math.max(Math.abs(localX) - shape.halfW, 0),
    Math.max(Math.abs(localY) - shape.halfH, 0),
  );
}

/**
 * How close a ball's centre has to come. Half its radius, the same rule a beam
 * uses: a graze along the very edge of a blade is survivable, being on it is
 * not.
 */
export function killReach(ballRadius: number): number {
  return ballRadius * OBSTACLE.ballFraction;
}
