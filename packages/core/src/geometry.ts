import type { ObjectAlignment, Point } from './model.js'

/**
 * Box maths for objects on the canvas.
 *
 * Two things make this less obvious than it looks. An object's (x, y) is not
 * its corner: `objectalignment` decides where inside the box it sits, and
 * tilt-ball sets it to `center` on all 712 of its objects. And the box may be
 * rotated, so a drag has to be read in the object's own frame before it means
 * anything. Getting either wrong makes a resize drift sideways.
 */

export interface Box {
  x: number
  y: number
  width: number
  height: number
  /** Degrees, clockwise, about (x, y). */
  rotation: number
}

export interface Anchor {
  ax: number
  ay: number
}

export const BOTTOM_LEFT: Anchor = { ax: 0, ay: 1 }

export function anchorFor(alignment: ObjectAlignment | undefined): Anchor {
  switch (alignment) {
    case 'topleft': return { ax: 0, ay: 0 }
    case 'top': return { ax: 0.5, ay: 0 }
    case 'topright': return { ax: 1, ay: 0 }
    case 'left': return { ax: 0, ay: 0.5 }
    case 'center': return { ax: 0.5, ay: 0.5 }
    case 'right': return { ax: 1, ay: 0.5 }
    case 'bottomleft': return { ax: 0, ay: 1 }
    case 'bottom': return { ax: 0.5, ay: 1 }
    case 'bottomright': return { ax: 1, ay: 1 }
    default: return BOTTOM_LEFT
  }
}

const rad = (degrees: number) => (degrees * Math.PI) / 180
const deg = (radians: number) => (radians * 180) / Math.PI

function rotate(point: Point, degrees: number): Point {
  const a = rad(degrees)
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos }
}

/**
 * A point on the box in world coordinates, given as fractions across it:
 * (0, 0) is the top-left corner, (1, 1) the bottom-right, (0.5, 0.5) the middle.
 */
export function boxPoint(box: Box, anchor: Anchor, u: number, v: number): Point {
  const local = { x: (u - anchor.ax) * box.width, y: (v - anchor.ay) * box.height }
  const world = rotate(local, box.rotation)
  return { x: box.x + world.x, y: box.y + world.y }
}

/** The four corners, clockwise from the top-left. */
export function boxCorners(box: Box, anchor: Anchor): Point[] {
  return [
    boxPoint(box, anchor, 0, 0),
    boxPoint(box, anchor, 1, 0),
    boxPoint(box, anchor, 1, 1),
    boxPoint(box, anchor, 0, 1),
  ]
}

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate'

/** Which edges each handle moves: -1 the near side, 1 the far side, 0 neither. */
const HANDLE_AXES: Record<Exclude<HandleId, 'rotate'>, { sx: -1 | 0 | 1; sy: -1 | 0 | 1 }> = {
  nw: { sx: -1, sy: -1 },
  n: { sx: 0, sy: -1 },
  ne: { sx: 1, sy: -1 },
  e: { sx: 1, sy: 0 },
  se: { sx: 1, sy: 1 },
  s: { sx: 0, sy: 1 },
  sw: { sx: -1, sy: 1 },
  w: { sx: -1, sy: 0 },
}

const FRACTIONS: Record<Exclude<HandleId, 'rotate'>, { u: number; v: number }> = {
  nw: { u: 0, v: 0 },
  n: { u: 0.5, v: 0 },
  ne: { u: 1, v: 0 },
  e: { u: 1, v: 0.5 },
  se: { u: 1, v: 1 },
  s: { u: 0.5, v: 1 },
  sw: { u: 0, v: 1 },
  w: { u: 0, v: 0.5 },
}

export const RESIZE_HANDLES = Object.keys(HANDLE_AXES) as Exclude<HandleId, 'rotate'>[]

/**
 * How far above the top edge the rotation handle sits. The caller passes a
 * distance in world units that works out to a constant on screen: scaling it
 * with the box would fling the handle far off a 1280-tall wall.
 */
export const DEFAULT_ROTATE_OFFSET = 28

export function handlePosition(box: Box, anchor: Anchor, handle: HandleId, rotateOffset = DEFAULT_ROTATE_OFFSET): Point {
  if (handle === 'rotate') {
    const top = boxPoint(box, anchor, 0.5, 0)
    const away = rotate({ x: 0, y: -rotateOffset }, box.rotation)
    return { x: top.x + away.x, y: top.y + away.y }
  }
  const { u, v } = FRACTIONS[handle]
  return boxPoint(box, anchor, u, v)
}

export function handlePositions(box: Box, anchor: Anchor, rotateOffset = DEFAULT_ROTATE_OFFSET): { id: HandleId; point: Point }[] {
  return [...RESIZE_HANDLES, 'rotate' as const].map((id) => ({ id, point: handlePosition(box, anchor, id, rotateOffset) }))
}

export interface ResizeOptions {
  /** Round the new size to multiples of this, per axis. Omit for free resize. */
  snap?: { x: number; y: number }
  /** Never let the box collapse below this. */
  minimum?: number
}

/**
 * Resizes by dragging one handle to `pointer`. The side opposite the handle
 * stays put in world space, which is what makes the gesture feel like grabbing
 * an edge rather than moving the whole object.
 */
export function resizeBox(box: Box, anchor: Anchor, handle: Exclude<HandleId, 'rotate'>, pointer: Point, options: ResizeOptions = {}): Box {
  const { sx, sy } = HANDLE_AXES[handle]
  const minimum = options.minimum ?? 1

  // The fixed side: opposite whichever edge is being dragged.
  const fx = sx === 1 ? 0 : sx === -1 ? 1 : 0
  const fy = sy === 1 ? 0 : sy === -1 ? 1 : 0
  const fixed = boxPoint(box, anchor, fx, fy)

  // Read the drag in the box's own frame, so rotation stops mattering.
  const local = rotate({ x: pointer.x - fixed.x, y: pointer.y - fixed.y }, -box.rotation)

  let width = sx === 0 ? box.width : sx * local.x
  let height = sy === 0 ? box.height : sy * local.y

  if (options.snap) {
    if (sx !== 0) width = Math.round(width / options.snap.x) * options.snap.x
    if (sy !== 0) height = Math.round(height / options.snap.y) * options.snap.y
  }
  width = Math.max(minimum, width)
  height = Math.max(minimum, height)

  // Put the origin back where the new box's anchor lands, measured from the
  // corner that did not move.
  const offset = rotate({ x: (anchor.ax - fx) * width, y: (anchor.ay - fy) * height }, box.rotation)
  return {
    x: fixed.x + offset.x,
    y: fixed.y + offset.y,
    width,
    height,
    rotation: box.rotation,
  }
}

/** The rotation that points the handle at `pointer`, in degrees. */
export function rotationTowards(box: Box, pointer: Point, snapDegrees = 0): number {
  const angle = deg(Math.atan2(pointer.y - box.y, pointer.x - box.x)) + 90
  const wrapped = ((angle % 360) + 360) % 360
  if (snapDegrees <= 0) return Math.round(wrapped * 100) / 100
  return (Math.round(wrapped / snapDegrees) * snapDegrees) % 360
}

/** Axis-aligned bounds of a rotated box, for marquee tests. */
export function boxBounds(box: Box, anchor: Anchor): { left: number; top: number; right: number; bottom: number } {
  const corners = boxCorners(box, anchor)
  const xs = corners.map((c) => c.x)
  const ys = corners.map((c) => c.y)
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) }
}

export function boundsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top
}
