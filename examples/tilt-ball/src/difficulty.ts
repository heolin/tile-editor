import type { Difficulty } from '@kapsel/shared';

/**
 * The whole difficulty of this game is how much momentum the ball carries.
 *
 * Three authored numbers, all physical and all readable off the screen:
 *
 *   `topPxS`  — how fast the ball ends up going at full tilt.
 *   `riseS`   — how quickly it ANSWERS a tilt asking for more speed. The ball
 *               reaches about two thirds of what it was asked for in this long.
 *   `glideS`  — how long it keeps going once it is not being asked to: after
 *               this long about a third of the speed is left.
 *
 * The two time constants are separate on purpose, and that separation is the
 * only reason this game can be both heavy and responsive. A single-constant
 * model — which this was, at first — makes the same number decide how fast the
 * ball gets going and how far it drifts, so asking for a heavier ball
 * necessarily made it sluggish to push.
 *
 * Which one applies is decided per frame by whether the tilt is asking the ball
 * to speed up along the way it is already going (`riseS`) or to slow down, stop
 * or turn (`glideS`) — see `stepVelocity`. So a push answers quickly, and
 * letting go, braking and reversing are all heavy.
 *
 * Drag is applied by the game, not by Matter's `frictionAir` — see `motion.ts`
 * for why.
 */
export interface Tuning {
  /** How long the ball keeps going once it is no longer being asked to. */
  glideS: number;
  /** How quickly it answers a tilt that asks for MORE speed. */
  riseS: number;
  /** Speed at full tilt, px/s. */
  topPxS: number;
  /** Derived: px/s² at the start of a push from rest. */
  riseAccelPxS2: number;
}

/**
 * The glide times are also quotable as a per-frame survival at 60 fps —
 * `exp(-1 / (60 · glideS))` — the same currency the bouncy kick's decay is in:
 *
 *   easy 1.5 s ≈ **0.989** a frame,  medium 2.0 s ≈ 0.992,  hard 2.7 s ≈ 0.994
 *
 * And the number that says most, because it is in board widths: released at
 * full speed a ball coasts `topPxS × glideS` before stopping — **2100 px on
 * easy**, 3600 on medium, 5940 on hard, against a board 1024 px across. Every
 * setting carries the ball clear across the board and then some.
 *
 * `riseS` is a quarter of the glide throughout: quick enough that a push is
 * answered at once, and the weight is felt in everything else.
 */
const TABLE: Record<Difficulty, { glideS: number; riseS: number; topPxS: number }> = {
  // Two boards' width of coasting, reached in about a third of a second.
  easy: { glideS: 1.5, riseS: 0.38, topPxS: 1400 },
  // The line has to be planned a full second ahead.
  medium: { glideS: 2.0, riseS: 0.5, topPxS: 1800 },
  // Nothing is steered directly; the ball is aimed and then talked down.
  hard: { glideS: 2.7, riseS: 0.68, topPxS: 2200 },
};

export function tuning(difficulty: Difficulty): Tuning {
  const row = TABLE[difficulty];
  return { ...row, riseAccelPxS2: row.topPxS / row.riseS };
}
