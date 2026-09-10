import Phaser from 'phaser';
import { CAR, CAT, DEPTH, MATTER_HZ, SPIN, STEER_TEST } from '../constants';
import type { CarControl } from '../input/car-input';

/**
 * A player's car: a dynamic Matter body we drive kinematically — we own the
 * heading (from steering) and forward speed (from throttle, no reverse), and
 * feed them to Matter as a velocity so wall/object collisions still resolve as
 * real bounces. Cars share a negative collision group so they never collide
 * with each other, only with walls.
 */
export class Car {
  readonly sprite: Phaser.Physics.Matter.Sprite;
  private heading: number;
  private forwardSpeed = 0;
  private finished = false;
  /** Accumulates speed lost to walls until `takeCrashLoss` drains it. */
  private crashLoss = 0;

  /**
   * Powerup modifiers. The car owns how they are APPLIED; when they start and
   * stop is the powerup manager's, so nothing here needs a timer of its own.
   */
  private accelScale = 1;
  private speedCap = Infinity;
  private spinLeft = 0;
  private spinRate = 0;
  /** Held still by something outside the physics — the replace swap tween. */
  private suspended = false;

  constructor(
    scene: Phaser.Scene,
    readonly playerIndex: number,
    x: number,
    y: number,
    headingRad: number,
    textureKey: string,
  ) {
    this.heading = headingRad;
    const sprite = scene.matter.add.sprite(x, y, textureKey);
    const scale = CAR.DISPLAY_LENGTH / Math.max(sprite.width, sprite.height);
    sprite.setScale(scale);

    const bw = sprite.width * scale;
    const bh = sprite.height * scale;
    sprite.setBody(
      { type: 'rectangle', width: bw, height: bh },
      {
        frictionAir: 0,
        friction: 0,
        restitution: CAR.RESTITUTION,
        // Bake the spawn angle into the body — the physics step syncs the
        // sprite FROM the body each frame, so setRotation alone gets reset.
        angle: headingRad + CAR.SPRITE_FORWARD_OFFSET,
      },
    );
    sprite.setFixedRotation(); // heading is ours; collisions must not spin it
    sprite.setCollisionGroup(-1); // same negative group → cars ignore each other
    sprite.setCollisionCategory(CAT.CAR);
    sprite.setCollidesWith(CAT.WALL);
    sprite.setDepth(DEPTH.cars);

    this.sprite = sprite;
    this.applyRotation();
  }

  get x(): number {
    return this.sprite.x;
  }
  get y(): number {
    return this.sprite.y;
  }
  get isFinished(): boolean {
    return this.finished;
  }
  get headingRad(): number {
    return this.heading;
  }
  /** Signed forward speed in px/s (negative = reversing). */
  get speed(): number {
    return this.forwardSpeed;
  }
  get isSpinning(): boolean {
    return this.spinLeft > 0;
  }
  get isSuspended(): boolean {
    return this.suspended;
  }

  /**
   * Multiplier on acceleration — the speed powerup.
   *
   * Acceleration and NOT `CAR.MAX_SPEED`, because MAX_SPEED is a clamp the car
   * never reaches: raising it changes nothing. Real cruise is
   * `ACCEL / ln(1/GLIDE)`, which is linear in ACCEL, so a ×1.5 here is the +50%
   * that was actually asked for. See `CRUISE_SPEED` in constants.ts.
   */
  setAccelScale(scale: number): void {
    this.accelScale = scale;
  }

  /** Ceiling on forward speed — the freeze. `Infinity` clears it. */
  setSpeedCap(cap: number): void {
    this.speedCap = cap;
  }

  /**
   * Take the car away from the player for a moment — hitting oil.
   *
   * Direction is random so two cars hitting the same slick don't mirror each
   * other, which reads as scripted rather than as a loss of grip.
   */
  spin(durationMs: number, turns: number): void {
    if (this.finished) return;
    const seconds = durationMs / 1000;
    this.spinLeft = seconds;
    this.spinRate = ((Math.random() < 0.5 ? -1 : 1) * turns * Math.PI * 2) / seconds;
  }

  /**
   * Freeze the car outside the physics, for an animation that owns its position
   * (the replace swap). `update` becomes a no-op and Matter is given a stopped
   * body, so the tween is the only thing moving it.
   */
  setSuspended(on: boolean): void {
    this.suspended = on;
    if (on) {
      this.forwardSpeed = 0;
      this.sprite.setVelocity(0, 0);
      this.sprite.setAngularVelocity(0);
    }
  }

  /** Drop every powerup modifier — the effect ended, or the race did. */
  clearModifiers(): void {
    this.accelScale = 1;
    this.speedCap = Infinity;
    this.spinLeft = 0;
    this.spinRate = 0;
    this.sprite.clearTint();
  }

  /**
   * Speed lost to a wall since this was last called, in px/s, then cleared.
   * Read-and-clear rather than a flag: a scrape bleeds a little over many frames
   * and a head-on hit takes a lot in one, and only the caller knows where its
   * threshold between the two is.
   */
  takeCrashLoss(): number {
    const loss = this.crashLoss;
    this.crashLoss = 0;
    return loss;
  }

  /**
   * Put the car back on the track: position, heading, and dead stop. Used by the
   * rewind. The Matter velocity has to be zeroed too, or the body keeps the
   * momentum it had before the jump.
   */
  resetTo(x: number, y: number, headingRad: number): void {
    if (this.finished) return;
    this.heading = headingRad;
    this.forwardSpeed = 0;
    // A rewind out of a spin ends the spin: the car has been picked up and put
    // back pointing the right way, and leaving it turning would immediately undo
    // the one thing the rewind is for.
    this.spinLeft = 0;
    this.sprite.setPosition(x, y);
    this.sprite.setVelocity(0, 0);
    this.sprite.setAngularVelocity(0);
    this.applyRotation();
  }

  /**
   * `assistRad` is a pre-clamped heading correction from the steering assist
   * (see race/steering-assist.ts). It is applied on top of the player's own
   * steering, and only while the car is actually moving.
   */
  update(dt: number, control: CarControl, assistRad = 0): void {
    if (this.finished) return;
    // Something outside the physics owns the car's position this frame.
    if (this.suspended) {
      this.sprite.setVelocity(0, 0);
      return;
    }

    // DEBUG: isolate rotation — no forward motion, rotate in place from the wheel.
    if (STEER_TEST) {
      this.heading += control.steer * CAR.MAX_TURN_RATE * dt;
      this.forwardSpeed = 0;
      this.sprite.setVelocity(0, 0);
      this.sprite.setAngularVelocity(0);
      this.applyRotation();
      return;
    }

    // Only a real head-on hit bleeds momentum (gently). Brushing a wall keeps
    // speed, so the car slides along it instead of grinding to a halt.
    const v = this.sprite.body?.velocity ?? { x: 0, y: 0 };
    const actual = Math.hypot(v.x, v.y) * MATTER_HZ;
    if (actual < Math.abs(this.forwardSpeed) * CAR.CRASH_SPEED_FRAC) {
      const before = Math.abs(this.forwardSpeed);
      this.forwardSpeed = Phaser.Math.Linear(
        this.forwardSpeed,
        Math.sign(this.forwardSpeed) * actual,
        CAR.CRASH_BLEED,
      );
      // Speed genuinely lost to the wall this frame. Recorded rather than
      // reported, because the impact is a physics fact and what to do with it
      // (a sound, a shake, nothing) is the scene's decision.
      this.crashLoss = Math.max(this.crashLoss, before - Math.abs(this.forwardSpeed));
    }

    // Throttle → speed. Forward accelerates and back-tilt brakes at full strength
    // while still moving forward; only building actual reverse (speed ≤ 0) is gentle.
    const reversing = control.throttle < 0 && this.forwardSpeed <= 0;
    const base = reversing ? CAR.ACCEL * CAR.REVERSE_ACCEL_FRAC : CAR.ACCEL;
    this.forwardSpeed += control.throttle * base * this.accelScale * dt;
    this.forwardSpeed *= Math.pow(CAR.GLIDE, dt);
    this.forwardSpeed = Phaser.Math.Clamp(this.forwardSpeed, -CAR.REVERSE_SPEED, CAR.MAX_SPEED);

    // Powerup speed ceilings, applied AFTER acceleration and drag so they cap the
    // RESULT rather than changing how the car builds speed — a frozen car still
    // responds to the throttle, it just cannot get anywhere. Freeze and a spin can
    // both be running (spun, then frozen), so the tighter one wins.
    const spinning = this.spinLeft > 0;
    const cap = spinning ? Math.min(this.speedCap, SPIN.SPEED_CAP) : this.speedCap;
    if (this.forwardSpeed > cap) this.forwardSpeed = cap;

    // Steering → heading. Responsive even at low speed (strong minimum factor),
    // but no pivoting when essentially parked. Turns while reversing too.
    const spd = Math.abs(this.forwardSpeed);
    const moving = spd > 5;
    if (spinning) {
      // The car is away from the player: their steering and the assist are both
      // ignored for the duration, which is the whole of what a spin costs them.
      this.spinLeft -= dt;
      this.heading += this.spinRate * dt;
    } else {
      const turnFactor = moving ? Math.min(1, 0.45 + 0.55 * (spd / CAR.MAX_SPEED)) : 0;
      this.heading += control.steer * CAR.MAX_TURN_RATE * turnFactor * dt;
      if (moving) this.heading += assistRad;
    }

    const mv = this.forwardSpeed / MATTER_HZ;
    this.sprite.setVelocity(Math.cos(this.heading) * mv, Math.sin(this.heading) * mv);
    this.sprite.setAngularVelocity(0);
    this.applyRotation();
  }

  setFinished(): void {
    if (this.finished) return;
    this.finished = true;
    this.forwardSpeed = 0;
    this.sprite.setVelocity(0, 0);
    // A car that is parked for good carries no powerup: leaving a freeze tint or
    // a spin on it would keep saying something about a car nothing can happen to.
    this.clearModifiers();
    this.sprite.setAlpha(CAR.FINISHED_ALPHA);
  }

  destroy(): void {
    this.sprite.destroy();
  }

  private applyRotation(): void {
    this.sprite.setRotation(this.heading + CAR.SPRITE_FORWARD_OFFSET);
  }
}
