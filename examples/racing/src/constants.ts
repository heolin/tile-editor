/**
 * Central knobs for the racing game. Physics/feel constants live here so the
 * on-hardware tuning passes (steering expo, throttle gain, restitution) touch
 * one file.
 */
import type { Difficulty } from '@kapsel/shared';

export const TILE = 128;

/** Render depths (draw order). Cars sit between low props and tall props. */
export const DEPTH = {
  ground: 0,
  track: 10,
  objLow: 20, // road decals + low props (barriers, cones, tyres…)
  cars: 30,
  objHigh: 40, // tall props cars pass behind (trees, tents, tribunes, lights)
  debug: 900,
  hud: 1000,
} as const;

/** Matter collision categories (bitmask). */
export const CAT = {
  WALL: 0x0001,
  CAR: 0x0002,
} as const;

/** Prefixes of object textures that should render ABOVE the cars. */
export const TALL_PREFIXES = ['tree', 'tent', 'tribune', 'light'] as const;

/** Start-tile gids in racing.tsj (asphalt id N → gid N+1; sorted 01..90). */
export const START_TILE = {
  vertical: 42, // road_asphalt42 — road runs bottom↔top
  horizontal: 43, // road_asphalt43 — road runs left↔right
} as const;

// ── Car physics (tuning pass) ────────────────────────────────────────────
export const CAR = {
  // A CLAMP, not the speed the car reaches: GLIDE's drag cancels ACCEL at
  // ACCEL / ln(1/GLIDE) ≈ 249px/s, which is the real full-throttle cruise.
  // Anything tuned as a fraction of MAX_SPEED will therefore act far weaker
  // than it reads — use absolute px/s for speed thresholds.
  MAX_SPEED: 600,
  REVERSE_SPEED: 130, // max backward speed (tilt back to get unstuck) — kept slow
  REVERSE_ACCEL_FRAC: 0.4, // reverse builds much gentler than forward
  ACCEL: 400,
  GLIDE: 0.2, // fraction of speed retained per second (frame-rate independent)
  MAX_TURN_RATE: 2.5, // rad/s at full lock, scaled by speed
  RESTITUTION: 0.1, // low bounce so the car slides along walls
  // Speed only bleeds on a real head-on hit (velocity drops below this
  // fraction of intended); brushing a wall keeps momentum. 0 = never bleed.
  CRASH_SPEED_FRAC: 0.5,
  CRASH_BLEED: 0.2, // how fast retained speed drops toward actual on a crash
  FINISHED_ALPHA: 0.45,
  DISPLAY_LENGTH: 70, // normalise every car sprite to this length (px) — two must fit the ~85px road strip
  // Kenney car sprites point "up" (−y); +PI/2 aligns that with heading 0 (+x).
  SPRITE_FORWARD_OFFSET: Math.PI / 2,
} as const;

/**
 * The speed a car ACTUALLY reaches at full throttle, ~249px/s.
 *
 * `CAR.GLIDE` retains `GLIDE^dt` of the speed each second while `CAR.ACCEL` adds
 * to it, and the two balance at `ACCEL / ln(1/GLIDE)`. This is the number every
 * speed threshold in the game should be reasoned against — `CAR.MAX_SPEED` is a
 * clamp sitting far above it, so a threshold written as a fraction of MAX_SPEED
 * acts at less than half the strength it reads (see the note there, and
 * `ASSIST.FADE_TO`, and the dust bands in race-scene.ts).
 *
 * Derived rather than typed in, so it stays true if ACCEL or GLIDE is retuned.
 */
export const CRUISE_SPEED = CAR.ACCEL / Math.log(1 / CAR.GLIDE);

/** Matter integrates velocity per 60Hz step; px/sec ÷ this = Matter velocity. */
export const MATTER_HZ = 60;

/** DEBUG: isolate steering — no throttle, car rotates in place. Set false to drive. */
export const STEER_TEST = false;

// ── Wheel / tilt input (tuning pass) ─────────────────────────────────────
export const INPUT = {
  MAX_ANGLE_DEG: 80, // faceRoll angle mapped to full steering lock
  STEER_POWER: 1.2, // power curve: small wheel angles barely turn, ramps up toward lock
  STEER_SMOOTHING: 0.2, // output low-pass (higher = smoother/laggier)
  THROTTLE_FULL_DEG: 40, // forward/back PITCH angle mapped to full throttle
  THROTTLE_SIGN: 1, // forward tilt = forward; back tilt = reverse
  THROTTLE_DEADZONE_DEG: 3, // ignore tiny pitch wobble around rest
  THROTTLE_POWER: 2, // quadratic: throttle ∝ (forward tilt)^POWER
  THROTTLE_SMOOTHING: 0.2,
} as const;

// ── Steering assist (difficulty) ──────────────────────────────────────────
/**
 * "Pull toward the racing line". Implemented as a HEADING nudge, not a force:
 * the car is kinematic (we own heading + speed and hand Matter a velocity), so a
 * force would just be overwritten next frame. The nudge aims at a lookahead
 * point on the line, which corrects sideways offset and heading together.
 */
/**
 * How much help one difficulty gets. Five numbers rather than one, because
 * "more assist" is not a single knob — each of these can silently cancel the
 * others, and turning up only the rate does nothing at all if the speed fade has
 * already zeroed it. The boost powerup layers `AssistProfile` on top of whichever
 * of these is in play.
 */
export interface AssistTuning {
  /**
   * Max heading correction, rad/s. The scale that matters: the player's own
   * authority is `CAR.MAX_TURN_RATE` (2.5 rad/s), and holding a 64px-radius bend
   * at cruise needs v/r ≈ 3.9 rad/s. Below ~2.5 the assist can straighten a car
   * out but can never take a corner; above ~4 it can drive the track.
   */
  maxRate: number;
  /** Speed fade, ABSOLUTE px/s: full help below `fadeFrom`, none from `fadeTo`. */
  fadeFrom: number;
  fadeTo: number;
  /** No correction within this far of the line (px). */
  deadzonePx: number;
  /** How much full steering lock suppresses the assist (0 = never yields). */
  playerOverride: number;
  /** Give up beyond this far off the line — spun out, in the grass (px). */
  maxOffset: number;
}

export const ASSIST = {
  /**
   * The three tiers. `easy` pulls hardest, `hard` not at all.
   *
   * **These are an assist, not an autopilot, and the four numbers after
   * `maxRate` are what make that true.** An autopilot was tried and rejected on
   * device: it holds the racing line to within ~35px hands-off, and it feels
   * like the car has been taken away from you, because nothing ever makes it let
   * go. Keep all five in mind before turning any one of them up —
   *
   *  - `maxRate` at 2.2 sits under the player's own `CAR.MAX_TURN_RATE` (2.5)
   *    and well under the ~3.9 rad/s a 64px bend needs at cruise. That is the
   *    line between the two behaviours: the pull can straighten a car out, but
   *    it can never take a corner for the player.
   *  - `fadeTo` at 230 is just UNDER real cruise (~249 px/s), so driving at pace
   *    switches the assist off entirely. This is most of why it feels like it
   *    lets go rather than nagging.
   *  - `deadzonePx` gives the car an 8px corridor to wander in of its own
   *    accord, so it is not being corrected every frame.
   *  - `playerOverride` at 0.7 means deliberate steering wins. Without it the
   *    assist fights the player through every corner they meant to take.
   *  - `maxOffset` gives up past 130px — spun out or in the grass is a job for
   *    the rewind, not for a nudge.
   */
  BY_DIFFICULTY: {
    easy: {
      maxRate: 2.2,
      fadeFrom: 80,
      fadeTo: 230,
      deadzonePx: 8,
      playerOverride: 0.7,
      maxOffset: 130,
    },
    medium: {
      maxRate: 0.9,
      fadeFrom: 80,
      fadeTo: 230,
      deadzonePx: 8,
      playerOverride: 0.7,
      maxOffset: 130,
    },
    hard: {
      maxRate: 0,
      fadeFrom: 80,
      fadeTo: 230,
      deadzonePx: 8,
      playerOverride: 0.7,
      maxOffset: 130,
    },
  } satisfies Record<Difficulty, AssistTuning>,
  /** Aim this far along the line: base + speed × factor (px). */
  LOOKAHEAD_BASE: 55,
  LOOKAHEAD_PER_SPEED: 0.18,
  /** Give up beyond this heading error (driving backwards) — don't spin the car. */
  MAX_ERROR_RAD: 1.9, // ~110°
  /** Below this speed (px/s) the car isn't really moving, so don't steer it. */
  MIN_SPEED: 8,
} as const;

// ── Rewind (button: put me back on the track) ─────────────────────────────
/** Available in every difficulty — it un-sticks a car rather than helping it. */
export const REWIND = {
  /**
   * How far back the car reappears, as a fraction of a lap — measured from the
   * car's BEST progress so far, not from where it currently is. So a car that
   * reached 15% respawns at 10% however many times it presses; only once it gets
   * past 15% again does the respawn point move on. Floored at the start line, so
   * early in lap 1 a rewind never throws a car back behind the start.
   */
  FRACTION: 0.05,
  COOLDOWN_MS: 700, // ignore a second press within this window
  FLASH_MS: 220, // reappear tween
} as const;

// ── Powerups ─────────────────────────────────────────────────────────────
/**
 * Pickups appear at fixed slots derived from the baked racing line, one at a
 * time on a timer. Slots are fixed per track (the line is), so they can be
 * learned; which slot and which kind are not, so they can't be camped.
 *
 * A powerup fires the INSTANT it is collected. The capsule has exactly one
 * button and it is already the rewind (see input/car-input.ts), so there is no
 * "hold and deploy" available to us — which costs nothing here, because all four
 * of these are instant effects anyway.
 */
export const POWERUP = {
  FIRST_SPAWN_MS: 6_000, // something to chase early in lap 1
  INTERVAL_MS: 30_000,
  MAX_LIVE: 4,
  SLOTS: 10, // candidate positions round the loop
  SLOT_LATERAL: 22, // ± across the line, so they're worth steering for (px)
  PICKUP_RADIUS: 34,
  ICON_PX: 52,
  BOB_MS: 900,
} as const;

/**
 * Freeze: everyone EXCEPT the taker crawls for three seconds.
 *
 * "20% of their max speed" measured against `CRUISE_SPEED`, NOT `CAR.MAX_SPEED`.
 * MAX_SPEED is a clamp the car never reaches, so `0.2 × 600 = 120px/s` would be
 * very nearly HALF of real cruise and would read as a mild lift off the throttle
 * rather than a freeze. Against cruise the same 20% is ~50px/s, which is the
 * crawl the brief was describing.
 */
export const FREEZE = {
  DURATION_MS: 5_000,
  SPEED_CAP: CRUISE_SPEED * 0.2,
  PULSE_MS: 420, // light blue ↔ white, one round trip
  TINT_A: 0x8fd8ff,
  TINT_B: 0xffffff,
} as const;

/**
 * Speed: the taker gets three seconds of more of everything.
 *
 * ACCEL_SCALE, not a max-speed multiplier, for the reason above: raising a clamp
 * the car never reaches does nothing at all. Cruise is `ACCEL / ln(1/GLIDE)`,
 * which is LINEAR in ACCEL, so ×1.5 moves real cruise from ~249 to ~374px/s —
 * the +50% the brief actually asked for.
 *
 * The assist half needs BOTH overrides, and neither is optional:
 *  - ASSIST.MAX_RATE.hard is 0, so a multiplier alone leaves hard at zero and
 *    the "better assist" would silently do nothing for a third of the players.
 *    RATE_FLOOR is what gives them something to scale.
 *  - ASSIST.FADE_TO is 230px/s and boosted cruise is ~374, so the existing speed
 *    fade would zero the assist EXACTLY while boosted. Without ASSIST_FADE_TO
 *    the whole assist half of this powerup is a no-op.
 */
export const BOOST = {
  DURATION_MS: 5_000,
  ACCEL_SCALE: 1.5,
  ASSIST_RATE_SCALE: 2,
  /**
   * rad/s, and a FLOOR rather than the value: it only decides what `hard` and
   * `medium` get, since easy's own 5 rad/s already exceeds it and the scale
   * takes that to 10. Still under the ~3.9 rad/s a 64px bend needs at cruise, so
   * a boosted medium driver is helped but is not driven.
   */
  ASSIST_RATE_FLOOR: 1.2,
  /**
   * The fade BAND, moved bodily above boosted cruise (~374px/s) — both ends, not
   * just the far one.
   *
   * Moving only `ASSIST_FADE_TO` was the first attempt and it silently failed:
   * the tier's own `fadeFrom` of 80 stayed put, so the smoothstep across 80→420
   * was already 95% complete at 374px/s and a 4.4 rad/s pull arrived as 0.23.
   * With FROM above the speed the boost actually produces, the assist runs at
   * full strength for the whole five seconds and fades only if the car somehow
   * goes faster still.
   */
  ASSIST_FADE_FROM: 400,
  ASSIST_FADE_TO: 700,
  RAINBOW_PERIOD_S: 1.1, // faster than pin-the-tail's 1.6 — this is a sprint
} as const;

/**
 * Oil: 3–5 one-shot slicks dropped BEHIND the taker, so they threaten the field
 * rather than the person who picked the powerup up.
 */
export const OIL = {
  MIN: 2,
  MAX: 3,
  /**
   * How far back to drop them, as a fraction of a lap. The batch is spread
   * EVENLY across this corridor with jitter inside each slot, rather than each
   * slick picking a random point in the whole of it: random placement in a
   * ~440px corridor collided with itself constantly, and every collision used to
   * mean a slick that simply never appeared. Even slots also read better — a
   * trail of oil rather than a clump.
   */
  BEHIND_FROM: 0.02,
  BEHIND_TO: 0.18,
  LATERAL: 26, // ± across the line (px)
  /**
   * Preferred spacing, and only preferred — see `OilSlicks.place`. Enforcing it
   * as a hard filter is what made a second oil powerup on the same stretch drop
   * one slick or none at all: slicks are one-shot but never expire, so the live
   * ones from the last lap blocked every candidate for the next batch.
   */
  MIN_GAP_PX: 52,
  /** Tries per slick before it is placed on the best on-road spot found anyway. */
  PLACE_ATTEMPTS: 6,
  /** Oldest slicks are retired past this, so a long race can't tile the track. */
  MAX_LIVE: 12,
  RADIUS: 30,
  SPRITE_PX: 64,
  /**
   * The dropper is immune this long. They are dropped behind, so this should
   * never fire — but a rewind puts a car back down the line onto its own oil,
   * and being spun by your own powerup reads as a bug rather than a joke.
   */
  DROPPER_GRACE_MS: 2_500,
} as const;

/** Hitting oil: the car is taken away from the player for a moment. */
export const SPIN = {
  DURATION_MS: 1_100,
  TURNS: 2,
  /**
   * Speed ceiling while spinning, as a fraction of real cruise — a spin scrubs
   * pace. A CAP rather than a per-frame multiplier: multiplying every frame
   * compounds to a dead stop in a few hundred ms, which is a crash, not a spin.
   */
  SPEED_CAP: CRUISE_SPEED * 0.35,
} as const;

/** Replace: the taker and a random rival exchange places, wholesale. */
export const SWAP = {
  TWEEN_MS: 450,
  /** Both cars dip to this scale and alpha at the midpoint of the swap. */
  DIP_SCALE: 0.55,
  DIP_ALPHA: 0.25,
} as const;

// ── Walls ────────────────────────────────────────────────────────────────
export const WALL_RESTITUTION = 0.1;

// ── Spawns (two columns behind the start line; must fit the road strip) ───
export const SPAWN = {
  COL_OFFSET: 20, // ± across the road (px)
  ROW_GAP: 84, // between grid rows, back along −forward
  ROW_START: 30, // first row's distance behind the start line
} as const;

/** How many checkpoint gates to sample around the loop (anti-cheat). */
export const CHECKPOINTS = 4;

// ── Race rules ───────────────────────────────────────────────────────────
export const RACE = {
  LAP_MS: 60_000, // race time = one minute per lap
  // No zero-padding on the standings, unlike the other four games. Placement
  // points pay at most one per driver per race, so the whole scale is 0–20 and
  // never reaches a second digit for most of a series — "05 pts" pads a number
  // that was never going to jitter, and reads as a score that lost its hundreds.
  DEFAULT_LAPS: 3,
  MIN_LAPS: 1,
  MAX_LAPS: 6,
  MAX_PLAYERS: 4,
} as const;

/**
 * What a championship point is worth in coins. Per game, like the digit counts
 * the other four carry.
 *
 * Two points a coin, because the scale is tiny: as the comment above says,
 * placement pays at most one per driver per race. Applied to ONE RACE's points,
 * not the series total — the payout lands on every results screen — so a
 * four-car race pays its winner two coins from performance, plus the
 * participation coin and the race's placing bonus. The same divisor against a
 * Shooting Gallery total would pay thousands.
 */
export const GOLD_RULES = { scorePerCoin: 2 } as const;

/** World size of every track (9×12 cells @128px). */
export const WORLD = { width: 9 * TILE, height: 12 * TILE } as const;

/** Camera framing. ZOOM_SCALE > 1 enlarges the track (more edge overflow). */
export const CAMERA = { ZOOM_SCALE: 1.2 } as const;
