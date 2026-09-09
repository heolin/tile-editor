import { describe, expect, it } from 'vitest';
import { advanceOnPath, pointOnPath, projectOnPath, resolveRails } from '../src/level/rails';
import type { PlacedElement, TileDef } from '../src/level/types';

/**
 * The rail solver, on tracks laid out here. Every case is about which ends
 * touch, which is far easier to state as four coordinates than to find in a
 * level somebody painted.
 */

const RAIL_ART: TileDef = {
  name: 'chainsaw_rail',
  key: 'tb-chainsaw_rail',
  width: 140,
  height: 140,
  kind: 'rail',
  bouncy: false,
  large: false,
  rotates: false,
};

const EDGE_ART: TileDef = { ...RAIL_ART, name: 'chainsaw_rail_edge', key: 'tb-chainsaw_rail_edge' };

function piece(def: TileDef, x: number, y: number, rotationDeg = 0, railId = 1): PlacedElement {
  return {
    def,
    x,
    y,
    width: 140,
    height: 140,
    rotationDeg,
    flipH: false,
    flipV: false,
    rotatePeriodS: 0,
    railId,
  };
}

const straight = (x: number, y: number, rotationDeg = 0, railId = 1) =>
  piece(RAIL_ART, x, y, rotationDeg, railId);
const corner = (x: number, y: number, rotationDeg = 0, railId = 1) =>
  piece(EDGE_ART, x, y, rotationDeg, railId);

describe('stitching a rail', () => {
  it('joins straight pieces into one line', () => {
    const rails = resolveRails('test', [straight(140, 200), straight(280, 200), straight(420, 200)]);
    const path = rails.get(1)!;
    expect(path.closed).toBe(false);
    expect(path.lengthPx).toBeCloseTo(420);
    expect(path.points[0]).toEqual({ x: 70, y: 200 });
    expect(path.points[path.points.length - 1]).toEqual({ x: 490, y: 200 });
  });

  it('turns a corner', () => {
    // The corner art enters from its left edge and leaves through its bottom.
    const rails = resolveRails('test', [
      straight(210, 200),
      corner(350, 200),
      straight(350, 340, 90),
    ]);
    const path = rails.get(1)!;
    expect(path.lengthPx).toBeCloseTo(140 + 70 + 70 + 140);
    expect(path.points).toContainEqual({ x: 350, y: 200 });
    const end = path.points[path.points.length - 1]!;
    expect(end.x).toBeCloseTo(350);
    expect(end.y).toBeCloseTo(410);
  });

  it('closes a loop of four corners', () => {
    // Rotations chosen so each corner turns into the next: 270 joins bottom to
    // right, 0 joins left to bottom, 90 joins top to left, 180 joins right to top.
    const rails = resolveRails('test', [
      corner(200, 200, 270),
      corner(340, 200, 0),
      corner(340, 340, 90),
      corner(200, 340, 180),
    ]);
    const path = rails.get(1)!;
    expect(path.closed).toBe(true);
    expect(path.lengthPx).toBeCloseTo(560);
    // A closed path repeats its first point, so it can be walked without a wrap.
    expect(path.points[0]).toEqual(path.points[path.points.length - 1]);
  });

  it('keeps two rails apart by their id', () => {
    const rails = resolveRails('test', [
      straight(140, 200),
      straight(280, 200),
      straight(140, 600, 0, 2),
    ]);
    expect([...rails.keys()].sort()).toEqual([1, 2]);
    expect(rails.get(2)!.lengthPx).toBeCloseTo(140);
  });

  it('refuses a junction', () => {
    // Three pieces meeting at (210, 200): a rail is a track, not a network.
    expect(() =>
      resolveRails('test', [straight(140, 200), straight(280, 200), straight(210, 270, 90)]),
    ).toThrow(/forks rail 1/);
  });

  it('refuses a piece that joins nothing', () => {
    expect(() => resolveRails('test', [straight(140, 200), straight(800, 900)])).toThrow(
      /not joined to the rest/,
    );
  });

  it('refuses a rail piece with no id', () => {
    const orphan = { ...straight(140, 200) };
    delete (orphan as { railId?: number }).railId;
    expect(() => resolveRails('test', [orphan])).toThrow(/no railId/);
  });
});

describe('riding a rail', () => {
  const path = resolveRails('test', [straight(140, 200), straight(280, 200)]).get(1)!;

  it('finds where a saw placed on it starts', () => {
    const at = projectOnPath(path, 210, 206);
    expect(at.distance).toBeCloseTo(140);
    expect(at.awayPx).toBeCloseTo(6);
  });

  it('reports how far off the track a saw is', () => {
    expect(projectOnPath(path, 210, 400).awayPx).toBeCloseTo(200);
  });

  it('walks the line', () => {
    expect(pointOnPath(path, 0)).toEqual({ x: 70, y: 200 });
    expect(pointOnPath(path, 140)).toEqual({ x: 210, y: 200 });
    expect(pointOnPath(path, 280)).toEqual({ x: 350, y: 200 });
  });

  it('turns round at the end instead of jumping back', () => {
    // The line is 280px long, so 250 + 50 overshoots by 20 and comes back 20.
    const near = advanceOnPath(path, { distance: 250, forward: true }, 50);
    expect(near.distance).toBeCloseTo(260);
    expect(near.forward).toBe(false);
    const back = advanceOnPath(path, near, 100);
    expect(back.distance).toBeCloseTo(160);
    expect(back.forward).toBe(false);
  });

  it('turns round at the start as well', () => {
    const at = advanceOnPath(path, { distance: 30, forward: false }, 50);
    expect(at.distance).toBeCloseTo(20);
    expect(at.forward).toBe(true);
  });

  it('cannot be thrown off the end by one long step', () => {
    const at = advanceOnPath(path, { distance: 10, forward: true }, 5000);
    expect(at.distance).toBeGreaterThanOrEqual(0);
    expect(at.distance).toBeLessThanOrEqual(path.lengthPx);
  });

  it('wraps around a loop instead', () => {
    const loop = resolveRails('test', [
      corner(200, 200, 270),
      corner(340, 200, 0),
      corner(340, 340, 90),
      corner(200, 340, 180),
    ]).get(1)!;
    const at = advanceOnPath(loop, { distance: loop.lengthPx - 20, forward: true }, 50);
    expect(at.distance).toBeCloseTo(30);
    expect(at.forward).toBe(true);
  });
});
