import { BALL } from './constants';
import type { Tuning } from './difficulty';

export interface Vec {
  x: number;
  y: number;
}

/**
 * The ball's velocity model, in px/s. Pure, so the feel of the game is
 * testable without a scene — `tests/motion.test.ts` pins the two numbers the
 * difficulty table promises.
 *
 * Why the game integrates this itself instead of handing Matter a force and a
 * `frictionAir`:
 *
 * - Matter's velocity is displacement per timestep and its `frictionAir` is a
 *   per-step multiplier, so both would change meaning if the step rate ever
 *   changed. `glideS` and `topPxS` are seconds and px/s, and mean the same
 *   thing at any step rate.
 * - Drag here is exponential (`exp(-dt/τ)`) rather than Matter's linear
 *   `(1 - f)`, which is the same curve only for small steps and diverges
 *   exactly where a long frame makes it matter.
 *
 * The ball keeps its own velocity and writes it to the body once a frame, in
 * two parts — see `Ball` and `kickVelocity` below. Reading it back out of
 * Matter was tried and could not carry a bounce: the engine keeps velocity in
 * `positionPrev`, and anything written during a step is reworked before that
 * step ends.
 */

/** Tilt to a steering vector: deadzone removed, magnitude clamped to 1. */
export function steerVector(axes: Vec): Vec {
  const magnitude = Math.hypot(axes.x, axes.y);
  if (magnitude <= BALL.deadzone) return { x: 0, y: 0 };
  // Rescale so the deadzone is not a step: just past it the push is near zero,
  // not 8% of full. Without this the ball twitches the moment a hand moves.
  const scaled = Math.min((magnitude - BALL.deadzone) / (1 - BALL.deadzone), 1);
  return { x: (axes.x / magnitude) * scaled, y: (axes.y / magnitude) * scaled };
}

/**
 * Longest step the model is integrated over. A frame that took longer (a stall,
 * a backgrounded tab) is treated as this one — better a ball that lags a beat
 * than one that teleports through a wall on resume.
 */
const MAX_STEP_S = 1 / 30;

/**
 * A ball's velocity is TWO components, summed every frame (see `Ball`):
 *
 * - `steering` — what the tilt is asking for, integrated by `stepVelocity`,
 * - `external` — what the board did to it, decayed a little every frame.
 *
 * They are kept apart because they answer to different things. Leaving a bounce
 * in the same number as the steering means the tilt owns it immediately: a
 * player holding the stick into a block would have their kick cancelled by
 * their own input in the same frame, which is exactly what "the bounce does
 * nothing" looks like from the outside.
 */

/**
 * The kick off a surface whose `normal` points away from it — the new value of
 * `external`, along that normal.
 *
 * At least `minSpeed`, or the speed the ball arrived with if that was greater,
 * so a block throws the ball off itself however gently it was touched.
 *
 * **The steering component is not touched.** An earlier version cancelled the
 * part of the tilt heading into the surface, which buys nothing: a player
 * holding the stick into the block rebuilds it within a frame or two, and the
 * outcome is decided by the two magnitudes anyway. So the kick is simply made
 * bigger than anything the tilt can ask for (see `BOUNCE.timesTopSpeed`) and
 * the sum takes care of itself.
 */
export function kickVelocity(total: Vec, normal: Vec, minSpeed: number): Vec {
  // Positive when the ball is moving into the surface.
  const approach = -(total.x * normal.x + total.y * normal.y);
  const push = Math.max(approach, minSpeed);
  // Nothing arrived to reverse (the ball was already leaving, and this surface
  // has no push of its own). The caller leaves `external` alone.
  return push <= 0 ? { x: 0, y: 0 } : { x: normal.x * push, y: normal.y * push };
}

/**
 * Mirror a velocity off a surface whose `normal` points away from it: the part
 * heading INTO the surface comes back out, the part running along it is left
 * alone, and nothing is added.
 *
 * This is what a plain wall does, and it is applied to BOTH of a ball's
 * components. Writing an opposing kick into `external` alone does not work for
 * a wall: `steering` still holds the full speed heading into it, the two cancel,
 * and the ball parks against the wall instead of coming off it. A bouncy block
 * gets away with the kick because it out-sizes the steering on purpose — a wall
 * has nothing of its own to out-size it with, so it has to turn the ball around
 * rather than push against it.
 *
 * `keep` is the share of the inward speed that comes back: 1 is an exact
 * reversal, and nothing above 1 is ever asked for.
 */
export function reflectOff(v: Vec, normal: Vec, keep = 1): Vec {
  const into = v.x * normal.x + v.y * normal.y;
  // Already leaving: a contact can be reported on a frame where the solver has
  // separated them, and reflecting then would turn the ball back into the wall.
  if (into >= 0) return v;
  const tangentX = v.x - into * normal.x;
  const tangentY = v.y - into * normal.y;
  const back = -into * keep;
  return { x: tangentX + normal.x * back, y: tangentY + normal.y * back };
}

/**
 * Bleed a kick away. `perFrame` is quoted at 60 fps and scaled by the real frame
 * time, so a slow frame shortens the kick by the same amount of *time* rather
 * than by the same number of frames.
 */
export function decayExternal(v: Vec, perFrame: number, dtS: number, spent: number): Vec {
  const factor = perFrame ** (Math.min(Math.max(dtS, 0), MAX_STEP_S) * 60);
  const next = { x: v.x * factor, y: v.y * factor };
  return Math.hypot(next.x, next.y) < spent ? { x: 0, y: 0 } : next;
}

/**
 * One frame of the steering component: an exponential approach to the speed the
 * tilt is asking for, solved exactly over the step rather than integrated in two
 * halves (decay, then push). Both spellings are the same curve in the limit, but
 * the split one settles a few percent off the target — above it if the push goes
 * last, below it if the decay does — by an amount that depends on the frame
 * rate. This one lands on the target exactly, at any step size.
 *
 * **Two time constants, chosen per frame.** `riseS` applies when the tilt is
 * asking for more speed than the ball already has in that direction; `glideS`
 * applies to everything else — releasing, braking, turning. That is what lets
 * the ball be heavy and still answer a push at once. With a single constant the
 * same number decides how quickly it gets going and how far it drifts, so every
 * request for more weight also made it slower to push.
 */
export function stepVelocity(v: Vec, steer: Vec, tuning: Tuning, dtS: number): Vec {
  const dt = Math.min(Math.max(dtS, 0), MAX_STEP_S);
  const target = { x: steer.x * tuning.topPxS, y: steer.y * tuning.topPxS };

  const asked = Math.hypot(target.x, target.y);
  // The speed already going the way the tilt is pushing — negative while the
  // ball is travelling the other way.
  const along = asked < 1e-6 ? 0 : (v.x * target.x + v.y * target.y) / asked;
  // Quick only when the push adds to motion that is already going its way (and
  // from rest, where `along` is 0). A ball asked to turn has a NEGATIVE `along`
  // and must be heavy — without that clause a reversal was the fastest thing on
  // the board, which is the opposite of a ball with weight.
  const pushing = along >= 0 && asked > along;
  const decay = Math.exp(-dt / (pushing ? tuning.riseS : tuning.glideS));
  return {
    x: v.x * decay + target.x * (1 - decay),
    y: v.y * decay + target.y * (1 - decay),
  };
}
