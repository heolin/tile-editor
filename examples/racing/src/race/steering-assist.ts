import Phaser from 'phaser';
import type { Difficulty } from '@kapsel/shared';
import { ASSIST, type AssistTuning } from '../constants';
import type { RacingLine } from './racing-line';

/** What the assist needs to know about a car this frame. */
export interface AssistInput {
  x: number;
  y: number;
  headingRad: number;
  speed: number; // px/s, signed (negative = reversing)
  steer: number; // the player's own steering input, −1…1
  lineIndex: number; // nearest point on the line (from RacingLine.nearestIndex)
}

export interface AssistResult {
  /** Heading delta to add this frame (rad, already clamped and scaled by dt). */
  nudgeRad: number;
  /** Where the assist was aiming — for the debug overlay. */
  target: { x: number; y: number } | null;
}

/**
 * A temporary override of the difficulty's own settings — the speed powerup's
 * "better assist" half.
 *
 * It takes THREE knobs and not one, and none of them is optional:
 *
 *  - `rateScale` alone is not enough, because `hard`'s own `maxRate` is 0 and a
 *    multiplier on zero is zero. `rateFloor` is what gives hard something to
 *    scale, so the powerup means the same thing at every difficulty.
 *  - `fadeTo` is the subtle one. On medium and hard the speed fade takes the
 *    assist to nothing by 230px/s, and a boosted car cruises at ~374 — so
 *    without raising the fade, the assist would be zeroed EXACTLY while boosted
 *    and the whole "better assist" would be a silent no-op.
 *
 * Both are applied so they can only ever ADD help: `easy`'s own tuning already
 * exceeds these numbers, and a boost must never make the strongest assist in the
 * game weaker.
 */
export interface AssistProfile {
  rateScale?: number;
  rateFloor?: number;
  /**
   * The speed fade is a BAND, and moving only its end does almost nothing.
   *
   * This cost the boost its whole assist once already: with the tier's own
   * `fadeFrom` of 80 left in place, overriding `fadeTo` to 420 still left a
   * smoothstep that was 95% finished by boosted cruise (~374 px/s), so a rate of
   * 4.4 rad/s was arriving as 0.23. Raise `fadeFrom` past the speed the effect
   * makes the car travel at, or the fade eats the effect.
   */
  fadeFrom?: number;
  fadeTo?: number;
}

const NONE: AssistResult = { nudgeRad: 0, target: null };

/**
 * Pure-pursuit steering assist: aim at a point a little further along the racing
 * line and turn toward it, capped at a difficulty-dependent rate.
 *
 * Why a rate cap rather than a force with a max magnitude: the cap IS the max
 * magnitude, expressed in the only currency the car understands. Because the
 * player's own steering authority (CAR.MAX_TURN_RATE) is a rate too, the two are
 * directly comparable — at low speed the assist out-turns the player and the car
 * effectively rides the line; wind the speed up and the fade takes the assist to
 * zero, so a fast driver is entirely on their own. Deliberate steering also
 * suppresses it, so the assist never fights someone who means to turn.
 */
export class SteeringAssist {
  private readonly tuning: AssistTuning;

  constructor(
    private readonly line: RacingLine | null,
    difficulty: Difficulty,
  ) {
    this.tuning = ASSIST.BY_DIFFICULTY[difficulty] ?? ASSIST.BY_DIFFICULTY.hard;
  }

  get enabled(): boolean {
    return this.line !== null && this.tuning.maxRate > 0;
  }

  compute(input: AssistInput, dt: number, profile?: AssistProfile): AssistResult {
    const line = this.line;
    const tuning = this.tuning;
    // The floor is what lets a profile turn the assist on for a difficulty that
    // has none of its own, so it has to be part of deciding there is one at all.
    const maxRate = Math.max(tuning.maxRate * (profile?.rateScale ?? 1), profile?.rateFloor ?? 0);
    if (!line || maxRate <= 0) return NONE;
    // Not moving forward: nothing to steer, and reversing is always deliberate.
    if (input.speed < ASSIST.MIN_SPEED) return NONE;
    const offset = Math.abs(line.lateralOffset(input.x, input.y, input.lineIndex));
    // Too far off the line to be "a bit off it" — spun out or in the grass.
    if (offset > tuning.maxOffset) return NONE;
    // Close enough — leave the driving alone.
    const strayGain = Phaser.Math.Clamp(
      (offset - tuning.deadzonePx) / tuning.deadzonePx,
      0,
      1,
    );
    if (strayGain <= 0) return NONE;

    const lookahead = ASSIST.LOOKAHEAD_BASE + input.speed * ASSIST.LOOKAHEAD_PER_SPEED;
    const target = line.pointAt(line.advance(input.lineIndex, lookahead));
    const desired = Math.atan2(target.y - input.y, target.x - input.x);
    const error = Phaser.Math.Angle.Wrap(desired - input.headingRad);
    // Facing the wrong way round the track — leave them to it.
    if (Math.abs(error) > ASSIST.MAX_ERROR_RAD) return { nudgeRad: 0, target };

    const rate =
      maxRate *
      strayGain *
      this.speedFade(input.speed, profile) *
      this.playerOverride(input.steer);
    if (rate <= 0) return { nudgeRad: 0, target };


    const limit = rate * dt;
    return { nudgeRad: Phaser.Math.Clamp(error, -limit, limit), target };
  }

  /**
   * 1 while slow, ramping to 0 as speed approaches the fade end.
   *
   * A boost's `fadeTo` raises the ceiling, never lowers it: on `easy` the tier's
   * own fade already sits above boosted cruise, and letting the boost's number
   * win there would make the strongest assist in the game *weaker* the moment a
   * speed powerup was collected.
   */
  private speedFade(speed: number, profile?: AssistProfile): number {
    const from = Math.max(this.tuning.fadeFrom, profile?.fadeFrom ?? 0);
    const to = Math.max(this.tuning.fadeTo, profile?.fadeTo ?? 0, from + 1);
    if (speed <= from) return 1;
    if (speed >= to) return 0;
    const t = (speed - from) / (to - from);
    return 1 - t * t * (3 - 2 * t); // smoothstep out
  }

  /** Deliberate steering scales the assist down (full lock → 1 − override). */
  private playerOverride(steer: number): number {
    return 1 - this.tuning.playerOverride * Math.min(1, Math.abs(steer));
  }
}
