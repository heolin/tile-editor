import Phaser from 'phaser';
import {
  ActiveEffects,
  PowerupField,
  powerupDef,
  pulseTint,
  rainbowTint,
  sfx,
  vfx,
} from '@kapsel/shared';
import { BOOST, CAR, DEPTH, FREEZE, POWERUP, SPIN, SWAP } from '../constants';
import type { Car } from '../entities/car';
import type { RacingLine } from '../race/racing-line';
import type { AssistProfile } from '../race/steering-assist';
// Importing this also registers the game's `rc-*` powerup pack — see defs.ts.
import { NEEDS_RIVAL, POWERUP_KINDS, RC_BOOST, RC_FREEZE, RC_OIL, RC_REPLACE } from './defs';
import { OilSlicks } from './oil';
import { buildPowerupSlots } from './slots';

/**
 * What the powerups need from the race scene, and no more.
 *
 * `swapPlaces` is the scene's rather than this class's because the state that
 * has to move is the scene's: its per-car line index, progress and best
 * progress, plus the RaceManager's lap bookkeeping. This class knows *that* two
 * cars trade places; only the scene knows everything that means.
 */
export interface PowerupHost {
  readonly cars: readonly Car[];
  lineIndexOf(carIndex: number): number;
  swapPlaces(a: number, b: number): boolean;
  announce(carIndex: number, label: string): void;
  /**
   * Camera opt-out. The UI camera's ignore list is built during `create`, so
   * anything added later has to opt out by hand or it is drawn a second time at
   * unscrolled screen coordinates — the same treatment the dust plumes get.
   */
  adopt(obj: Phaser.GameObjects.GameObject): void;
}

const BOOST_S = BOOST.DURATION_MS / 1000;
const FREEZE_S = FREEZE.DURATION_MS / 1000;

/**
 * The whole of what a powerup DOES in this game.
 *
 * The shared runtime spawns pickups, times the effects and hands back expiries;
 * everything below decides what freeze, oil, replace and speed actually mean —
 * which is the boundary `shared/src/powerups` draws deliberately, because no
 * cross-game vocabulary of effects survives contact with a second game.
 *
 * Driven entirely by `dt` from the race scene's `update`, so a `PauseMenu`
 * pausing that scene pauses every powerup with it, for free.
 */
export class PowerupManager {
  private readonly field: PowerupField;
  private readonly oil: OilSlicks;
  private readonly active = new ActiveEffects();
  /** Own clock, in seconds, for the tints and the oil grace window. */
  private elapsed = 0;

  constructor(
    private scene: Phaser.Scene,
    private host: PowerupHost,
    private line: RacingLine | null,
  ) {
    this.oil = new OilSlicks(scene, (obj) => host.adopt(obj));
    this.field = new PowerupField(scene, {
      slots: buildPowerupSlots(line),
      kinds: () => this.eligibleKinds(),
      intervalMs: POWERUP.INTERVAL_MS,
      firstSpawnMs: POWERUP.FIRST_SPAWN_MS,
      maxLive: POWERUP.MAX_LIVE,
      radius: POWERUP.PICKUP_RADIUS,
      iconPx: POWERUP.ICON_PX,
      // Under the cars: a pickup is something you drive OVER.
      depth: DEPTH.objLow,
      bobMs: POWERUP.BOB_MS,
      onCollect: (key, car, x, y) => this.collect(key, car, x, y),
      onSprite: (sprite) => host.adopt(sprite),
    });
  }

  update(dt: number): void {
    this.elapsed += dt;

    for (const gone of this.active.update(dt)) this.undo(gone.player, gone.key);

    const cars = this.host.cars;
    this.field.update(
      dt,
      cars.map((car) => ({
        x: car.x,
        y: car.y,
        canCollect: !car.isFinished && !car.isSuspended,
      })),
    );
    this.oil.update(
      this.elapsed,
      cars.map((car) => ({
        x: car.x,
        y: car.y,
        // A spinning car is already paying; stacking a second spin on top just
        // extends the first one invisibly.
        canHit: !car.isFinished && !car.isSuspended && !car.isSpinning,
      })),
      (i, x, y) => this.hitOil(i, x, y),
    );

    this.paint();
  }

  /**
   * The boost's "better assist" half, for the scene to pass to SteeringAssist.
   *
   * All three knobs, because none of them works alone — see `AssistProfile`.
   */
  assistProfile(carIndex: number): AssistProfile | undefined {
    if (!this.active.has(carIndex, RC_BOOST)) return undefined;
    return {
      rateScale: BOOST.ASSIST_RATE_SCALE,
      rateFloor: BOOST.ASSIST_RATE_FLOOR,
      // Both ends of the fade band. Passing only `fadeTo` leaves the tier's own
      // `fadeFrom` in place and the curve is all but finished before the boost's
      // speed is reached — see the note on these constants.
      fadeFrom: BOOST.ASSIST_FADE_FROM,
      fadeTo: BOOST.ASSIST_FADE_TO,
    };
  }

  /** Effects running on a car right now — for the HUD. */
  activeKeys(carIndex: number): string[] {
    return this.active.keysFor(carIndex);
  }

  /** The race is over: clear the ground and hand every car back unmodified. */
  clear(): void {
    this.field.clear();
    this.oil.clear();
    this.active.clear();
    for (const car of this.host.cars) car.clearModifiers();
  }

  destroy(): void {
    this.field.destroy();
    this.oil.clear();
  }

  // ------------------------------------------------------------- collection

  /**
   * Drop the kinds that would do nothing right now.
   *
   * Freeze and replace both need a rival still driving; in a one-player race, or
   * once everybody else has finished, they would fire, announce themselves and
   * change nothing — which reads as a bug rather than as bad luck.
   */
  private eligibleKinds(): string[] {
    const rivals = this.host.cars.filter((car) => !car.isFinished).length;
    return POWERUP_KINDS.filter((key) => rivals >= 2 || !NEEDS_RIVAL.has(key));
  }

  private collect(key: string, carIndex: number, x: number, y: number): void {
    sfx('rc-pu-take');
    this.burst('rc-pickup', x, y, DEPTH.objHigh);
    this.host.announce(carIndex, powerupDef(key)?.label ?? '');

    switch (key) {
      case RC_BOOST:
        this.applyBoost(carIndex);
        break;
      case RC_FREEZE:
        this.applyFreeze(carIndex);
        break;
      case RC_OIL:
        this.applyOil(carIndex);
        break;
      case RC_REPLACE:
        this.applyReplace(carIndex);
        break;
    }
  }

  // ---------------------------------------------------------------- effects

  private applyBoost(carIndex: number): void {
    const car = this.host.cars[carIndex];
    if (!car) return;
    this.active.add(carIndex, RC_BOOST, BOOST_S);
    car.setAccelScale(BOOST.ACCEL_SCALE);
  }

  /** Everyone still driving EXCEPT the taker crawls. */
  private applyFreeze(taker: number): void {
    this.host.cars.forEach((car, i) => {
      if (i === taker || car.isFinished) return;
      this.active.add(i, RC_FREEZE, FREEZE_S);
      car.setSpeedCap(FREEZE.SPEED_CAP);
    });
  }

  private applyOil(taker: number): void {
    if (!this.line) return;
    this.oil.drop(this.line, this.host.lineIndexOf(taker), taker, this.elapsed);
  }

  /**
   * The taker and a random rival exchange places, wholesale.
   *
   * With nobody to swap with the pickup pays out as a boost instead. A powerup
   * that fires and does nothing is indistinguishable from a broken one, and this
   * is the only kind that can find itself with no valid target *after* it was
   * drawn — the eligibility check runs at spawn time, and a rival can finish in
   * the thirty seconds between that and someone driving over it.
   */
  private applyReplace(taker: number): void {
    const cars = this.host.cars;
    const options = cars
      .map((_, i) => i)
      .filter((i) => i !== taker && !cars[i].isFinished && !cars[i].isSuspended);
    if (options.length === 0) {
      this.applyBoost(taker);
      return;
    }

    const other = options[Math.floor(Math.random() * options.length)];
    const a = cars[taker];
    const b = cars[other];
    const from = { x: a.x, y: a.y, h: a.headingRad };
    const to = { x: b.x, y: b.y, h: b.headingRad };

    // Suspended for the duration: the tween owns both positions, so the physics
    // must not also be driving them. Matter's Transform makes `.x`/`.y` move the
    // body, so the sprites and their colliders stay together through the swap.
    a.setSuspended(true);
    b.setSuspended(true);

    this.dip(a);
    this.dip(b);
    this.scene.tweens.add({
      targets: b.sprite,
      x: from.x,
      y: from.y,
      rotation: this.shortestTurn(b, from.h),
      duration: SWAP.TWEEN_MS,
      ease: 'Sine.easeInOut',
    });
    this.scene.tweens.add({
      targets: a.sprite,
      x: to.x,
      y: to.y,
      rotation: this.shortestTurn(a, to.h),
      duration: SWAP.TWEEN_MS,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        a.setSuspended(false);
        b.setSuspended(false);
        // `resetTo` also zeroes the velocity, which is what a swap wants: both
        // drivers arrive stopped and have to get going again.
        a.resetTo(to.x, to.y, to.h);
        b.resetTo(from.x, from.y, from.h);
        this.host.swapPlaces(taker, other);
      },
    });
  }

  /**
   * Sprite rotation for a car ending up on `headingRad`, expressed so a tween
   * turns the SHORT way round.
   *
   * A tween interpolates the raw number, so handing it the wrapped target can
   * send a car the long way — nearly a full spin to change heading by a few
   * degrees. Adding the wrapped delta to the current value keeps it under half a
   * turn. `SPRITE_FORWARD_OFFSET` is in there because Kenney's cars are drawn
   * pointing up, so sprite rotation is not heading.
   */
  private shortestTurn(car: Car, headingRad: number): number {
    const current = car.sprite.rotation;
    const target = headingRad + CAR.SPRITE_FORWARD_OFFSET;
    return current + Phaser.Math.Angle.Wrap(target - current);
  }

  /** Shrink and fade to the midpoint of the swap, then back. */
  private dip(car: Car): void {
    const sprite = car.sprite;
    const scale = sprite.scale;
    this.scene.tweens.add({
      targets: sprite,
      scale: scale * SWAP.DIP_SCALE,
      alpha: SWAP.DIP_ALPHA,
      duration: SWAP.TWEEN_MS / 2,
      yoyo: true,
      ease: 'Sine.easeInOut',
      onComplete: () => sprite.setScale(scale).setAlpha(1),
    });
  }

  private hitOil(carIndex: number, x: number, y: number): void {
    const car = this.host.cars[carIndex];
    if (!car) return;
    car.spin(SPIN.DURATION_MS, SPIN.TURNS);
    sfx('rc-oil-hit');
    this.burst('rc-oil-hit', x, y, DEPTH.objLow);
  }

  /**
   * A one-shot effect, told to opt out of the UI camera.
   *
   * Same treatment the dust plumes get, and for the same reason: the UI camera's
   * ignore list is built during `create`, so an emitter added later is drawn a
   * second time at unscrolled screen coordinates unless it is handed over.
   */
  private burst(key: string, x: number, y: number, depth: number): void {
    const handle = vfx(this.scene, key, { x, y, depth });
    if (handle.emitter) this.host.adopt(handle.emitter);
  }

  private undo(carIndex: number, key: string): void {
    const car = this.host.cars[carIndex];
    if (!car) return;
    if (key === RC_BOOST) car.setAccelScale(1);
    if (key === RC_FREEZE) car.setSpeedCap(Infinity);
    // Only the car's own tint, and only once nothing else is painting it.
    if (this.active.keysFor(carIndex).length === 0) car.sprite.clearTint();
  }

  // ----------------------------------------------------------------- visual

  /**
   * The ongoing effects, as TINTS — never filters, and never emitters.
   *
   * A filter allocates a render target at canvas size, which the render-cost
   * rules forbid outright. An emitter would be affordable once but not eight
   * times: `shared/src/fx/spawn.ts` caps live emitters at 24 and this game
   * already runs two flows per car.
   *
   * Freeze wins over boost when both are running, because the freeze is the one
   * changing what the player can do about it.
   */
  private paint(): void {
    this.host.cars.forEach((car, i) => {
      // A finished car is parked for good and `setFinished` already cleared its
      // tint. Its timers are left to run down harmlessly, but repainting one
      // would put the colour straight back on a car nothing can happen to.
      if (car.isFinished) return;
      if (this.active.has(i, RC_FREEZE)) {
        car.sprite.setTint(
          pulseTint(FREEZE.TINT_A, FREEZE.TINT_B, this.elapsed, FREEZE.PULSE_MS / 1000),
        );
      } else if (this.active.has(i, RC_BOOST)) {
        car.sprite.setTint(rainbowTint(this.elapsed, BOOST.RAINBOW_PERIOD_S));
      }
    });
  }
}
