import Phaser from 'phaser';
import { BALL, BOUNCE, CAPTURE_MS, DEPTH, PHYSICS } from '../constants';
import type { Tuning } from '../difficulty';
import { ballKey, type BallColour } from '../assets';
import type { BallSize } from '../level/types';
import {
  decayExternal,
  kickVelocity,
  reflectOff,
  steerVector,
  stepVelocity,
  type Vec,
} from '../motion';
import { CAT } from '../world/board';

/**
 * `rolling` — under the player's control.
 * `falling` — the capture animation is running; no input, no physics.
 * `out`     — dead and off the board, waiting for the mode to decide what next.
 * `home`    — in the goal. Final: a finished ball never comes back.
 */
export type BallState = 'rolling' | 'falling' | 'out' | 'home';

/**
 * One player's ball: a Matter circle and a sprite that follows it.
 *
 * Matter's `body.velocity` is displacement per PHYSICS STEP, not per second, so
 * everything crossing this boundary is converted — the model in `motion.ts`
 * works in px/s, which is what the difficulty table is written in and what a
 * number on the screen would mean.
 */
export class Ball {
  readonly body: MatterJS.BodyType;
  readonly sprite: Phaser.GameObjects.Image;
  readonly radius: number;
  state: BallState = 'rolling';
  /** Set when the ball goes home; the run's elapsed time in ms. */
  finishedAtMs: number | null = null;
  deaths = 0;

  /** What the tilt is asking for, px/s. */
  private steering: Vec = { x: 0, y: 0 };
  /** What the board did to it — a bouncy block's kick — px/s, bled away each frame. */
  private external: Vec = { x: 0, y: 0 };
  private inWorld = true;

  constructor(
    private scene: Phaser.Scene,
    readonly seat: number,
    colour: BallColour,
    size: BallSize,
    x: number,
    y: number,
  ) {
    this.radius = size === 'large' ? BALL.largeRadius : BALL.smallRadius;
    this.body = scene.matter.bodies.circle(x, y, this.radius, {
      restitution: BALL.restitution,
      friction: BALL.friction,
      // Air friction is zero because the game integrates its own drag — see
      // `motion.ts`. Leaving Matter's on would damp the ball twice.
      frictionAir: 0,
      collisionFilter: { category: CAT.BALL, mask: CAT.BALL | CAT.WALL, group: 0 },
    });
    scene.matter.world.add(this.body);

    this.sprite = scene.add
      .image(x, y, ballKey(colour, size))
      .setDisplaySize(this.radius * 2, this.radius * 2)
      .setDepth(DEPTH.ball);
  }

  /** Copy the body's transform onto the sprite. Called after each step. */
  sync(): void {
    this.sprite.setPosition(this.body.position.x, this.body.position.y);
    this.sprite.setRotation(this.body.angle);
  }

  get x(): number {
    return this.body.position.x;
  }

  get y(): number {
    return this.body.position.y;
  }

  /** Speed in px/s — for the rolling sound and for debug readouts. */
  get speed(): number {
    return Math.hypot(this.body.velocity.x, this.body.velocity.y) * PHYSICS.stepHz;
  }

  /**
   * One frame of motion: the tilt's component is integrated, the board's
   * component is bled away, and their sum is written to the body.
   *
   * The ball owns its velocity rather than reading it back out of Matter each
   * frame. That was tried first and is what made the bouncy blocks do nothing:
   * a kick written during the physics step is reworked by the rest of that step
   * (Matter keeps velocity in `positionPrev`, and `preSolveVelocity` /
   * `solveVelocity` / `_bodiesUpdateVelocities` all rewrite it afterwards), so
   * by the time anything read it back the kick had been folded away.
   *
   * What the game gives up by owning it: Matter no longer feeds impacts back
   * into the ball's motion — a plain wall stops it only by stopping its
   * movement, and two balls shove each other apart without exchanging speed.
   * Both are things this game can add deliberately through `external` if they
   * turn out to be missed.
   */
  drive(axes: { x: number; y: number }, tuning: Tuning, dtS: number): void {
    if (this.state !== 'rolling') return;
    this.steering = stepVelocity(this.steering, steerVector(axes), tuning, dtS);
    this.external = decayExternal(this.external, BOUNCE.decayPerFrame, dtS, BOUNCE.spentPxS);
    this.scene.matter.body.setVelocity(this.body, {
      x: (this.steering.x + this.external.x) / PHYSICS.stepHz,
      y: (this.steering.y + this.external.y) / PHYSICS.stepHz,
    });
  }

  /**
   * A kick off a bouncy block, given the surface normal pointing away from it.
   *
   * Only the ball's OWN state is touched — the body is written on the next
   * `drive`, which is the scene's update and therefore the last write of the
   * frame. Setting the body here instead would put the value in the middle of a
   * physics step, where the rest of that step overwrites it.
   */
  bounce(normal: Vec, minSpeed: number): void {
    if (this.state !== 'rolling') return;
    const total = {
      x: this.steering.x + this.external.x,
      y: this.steering.y + this.external.y,
    };
    const next = kickVelocity(total, normal, minSpeed);
    // Nothing came back — the ball was already leaving this surface. Leave
    // whatever kick it is carrying alone rather than wiping it.
    if (next.x === 0 && next.y === 0) return;
    this.external = next;
  }

  /**
   * A plain wall, or the board's frame: the ball turns around. Both components
   * are mirrored, so the reversal is the ball's actual direction of travel
   * changing rather than a force pushing back against the tilt — nothing is
   * added, and a tilt still held into the wall has to win the ball back from
   * the far side, under the heavy `glideS`.
   */
  mirror(normal: Vec, keep: number): void {
    if (this.state !== 'rolling') return;
    this.steering = reflectOff(this.steering, normal, keep);
    this.external = reflectOff(this.external, normal, keep);
  }

  /**
   * The falling-in animation, used for a death and for a goal alike: the ball
   * is pulled to the centre of the pit and shrinks out of sight. Physics is
   * detached first, or the ball fights the tween all the way down.
   */
  fallInto(x: number, y: number, onDone: () => void): void {
    this.state = 'falling';
    this.leaveWorld();
    this.scene.tweens.add({
      targets: this.sprite,
      x,
      y,
      scale: this.sprite.scale * 0.15,
      alpha: 0.35,
      duration: CAPTURE_MS,
      ease: 'Quad.easeIn',
      onComplete: onDone,
    });
  }

  /** Put the ball back on the board at (x, y), stopped and at rest. */
  respawn(x: number, y: number): void {
    // Both components, not just the body: a ball that died mid-kick would
    // otherwise reappear on the start still carrying it.
    this.steering = { x: 0, y: 0 };
    this.external = { x: 0, y: 0 };
    this.scene.matter.body.setPosition(this.body, { x, y }, false);
    this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
    this.scene.matter.body.setAngularVelocity(this.body, 0);
    if (!this.inWorld) {
      this.scene.matter.world.add(this.body);
      this.inWorld = true;
    }
    this.sprite.setPosition(x, y).setAlpha(1).setScale(1).setVisible(true);
    this.sprite.setDisplaySize(this.radius * 2, this.radius * 2);
    this.state = 'rolling';
    // A ball that pops back into existence at full size reads as a different
    // ball; growing into place says "this one again".
    this.scene.tweens.add({
      targets: this.sprite,
      scale: { from: this.sprite.scale * 0.4, to: this.sprite.scale },
      duration: 220,
      ease: 'Back.easeOut',
    });
  }

  /** Hide the ball and take it out of the simulation. */
  park(state: BallState): void {
    this.state = state;
    this.leaveWorld();
    this.sprite.setVisible(false);
  }

  private leaveWorld(): void {
    if (!this.inWorld) return;
    this.inWorld = false;
    // Guarded because `destroy` runs from the scene's SHUTDOWN handler, and
    // MatterPhysics registers its own shutdown at plugin boot — so by then the
    // world has already been destroyed and `matter.world` is null. The body
    // died with it; there is nothing left to remove.
    this.scene.matter.world?.remove(this.body);
  }

  destroy(): void {
    this.leaveWorld();
    this.sprite.destroy();
  }
}
