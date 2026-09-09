import { describe, expect, it } from 'vitest';
import blockBodies from '../src/assets/block-bodies.json';
import { allLevels, levelsFor } from '../src/level/levels';
import { BALL, RAIL } from '../src/constants';
import { projectOnPath, resolveRails } from '../src/level/rails';
import { resolveBeams } from '../src/level/lasers';
import { analyseReachability, distanceToNearestWall } from '../src/level/reachability';
import { buildVoidGrid, voidAt } from '../src/level/voids';

/**
 * Every shipped level, checked the way the game will read it.
 *
 * This is the test that earns its keep once levels are authored by hand in
 * Tiled: a level with no goal, a wall whose body was never baked, or a beam
 * that leaves the board are all things you cannot see in the editor and would
 * otherwise find with four players waiting.
 */
const hulls = (blockBodies as { blocks: Record<string, unknown> }).blocks;

describe('shipped levels', () => {
  const levels = allLevels();

  it('has levels at all', () => {
    expect(levels.length).toBeGreaterThan(0);
  });

  it.each(levels.map((level) => [level.id, level] as const))('%s is playable', (_id, level) => {
    expect(level.elements.some((element) => element.def.kind === 'start')).toBe(true);
    expect(level.elements.some((element) => element.def.kind === 'goal')).toBe(true);
  });

  it.each(levels.map((level) => [level.id, level] as const))(
    '%s only uses walls that have a baked body',
    (_id, level) => {
      for (const element of level.elements) {
        if (element.def.kind !== 'block') continue;
        expect(hulls[element.def.name], `${element.def.name} is not in block-bodies.json`).toBeDefined();
      }
    },
  );

  it.each(levels.map((level) => [level.id, level] as const))(
    '%s keeps everything inside the frame',
    (_id, level) => {
      for (const element of level.elements) {
        // The true footprint after rotation, not the diagonal: a piece turned
        // 90° is as wide as it was tall, and measuring it by its diagonal
        // refused emitters that sit legitimately flush against the frame.
        const angle = (element.rotationDeg * Math.PI) / 180;
        const cos = Math.abs(Math.cos(angle));
        const sin = Math.abs(Math.sin(angle));
        const reachX = (element.width / 2) * cos + (element.height / 2) * sin;
        const reachY = (element.width / 2) * sin + (element.height / 2) * cos;
        expect(element.x - reachX).toBeGreaterThanOrEqual(-1);
        expect(element.y - reachY).toBeGreaterThanOrEqual(-1);
        expect(element.x + reachX).toBeLessThanOrEqual(level.widthPx + 1);
        expect(element.y + reachY).toBeLessThanOrEqual(level.heightPx + 1);
      }
    },
  );

  it.each(levels.map((level) => [level.id, level] as const))(
    '%s pairs up every laser',
    (_id, level) => {
      // `resolveBeams` throws when a start fires into nothing, or when its end
      // sits closer than the beam art can draw. A laser with no end is an
      // emitter standing there looking armed and killing nobody.
      const beams = resolveBeams(level.id, level.elements);
      const starts = level.elements.filter((element) => element.def.kind === 'laser-start');
      expect(beams.length).toBe(starts.length);
      for (const beam of beams) expect(beam.lengthPx).toBeGreaterThan(0);
    },
  );

  it.each(levels.map((level) => [level.id, level] as const))(
    '%s can actually be finished',
    (id, level) => {
      const radius = level.ballSize === 'large' ? BALL.largeRadius : BALL.smallRadius;
      const report = analyseReachability(level, radius);
      expect(report.keysUnreachable, `${id}: keys the ball cannot get to`).toEqual([]);
      expect(report.goalStaysLocked, `${id}: every goal stays locked`).toBe(false);
      expect(report.goalReached, `${id}: no route from the start to any open goal`).toBe(true);
    },
  );

  it.each(levels.map((level) => [level.id, level] as const))(
    '%s does not bury a hole, key or start under a wall',
    (id, level) => {
      for (const element of level.elements) {
        // Same exception: a rail may run over a wall, and so may the saw on it.
        if (element.def.kind === 'block' || element.def.kind === 'rail') continue;
        if (element.def.kind === 'obstacle') continue;
        const gap = distanceToNearestWall(level, element.x, element.y);
        expect(gap, `${id}: a ${element.def.kind} sits inside a wall`).toBeGreaterThan(0);
      }
    },
  );

  it.each(levels.map((level) => [level.id, level] as const))(
    '%s places nothing over the void',
    (id, level) => {
      // `buildVoidGrid` is also the check that every void tile sits on the grid
      // — it throws otherwise, which is what this call is doing for levels with
      // no void at all.
      const grid = buildVoidGrid(level);
      for (const element of level.elements) {
        // Rails and the saws on them are the exception, and a deliberate one: a
        // blade sweeping across a chasm is a good piece of level design, and its
        // track has to be able to cross one.
        if (element.def.kind === 'void' || element.def.kind === 'rail') continue;
        if (element.def.kind === 'obstacle') continue;
        expect(
          voidAt(grid, element.x, element.y),
          `${id}: a ${element.def.kind} sits over a floor that is not there`,
        ).toBe(false);
      }
    },
  );

  it.each(levels.map((level) => [level.id, level] as const))(
    '%s stitches every rail, with its saws on it',
    (id, level) => {
      // `resolveRails` throws on a fork, a gap or a stray piece. This is the
      // check that would have caught a rail whose pieces do not quite meet
      // before the board did, in front of four players.
      const rails = resolveRails(level.id, level.elements);
      for (const [railId, path] of rails) {
        expect(path.lengthPx, `${id}: rail ${railId} has no length`).toBeGreaterThan(0);
      }
      for (const element of level.elements) {
        if (element.def.kind !== 'obstacle' || element.railId === undefined) continue;
        const path = rails.get(element.railId);
        expect(path, `${id}: a saw points at rail ${element.railId}, which does not exist`).toBeDefined();
        const at = projectOnPath(path!, element.x, element.y);
        expect(
          at.awayPx,
          `${id}: a saw sits ${at.awayPx.toFixed(0)}px off rail ${element.railId}`,
        ).toBeLessThanOrEqual(RAIL.mountTolerancePx);
      }
    },
  );

  it('keeps locks out of versus, where a dead player does not wait', () => {
    for (const level of levelsFor('versus')) {
      const locked = level.elements.filter(
        (element) => element.def.lock !== undefined && element.def.kind !== 'key',
      );
      expect(locked, `${level.id} has locked pieces`).toEqual([]);
      expect(level.elements.filter((element) => element.def.kind === 'key')).toEqual([]);
    }
  });

  it('numbers the story ladder consecutively from 1', () => {
    // The unlock counter walks this list by index, so a gap in the numbering
    // would silently shift which level "level 4" is.
    levelsFor('story').forEach((level, index) => {
      expect(level.id).toBe(`story-${String(index + 1).padStart(2, '0')}`);
    });
  });

  it.each(levels.map((level) => [level.id, level] as const))(
    '%s has exactly one start',
    (id, level) => {
      // Every player begins on the same point, spread around it in a ring. Two
      // starts would put somebody nearer the goal than somebody else, and the
      // board loader throws on it rather than quietly picking one.
      const starts = level.elements.filter((element) => element.def.kind === 'start');
      expect(starts.length, `${id} has ${starts.length} starts`).toBe(1);
    },
  );

  it.each(levels.map((level) => [level.id, level] as const))(
    '%s keeps the start clear of its own hazards',
    (id, level) => {
      const start = level.elements.find((element) => element.def.kind === 'start')!;
      const radius = level.ballSize === 'large' ? BALL.largeRadius : BALL.smallRadius;
      // Four balls leave the start as a ring of this radius; the ring has to be
      // standing on floor, not over a hole.
      const ring = radius * 1.5 + radius;
      for (const element of level.elements) {
        if (element.def.kind !== 'hole') continue;
        const gap = Math.hypot(element.x - start.x, element.y - start.y);
        expect(gap, `${id}: a hole sits ${gap.toFixed(0)}px from the start`).toBeGreaterThan(ring);
      }
    },
  );
});
