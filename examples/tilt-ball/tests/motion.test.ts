import { describe, expect, it } from 'vitest';
import {
  decayExternal,
  kickVelocity,
  reflectOff,
  steerVector,
  stepVelocity,
} from '../src/motion';
import { tuning } from '../src/difficulty';

/**
 * The difficulty table promises two numbers a player can feel: how fast the
 * ball ends up going, and how long it takes to stop. These pin both, because
 * the acceleration is derived from them and a change to either silently
 * rewrites the other.
 */
describe('ball motion', () => {
  const dt = 1 / 60;

  it('reaches the difficulty table top speed at full tilt', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const tune = tuning(difficulty);
      let v = { x: 0, y: 0 };
      // Ten time constants is far past settled for every row of the table.
      for (let t = 0; t < tune.glideS * 10; t += dt) {
        v = stepVelocity(v, { x: 1, y: 0 }, tune, dt);
      }
      expect(v.x).toBeCloseTo(tune.topPxS, -1);
      expect(v.y).toBe(0);
    }
  });

  it('keeps about a third of its speed after one glide time', () => {
    const tune = tuning('medium');
    let v = { x: tune.topPxS, y: 0 };
    for (let t = 0; t < tune.glideS; t += dt) {
      v = stepVelocity(v, { x: 0, y: 0 }, tune, dt);
    }
    expect(v.x / tune.topPxS).toBeGreaterThan(0.33);
    expect(v.x / tune.topPxS).toBeLessThan(0.4);
  });

  it('is heavier and faster as difficulty rises, and slower to answer', () => {
    const easy = tuning('easy');
    const hard = tuning('hard');
    expect(hard.glideS).toBeGreaterThan(easy.glideS);
    expect(hard.riseS).toBeGreaterThan(easy.riseS);
    expect(hard.topPxS).toBeGreaterThan(easy.topPxS);
  });

  it('answers a push far quicker than it gives the speed back', () => {
    // The two constants are the whole reason the ball can be heavy without
    // being sluggish, so their relationship is worth pinning: a push is
    // answered several times faster than a release is forgotten.
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const tune = tuning(difficulty);
      expect(tune.riseS * 3).toBeLessThan(tune.glideS);
    }
  });

  it('reaches most of the top speed within the rise time', () => {
    const tune = tuning('easy');
    let v = { x: 0, y: 0 };
    for (let t = 0; t < tune.riseS; t += dt) v = stepVelocity(v, { x: 1, y: 0 }, tune, dt);
    // One time constant is 1 - 1/e of the way there.
    expect(v.x / tune.topPxS).toBeGreaterThan(0.6);
  });

  it('is heavy the moment the tilt asks for less, not just when released', () => {
    const tune = tuning('easy');
    // Rolling right at full speed, now asked to go LEFT: the turn is governed by
    // the glide, so after a rise time's worth of frames it is still going right.
    let v = { x: tune.topPxS, y: 0 };
    for (let t = 0; t < tune.riseS; t += dt) v = stepVelocity(v, { x: -1, y: 0 }, tune, dt);
    expect(v.x).toBeGreaterThan(0);
  });

  it('ignores a resting hand and never pushes harder than full tilt', () => {
    expect(steerVector({ x: 0.05, y: 0 })).toEqual({ x: 0, y: 0 });
    const full = steerVector({ x: 3, y: 4 });
    expect(Math.hypot(full.x, full.y)).toBeCloseTo(1, 5);
  });

  it('ramps out of the deadzone instead of stepping over it', () => {
    // Just past the edge must be a nudge, not 8% of full power.
    const nudge = steerVector({ x: 0.1, y: 0 });
    expect(nudge.x).toBeGreaterThan(0);
    expect(nudge.x).toBeLessThan(0.05);
  });

  it('clamps a stalled frame rather than teleporting the ball', () => {
    const tune = tuning('easy');
    const long = stepVelocity({ x: 0, y: 0 }, { x: 1, y: 0 }, tune, 5);
    const capped = stepVelocity({ x: 0, y: 0 }, { x: 1, y: 0 }, tune, 1 / 30);
    expect(long).toEqual(capped);
  });
});

/**
 * A ball's velocity is the tilt's component plus the board's, kept apart on
 * purpose. What is pinned here is the promise a green block makes: whatever
 * speed you arrive at, you leave the surface at a useful one — and your own
 * tilt cannot cancel that in the same frame.
 */
describe('the kick off a green block', () => {
  /** 1.6 x the easy setting's top speed, which is how the game sizes it. */
  const MIN = 700 * 1.6;
  /** Surface normal pointing away from a block the ball hit from below. */
  const up = { x: 0, y: -1 };

  it('throws a slow ball off at the floor speed', () => {
    expect(kickVelocity({ x: 0, y: 120 }, up, MIN).y).toBeCloseTo(-MIN, 5);
  });

  it('gives a fast ball back the speed it arrived with', () => {
    expect(kickVelocity({ x: 0, y: 2000 }, up, MIN).y).toBeCloseTo(-2000, 5);
  });

  it('kicks straight along the normal, whatever the angle of arrival', () => {
    // The run along the surface lives in `steering` and is left alone, so the
    // kick itself has no sideways part at all.
    const out = kickVelocity({ x: 600, y: 30 }, up, MIN);
    expect(out.x).toBeCloseTo(0, 5);
    expect(out.y).toBeCloseTo(-MIN, 5);
  });

  it('out-pushes a player leaning into the block', () => {
    // The whole point of sizing it against the tilt: the two are summed, and
    // the ball must still leave.
    const holdingDown = { x: 0, y: 700 };
    const kick = kickVelocity(holdingDown, up, MIN);
    expect(kick.y + holdingDown.y).toBeLessThan(0);
  });

  it('kicks a ball that arrived at a standstill straight out', () => {
    expect(kickVelocity({ x: 0, y: 0 }, up, MIN).y).toBeCloseTo(-MIN, 5);
  });

  it('does not read a ball already leaving as an approach', () => {
    expect(kickVelocity({ x: 0, y: -300 }, up, MIN).y).toBeCloseTo(-MIN, 5);
  });
});

describe('a kick fading out', () => {
  it('is nearly a third of itself after a second', () => {
    let v = { x: 0, y: -480 };
    for (let i = 0; i < 60; i++) v = decayExternal(v, 0.98, 1 / 60, 6);
    expect(-v.y).toBeGreaterThan(480 * 0.25);
    expect(-v.y).toBeLessThan(480 * 0.35);
  });

  it('fades by time, not by frame count', () => {
    let fast = { x: 0, y: -480 };
    for (let i = 0; i < 60; i++) fast = decayExternal(fast, 0.98, 1 / 60, 0);
    let slow = { x: 0, y: -480 };
    for (let i = 0; i < 30; i++) slow = decayExternal(slow, 0.98, 1 / 30, 0);
    expect(slow.y).toBeCloseTo(fast.y, 3);
  });

  it('drops the last crawling remainder rather than carrying it forever', () => {
    expect(decayExternal({ x: 0, y: -5 }, 0.98, 1 / 60, 6)).toEqual({ x: 0, y: 0 });
  });
});

/**
 * A plain wall and the board's frame turn the ball around: BOTH components are
 * mirrored, so what changes is the direction of travel, not the balance of two
 * forces. Writing an opposing kick instead leaves the steering still heading
 * into the wall, the two cancel, and the ball parks against it — which is
 * exactly how this read on the board.
 */
describe('mirroring off a plain wall', () => {
  const up = { x: 0, y: -1 };

  it('sends back exactly what arrived, adding nothing', () => {
    expect(reflectOff({ x: 0, y: 500 }, up).y).toBeCloseTo(-500, 5);
    expect(reflectOff({ x: 0, y: 90 }, up).y).toBeCloseTo(-90, 5);
  });

  it('keeps the run along the wall and turns only what went into it', () => {
    const out = reflectOff({ x: 800, y: 60 }, up);
    expect(out.x).toBeCloseTo(800, 5);
    expect(out.y).toBeCloseTo(-60, 5);
  });

  it('leaves a ball that is already going away alone', () => {
    // A contact can be reported on a frame where the solver has separated the
    // two; mirroring then would turn the ball back into the wall.
    expect(reflectOff({ x: 300, y: -400 }, up)).toEqual({ x: 300, y: -400 });
  });

  it('can be damped below 1 but never amplified', () => {
    expect(reflectOff({ x: 0, y: 500 }, up, 0.5).y).toBeCloseTo(-250, 5);
  });
});
