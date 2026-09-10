import { registerEffects, type FxDefinition } from '@kapsel/shared';

/**
 * This game's own particle effects, keyed `rc-*` so nothing can collide with the
 * shared set in the page-level registry — the same rule its textures and sounds
 * follow.
 *
 * Registered on import, like `RACING_SOUNDS`: it fills a map and does nothing
 * else, so importing this module anywhere in the game is the whole wiring.
 *
 * The numbers here are a **starting point, not a tuning pass.** Nobody has seen
 * them on a phone yet, and how much dust reads as "sliding" rather than "on
 * fire" is exactly the kind of thing this repo insists on measuring on the
 * device rather than inferring from the source.
 */
export const RACING_FX: Readonly<Record<string, FxDefinition>> = {
  /**
   * Tyre dust, one plume per car, positioned and driven every frame by the race
   * scene. Sits at `DEPTH.objLow` so it lays on the road *under* the cars.
   *
   * The ramp drives rate and speed only. Deliberately not `scale` or `alpha`:
   * those carry start/end curves here, and ramping them would replace the curve
   * with a constant and flatten every particle's fade.
   */
  'rc-dust': {
    art: { texture: 'rc-smoke' },
    kind: 'flow',
    maxParticles: 140,
    config: {
      lifespan: 650,
      // GROWS as it disperses, rather than shrinking to a point. Kicked-up dust
      // spreads out on its way to nothing, and a particle that only ever gets
      // smaller spends its whole life being harder to see.
      //
      // Larger than the values the generated `puff` frame used, because the
      // source art is 51px across where an atlas cell is 64 — same size on
      // screen, different multiplier.
      scale: { start: 0.3, end: 1.1 },
      alpha: { start: 0.85, end: 0 },
      // NO tint on purpose. The art already carries its own colour, and a Phaser
      // tint is a multiply — every value except white can only darken it.
      //
      // A plain NUMBER, not a `{ min, max }` fan, and that matters: the scene
      // re-aims this every frame to point away from the car, and
      // `setEmitterAngle` can only move a single value. Given a range, the
      // underlying op clamps into it instead of shifting it, so the dust would
      // stay pinned to whatever arc was baked in here. The spread is applied by
      // the scene instead, as jitter around the aim.
      angle: 180,
      // Starting values; the intensity ramp overwrites all three immediately.
      frequency: 90,
      quantity: 0,
      speed: 30,
    },
    // Frequency is a GAP in ms, so it runs downhill: more cornering, less wait.
    // Quantity bottoms out at ZERO rather than one, which is what actually
    // silences the plume — a parked car raises no dust, and the emitter keeps
    // running a no-op flow cycle rather than needing to be stopped and started.
    intensity: { frequency: [90, 16], quantity: [0, 5], speed: [30, 150] },
  },

  /**
   * Tyre smoke from a car actually cornering, as opposed to the trail every
   * moving car leaves. Bigger, slower and longer-lived than `rc-dust`: this is
   * the one that should read across the track, so it is worth the particles.
   *
   * Emitted from the same point as `rc-dust`, at the back of the car. The two
   * plumes are one place and two behaviours, not two places.
   *
   * **No speed, and so no `angle` either.** These do not get thrown anywhere:
   * they hang where they were dropped and bloom, and the car drives out from
   * under them. That is what separates lingering tyre smoke from the trail, which
   * is thrown back hard. With `speed: 0` the emission angle multiplies out to
   * nothing, so there is nothing to aim and the scene does not try.
   *
   * Sparse on purpose: these are big and long-lived, and a handful reads as
   * smoke where a stream reads as fog.
   */
  'rc-slide': {
    art: { texture: 'rc-smoke' },
    kind: 'flow',
    maxParticles: 60,
    config: {
      lifespan: 900,
      scale: { start: 0.45, end: 1.7 },
      alpha: { start: 0.9, end: 0 },
      frequency: 150,
      quantity: 0,
      speed: 0,
    },
    intensity: { frequency: [150, 70], quantity: [0, 2] },
  },

  /**
   * A powerup being collected. The ONLY particle the powerups get.
   *
   * Everything ongoing — the freeze, the boost — is a tint instead, because
   * `shared/src/fx/spawn.ts` caps live emitters at 24 and this game already runs
   * eight flows (two per car, four cars). Four boost plumes plus four freeze
   * auras would sit on that ceiling, and only bursts are evictable, so the
   * one-shots would be what started getting silently refused.
   *
   * A burst is affordable precisely because it is a burst: it tidies itself away
   * once the last particle dies.
   */
  'rc-pickup': {
    art: 'spark',
    kind: 'burst',
    count: 14,
    maxParticles: 60,
    config: {
      lifespan: { min: 260, max: 480 },
      speed: { min: 60, max: 190 },
      scale: { start: 0.42, end: 0 },
      alpha: { start: 1, end: 0 },
      rotate: { min: 0, max: 360 },
    },
  },

  /**
   * A car hitting an oil slick. Smoke thrown outwards from the point of contact.
   *
   * Its own definition rather than a burst of `rc-slide`, which is built to sit
   * exactly where it was dropped (`speed: 0`, see above) — as a one-shot that
   * piles every particle on one pixel and reads as a smudge rather than a spray.
   */
  'rc-oil-hit': {
    art: { texture: 'rc-smoke' },
    kind: 'burst',
    count: 10,
    maxParticles: 40,
    config: {
      lifespan: { min: 420, max: 700 },
      speed: { min: 40, max: 130 },
      scale: { start: 0.35, end: 1.2 },
      alpha: { start: 0.8, end: 0 },
    },
  },

  /**
   * A driver crossing the line for the last time, over their car — and again
   * over the final standings at the end of a series.
   *
   * The one effect in the game allowed additive blending, which costs a batch
   * flush. That was easy to justify on the standings screen, where nothing else
   * is moving; over a live race it is a real cost and worth watching on the
   * phone. It stays affordable because it is rare and bounded: at most one pair
   * of bursts per driver per race, four drivers, and a burst tidies itself away
   * once its last particle dies rather than holding an emitter open.
   */
  'rc-firework': {
    art: 'spark',
    kind: 'burst',
    count: 38,
    maxParticles: 160,
    config: {
      lifespan: { min: 700, max: 1300 },
      speed: { min: 120, max: 420 },
      scale: { start: 0.55, end: 0 },
      alpha: { start: 1, end: 0 },
      gravityY: 180,
      rotate: { min: 0, max: 360 },
      blendMode: 'ADD',
      tint: [0xffe066, 0xff6b6b, 0x74c0fc, 0xb197fc, 0x8ce99a],
    },
  },
};

registerEffects(RACING_FX);
