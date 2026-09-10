import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  anchorFor, boxBounds, boxCorners, boxPoint, boundsIntersect, handlePosition,
  resizeBox, rotationTowards, type Anchor, type Box,
} from '../src/geometry.js'
import { parseMapJson } from '../src/json/map-codec.js'
import { parseTilesetJson } from '../src/json/tileset-codec.js'
import { allObjects } from '../src/model.js'

const CENTER: Anchor = { ax: 0.5, ay: 0.5 }
const BOTTOM_LEFT: Anchor = { ax: 0, ay: 1 }
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6)

describe('where a box sits', () => {
  it('treats (x, y) as the anchor, not the corner', () => {
    const box: Box = { x: 100, y: 100, width: 40, height: 20, rotation: 0 }
    // Bottom-left anchor: the box hangs up and to the right.
    expect(boxCorners(box, BOTTOM_LEFT)[0]).toEqual({ x: 100, y: 80 })
    // Centre anchor: the box is spread around the point.
    expect(boxCorners(box, CENTER)[0]).toEqual({ x: 80, y: 90 })
  })

  it('rotates about the anchor', () => {
    const box: Box = { x: 0, y: 0, width: 10, height: 10, rotation: 90 }
    const topLeft = boxPoint(box, CENTER, 0, 0)
    // Rotating the top-left corner a quarter turn puts it at the top-right.
    near(topLeft.x, 5)
    near(topLeft.y, -5)
  })
})

describe('resizing by a handle', () => {
  it('keeps the opposite corner exactly where it was', () => {
    const box: Box = { x: 100, y: 100, width: 64, height: 64, rotation: 0 }
    for (const [handle, opposite] of [['se', 0], ['nw', 2], ['ne', 3], ['sw', 1]] as const) {
      const before = boxCorners(box, CENTER)[opposite]!
      const next = resizeBox(box, CENTER, handle, { x: 300, y: 220 })
      const after = boxCorners(next, CENTER)[opposite]!
      near(after.x, before.x)
      near(after.y, before.y)
    }
  })

  it('moves the anchor when the anchor is the centre', () => {
    const box: Box = { x: 100, y: 100, width: 64, height: 64, rotation: 0 }
    // Dragging the east edge out by 64 grows the box rightwards, so the centre
    // slides half that distance.
    const next = resizeBox(box, CENTER, 'e', { x: 100 + 32 + 64, y: 100 })
    near(next.width, 128)
    near(next.height, 64)
    near(next.x, 132)
    near(next.y, 100)
  })

  it('leaves the untouched axis alone on an edge handle', () => {
    const box: Box = { x: 0, y: 0, width: 30, height: 70, rotation: 0 }
    const next = resizeBox(box, BOTTOM_LEFT, 'n', { x: 999, y: -100 })
    expect(next.width).toBe(30)
    near(next.height, 100)
  })

  it('reads the drag in the box own frame when rotated', () => {
    const box: Box = { x: 0, y: 0, width: 40, height: 40, rotation: 90 }
    // With the box turned a quarter turn, dragging the 'e' handle follows the
    // box's own east, which points down the screen.
    const east = handlePosition(box, CENTER, 'e')
    const next = resizeBox(box, CENTER, 'e', { x: east.x, y: east.y + 40 })
    near(next.width, 80)
    near(next.height, 40)
    expect(next.rotation).toBe(90)
  })

  it('snaps the size when asked and stays free when not', () => {
    const box: Box = { x: 0, y: 0, width: 64, height: 64, rotation: 0 }
    const free = resizeBox(box, CENTER, 'se', { x: 107, y: 71 })
    near(free.width, 139)
    const snapped = resizeBox(box, CENTER, 'se', { x: 107, y: 71 }, { snap: { x: 64, y: 64 } })
    expect(snapped.width).toBe(128)
    expect(snapped.height).toBe(128)
  })

  it('refuses to collapse the box', () => {
    const box: Box = { x: 0, y: 0, width: 64, height: 64, rotation: 0 }
    const next = resizeBox(box, CENTER, 'se', { x: -500, y: -500 }, { minimum: 4 })
    expect(next.width).toBe(4)
    expect(next.height).toBe(4)
  })
})

describe('rotation handle', () => {
  it('points the box at the pointer', () => {
    const box: Box = { x: 0, y: 0, width: 10, height: 10, rotation: 0 }
    expect(rotationTowards(box, { x: 0, y: -10 })).toBe(0)
    expect(rotationTowards(box, { x: 10, y: 0 })).toBe(90)
    expect(rotationTowards(box, { x: 0, y: 10 })).toBe(180)
    expect(rotationTowards(box, { x: -10, y: 0 })).toBe(270)
  })

  it('snaps to whole steps', () => {
    const box: Box = { x: 0, y: 0, width: 10, height: 10, rotation: 0 }
    expect(rotationTowards(box, { x: 3, y: -10 }, 15)).toBe(15)
    expect(rotationTowards(box, { x: 10, y: -1 }, 15)).toBe(90)
  })
})

describe('against the real tilt-ball objects', () => {
  const map = parseMapJson(readFileSync('examples/tilt-ball/levels/story-01.tmj', 'utf8')).map
  const tileset = parseTilesetJson(
    readFileSync('examples/tilt-ball/tiltball.tsj', 'utf8'),
    'examples/tilt-ball/tiltball.tsj',
  ).tileset
  const anchor = anchorFor(tileset.objectalignment)

  it('reads the alignment the project actually sets', () => {
    expect(tileset.objectalignment).toBe('center')
    expect(anchor).toEqual(CENTER)
  })

  it('puts a stretched wall exactly where the map says', () => {
    // The left wall: 256 wide, 1280 tall, centred at (128, 640).
    const wall = allObjects(map).find((o) => o.width === 256 && o.height === 1280)!
    const box: Box = { x: wall.x, y: wall.y, width: wall.width, height: wall.height, rotation: wall.rotation }
    expect(boxBounds(box, anchor)).toEqual({ left: 0, top: 0, right: 256, bottom: 1280 })
  })

  it('grows that wall from its inner edge without shifting the outer one', () => {
    const wall = allObjects(map).find((o) => o.width === 256 && o.height === 1280)!
    const box: Box = { x: wall.x, y: wall.y, width: wall.width, height: wall.height, rotation: wall.rotation }
    const widened = resizeBox(box, anchor, 'e', { x: 320, y: wall.y }, { snap: { x: 64, y: 64 } })
    expect(widened.width).toBe(320)
    const after = boxBounds(widened, anchor)
    expect(after.left).toBe(0)
    expect(after.right).toBe(320)
  })
})

describe('marquee selection', () => {
  it('catches a rotated box by the area it really covers', () => {
    const box: Box = { x: 0, y: 0, width: 100, height: 10, rotation: 45 }
    const bounds = boxBounds(box, CENTER)
    expect(bounds.right).toBeGreaterThan(35)
    expect(boundsIntersect(bounds, { left: 30, top: 30, right: 60, bottom: 60 })).toBe(true)
    expect(boundsIntersect(bounds, { left: 200, top: 200, right: 300, bottom: 300 })).toBe(false)
  })
})
