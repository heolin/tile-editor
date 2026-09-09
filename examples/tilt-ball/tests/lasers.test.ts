import { describe, expect, it } from 'vitest';
import { BALL, CELL } from '../src/constants';
import { initialLaserState, resolveBeams } from '../src/level/lasers';
import { analyseReachability } from '../src/level/reachability';
import type { LaserColour, LevelSpec, PlacedElement, TileDef } from '../src/level/types';

/**
 * The four lasers and their levers, on boards built here rather than shipped
 * ones: every rule below is about a pairing or a state, and both are far easier
 * to state as three objects than to find in a painted level.
 */

const BASE: TileDef = {
  name: 'piece',
  key: 'tb-piece',
  width: 70,
  height: 70,
  kind: 'laser-start',
  bouncy: false,
  large: false,
  rotates: false,
};

const START: TileDef = { ...BASE, name: 'laser_shooter_start', kind: 'laser-start' };
const END: TileDef = { ...BASE, name: 'laser_shooter_end', kind: 'laser-end' };
const GOAL: TileDef = { ...BASE, name: 'hole_small_end', kind: 'goal', width: 96, height: 96 };
const SPAWN: TileDef = { ...BASE, name: 'hole_start', kind: 'start', width: 96, height: 96 };

function switchTile(on: boolean): TileDef {
  return { ...BASE, name: `laser_switch${on ? 'On' : 'Off'}`, kind: 'switch', switchOn: on };
}

function place(
  def: TileDef,
  x: number,
  y: number,
  extra: Partial<PlacedElement> = {},
): PlacedElement {
  return {
    def,
    x,
    y,
    width: def.width,
    height: def.height,
    rotationDeg: 0,
    flipH: false,
    flipV: false,
    rotatePeriodS: 0,
    ...extra,
  };
}

/** A start firing DOWN from (x, y) and its end below it, both of one colour. */
function beamDown(colour: LaserColour, x: number, y: number, endY: number): PlacedElement[] {
  return [
    place(START, x, y, { rotationDeg: 180, laserColour: colour }),
    place(END, x, endY, { rotationDeg: 0, laserColour: colour }),
  ];
}

function board(elements: PlacedElement[], cols = 10, rows = 10): LevelSpec {
  return {
    id: 'test',
    title: 'Test',
    mode: 'story',
    edges: 'wall',
    widthPx: cols * CELL,
    heightPx: rows * CELL,
    backgroundKey: 'tb-background_brown',
    ballSize: 'small',
    elements,
  };
}

describe('pairing by colour', () => {
  it('pairs the start and the end that share a colour', () => {
    const level = board([...beamDown('red', 200, 100, 600), ...beamDown('blue', 400, 100, 500)]);
    const beams = resolveBeams(level.id, level.elements);
    expect(beams.map((beam) => beam.colour)).toEqual(['red', 'blue']);
    // Muzzle to muzzle: the gap less half an emitter at each end.
    expect(beams[0]!.lengthPx).toBeCloseTo(500 - 70);
    expect(beams[0]!.x1).toBeCloseTo(200);
    expect(beams[0]!.y1).toBeCloseTo(135);
  });

  it('refuses two lasers of one colour', () => {
    const level = board([...beamDown('red', 200, 100, 600), ...beamDown('red', 400, 100, 500)]);
    expect(() => resolveBeams(level.id, level.elements)).toThrow(/two red pieces/);
  });

  it('refuses an emitter with no end of its colour', () => {
    const level = board([...beamDown('red', 200, 100, 600).slice(0, 1)]);
    expect(() => resolveBeams(level.id, level.elements)).toThrow(/firing into nothing/);
  });

  it('refuses an end with no emitter of its colour', () => {
    const level = board([...beamDown('red', 200, 100, 600).slice(1)]);
    expect(() => resolveBeams(level.id, level.elements)).toThrow(/with no emitter/);
  });

  it('refuses an emitter pointing away from its own end', () => {
    // Rotation 0 fires upward, and its end is below it.
    const level = board([
      place(START, 200, 100, { rotationDeg: 0, laserColour: 'red' }),
      place(END, 200, 600, { rotationDeg: 180, laserColour: 'red' }),
    ]);
    expect(() => resolveBeams(level.id, level.elements)).toThrow(/pointing away from/);
  });

  it('refuses a pair too close to leave any beam', () => {
    const level = board(beamDown('red', 200, 100, 170));
    expect(() => resolveBeams(level.id, level.elements)).toThrow(/of beam/);
  });
});

describe('levers', () => {
  it('lights every beam when nothing switches it', () => {
    const level = board(beamDown('red', 200, 100, 600));
    const beams = resolveBeams(level.id, level.elements);
    expect(initialLaserState(level.id, level.elements, beams).get('red')).toBe(true);
  });

  it('takes the starting state from the art placed', () => {
    const level = board([
      ...beamDown('red', 200, 100, 600),
      place(switchTile(false), 500, 500, { laserColour: 'red' }),
    ]);
    const beams = resolveBeams(level.id, level.elements);
    expect(initialLaserState(level.id, level.elements, beams).get('red')).toBe(false);
  });

  it('refuses levers of one colour placed both ways', () => {
    const level = board([
      ...beamDown('red', 200, 100, 600),
      place(switchTile(false), 500, 500, { laserColour: 'red' }),
      place(switchTile(true), 500, 300, { laserColour: 'red' }),
    ]);
    const beams = resolveBeams(level.id, level.elements);
    expect(() => initialLaserState(level.id, level.elements, beams)).toThrow(/both on and off/);
  });

  it('refuses a lever wired to a laser that is not there', () => {
    const level = board([
      ...beamDown('red', 200, 100, 600),
      place(switchTile(true), 500, 500, { laserColour: 'green' }),
    ]);
    const beams = resolveBeams(level.id, level.elements);
    expect(() => initialLaserState(level.id, level.elements, beams)).toThrow(/no green laser/);
  });
});

describe('lasers and reachability', () => {
  /**
   * A 640×640 board cut in half by one beam running left to right, with the
   * start above it and the goal below. Both emitters stand flush enough to the
   * side walls that the 29px gaps beside them are no use to a 64px ball.
   */
  const cut = (extra: PlacedElement[]): LevelSpec =>
    board([
      place(SPAWN, 320, 100),
      place(GOAL, 320, 560),
      place(START, 64, 300, { rotationDeg: 90, laserColour: 'red' }),
      place(END, 576, 300, { rotationDeg: 270, laserColour: 'red' }),
      ...extra,
    ], 10, 10);

  it('blocks the route through a beam nothing can switch off', () => {
    const level = cut([]);
    expect(analyseReachability(level, BALL.smallRadius).goalReached).toBe(false);
  });

  it('lets the ball past a beam that starts dark', () => {
    const level = cut([place(switchTile(false), 320, 200, { laserColour: 'red' })]);
    expect(analyseReachability(level, BALL.smallRadius).goalReached).toBe(true);
  });

  it('lets the ball past a beam whose lever it can reach', () => {
    // The lever is on the near side of the beam, so it can be thrown first.
    const level = cut([place(switchTile(true), 320, 200, { laserColour: 'red' })]);
    expect(analyseReachability(level, BALL.smallRadius).goalReached).toBe(true);
  });

  it('does not count a lever standing behind its own beam', () => {
    const level = cut([place(switchTile(true), 320, 400, { laserColour: 'red' })]);
    expect(analyseReachability(level, BALL.smallRadius).goalReached).toBe(false);
  });
});
