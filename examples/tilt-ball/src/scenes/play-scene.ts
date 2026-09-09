import Phaser from 'phaser';
import {
  UiRoot,
  flexible,
  fixed,
  loadImages,
  sfx,
  spacer,
  ui,
  verticalGroupKeyed,
  type Rect,
} from '@kapsel/shared';
// Side-effect import: registers this game's `tb-*` sound pack.
import '../sounds';
import { loadTiltBallImages, ballColour } from '../assets';
import {
  BALL,
  BOUNCE,
  FINISH_WINDOW_MS,
  FRAME,
  HUD_ROW,
  RESPAWN_MS,
  SWITCH,
  WALL,
} from '../constants';
import { tuning } from '../difficulty';
import { Ball } from '../entities/ball';
import { anyoneStillPlaying } from '../rules';
import type { RunState } from '../run-state';
import type { Session, SessionRef } from '../session';
import { Board } from '../world/board';

/** One Matter contact, with the bit of collision data the bounce needs. */
interface CollisionPair {
  bodyA: MatterJS.BodyType;
  bodyB: MatterJS.BodyType;
  collision: { normal: { x: number; y: number } };
}

/**
 * A contact slower than this makes no sound. A ball resting against a wall
 * reports a contact every step, and at four balls that is a rattle. Bouncy
 * blocks are exempt — they always did something worth hearing.
 */
const QUIET_HIT_PXS = 90;

/**
 * The board in play: everyone's ball on one screen, one clock each.
 *
 * The camera is the thing to understand first. The whole level is visible at
 * once and never scrolls — four players cannot share a camera that follows
 * anyone — so the main camera takes a viewport under the HUD band and zooms to
 * fit the board into it. The HUD lives in its own scene at zoom 1, which is why
 * nothing here calls `setScrollFactor`.
 */
export class PlayScene extends Phaser.Scene {
  private board!: Board;
  private balls: Ball[] = [];
  private worldRect = { x: 0, y: 0, w: 1, h: 1 };
  /** Read from the ref in `create`, so a restart picks up the current level. */
  private session!: Session;
  private ballsByBody = new Map<number, Ball>();
  /** Bouncy-block hits seen during the physics step, applied in `update`. */
  private pendingBounces: {
    ball: Ball;
    normal: { x: number; y: number };
    surface: 'block' | 'wall' | 'lever';
  }[] = [];

  constructor(
    private ref: SessionRef,
    private run: RunState,
  ) {
    super('Play');
  }

  preload(): void {
    loadImages(this);
    loadTiltBallImages(this);
  }

  create(): void {
    this.session = this.ref.require();
    const level = this.session.currentLevel();
    this.run.reset(level, this.session.seats.length, this.session.seriesLabel());
    this.run.startRun = () => this.startRun();

    this.board = new Board(this, level);
    this.run.locksNeeded = this.board.lockColours();

    this.balls = this.session.seats.map((_, seat) => {
      const at = this.spawnPoint(seat);
      return new Ball(this, seat, ballColour(seat), level.ballSize, at.x, at.y);
    });
    this.ballsByBody = new Map(this.balls.map((ball) => [ball.body.id, ball]));
    this.matter.world.on(Phaser.Physics.Matter.Events.COLLISION_START, this.onCollision);

    // A framed board's frame straddles its edge, so the view has to include it.
    // An open board has no frame, but a ball dies with its centre ON the edge —
    // so the margin there is one radius, and the fall stays on screen.
    const margin = level.edges === 'open' ? this.ballRadius : FRAME.thickness;
    this.worldRect = {
      x: -margin,
      y: -margin,
      w: level.widthPx + margin * 2,
      h: level.heightPx + margin * 2,
    };

    new UiRoot(this, (screen) => this.place(screen));

    // The HUD owns the countdown: it draws at zoom 1, and the board's camera is
    // zoomed to somewhere near 0.6, which would render "3 · 2 · 1" small and in
    // the middle of the level rather than the middle of the screen.
    this.scene.launch('Hud');

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // The COLLISION_START listener deliberately is NOT removed here.
      // MatterPhysics registers its own shutdown at plugin boot, so it runs
      // BEFORE this handler and has already destroyed the world and nulled
      // `this.matter.world` — reaching for it here throws, and the listener died
      // with the world anyway. Merge Zoo carries the same note.
      this.board.destroy();
      for (const ball of this.balls) ball.destroy();
      this.balls = [];
    });
  }

  /**
   * Wall knocks. Every contact a ball makes is one of three sounds, and which
   * one is decided by what it hit — the springy blocks answer with a rise, so
   * the two are never confused mid-roll.
   *
   * Volume follows the speed the ball arrived at, and a slow contact makes no
   * sound at all: a ball resting against a wall generates contacts every step,
   * and at four balls that is a rattle nobody asked for.
   */
  private readonly onCollision = (event: { pairs: CollisionPair[] }): void => {
    if (!this.run.running) return;
    for (const pair of event.pairs) {
      const ballA = this.ballsByBody.get(pair.bodyA.id);
      const ballB = this.ballsByBody.get(pair.bodyB.id);
      const ball = ballA ?? ballB;
      if (ball === undefined || ball.state !== 'rolling') continue;
      const speed = ball.speed;
      const volume = Math.min(speed / 700, 1);
      const other = ballA === undefined ? pair.bodyA : pair.bodyB;

      if (ballA !== undefined && ballB !== undefined) {
        // Ball against ball: the same knock, quieter — it is a nudge, not a wall.
        if (speed >= QUIET_HIT_PXS) sfx('tb-wall', { volume: volume * 0.5 });
      } else if (this.board.isBouncy(other.id)) {
        // Always seen and heard, however gently it was touched: the block did
        // something, and a kick with no recoil reads as the ball's own doing.
        // The push itself is only QUEUED here — see `applyBounces`.
        this.queueBounce(ball, pair, ballA !== undefined, 'block');
        this.board.kick(other.id);
        sfx('tb-bounce', { volume: Math.max(volume, 0.55) });
      } else {
        // A plain wall, the board's frame, or a lever. The wall gives back the
        // speed the ball arrived at and nothing more; the lever gives back
        // less, because it is something you go and press rather than something
        // that throws you off it.
        //
        // Asked first, because the answer decides the bounce. The throw itself
        // is the board's business — it owns the laser and plays its own cue.
        const lever = this.board.hitSwitch(other.id, this.time.now);
        this.queueBounce(ball, pair, ballA !== undefined, lever ? 'lever' : 'wall');
        if (!lever && speed >= QUIET_HIT_PXS) sfx('tb-wall', { volume });
      }
    }
  };

  /**
   * Remember which way to kick, for `applyBounces` to do from `update`.
   *
   * The push CANNOT be applied here, and that is the bug this shape exists to
   * fix — the blocks animated and sounded but never actually moved the ball.
   * Matter fires `collisionStart` in the MIDDLE of a step and then rewrites
   * `positionPrev`, which is where it really keeps velocity, three more times
   * before that step ends: `solvePosition`, `preSolveVelocity` (warm-starting
   * from the cached contact impulse) and `solveVelocity`, finishing with
   * `_bodiesUpdateVelocities`. A velocity set inside the event is the one write
   * in the frame that nothing downstream preserves.
   */
  private queueBounce(
    ball: Ball,
    pair: CollisionPair,
    ballIsA: boolean,
    surface: 'block' | 'wall' | 'lever',
  ): void {
    // Matter's normal points from bodyB TOWARD bodyA — not from A to B, which is
    // the natural guess and was wrong here for two releases: `Collision.collides`
    // negates the axis whenever it agrees with `posB - posA`. And `pair.bodyA`
    // is not "the first body", it is whichever of the two has the lower id.
    //
    // So when the ball is bodyA the normal already points away from the wall,
    // and when it is bodyB it points into it. Getting this backwards pushed the
    // ball INTO the block, which looks exactly like no push at all.
    const sign = ballIsA ? 1 : -1;
    this.pendingBounces.push({
      ball,
      surface,
      normal: { x: pair.collision.normal.x * sign, y: pair.collision.normal.y * sign },
    });
  }

  /**
   * Apply the kicks collected during the physics step. Runs from `update`,
   * after the step and before steering, so this frame's drag and tilt act on a
   * ball that is already on its way off the block — and the scene's own write
   * is the last one of the frame, which is why steering has always stuck.
   */
  /**
   * Three surfaces, three rules. A bouncy block has a push of its own, sized
   * against the tilt it has to beat — the two are summed, so it must out-push a
   * player leaning into it. A plain wall adds nothing at all: it MIRRORS the
   * ball, both components, so the reversal is the direction of travel changing
   * rather than a force pushing back against the tilt. A lever mirrors too, but
   * keeps far less of the speed: it is a thing you go and press, and being
   * thrown back across the board for touching one read as a punishment.
   */
  private applyBounces(): void {
    const blockMin = tuning(this.session.difficulty).topPxS * BOUNCE.timesTopSpeed;
    for (const bounce of this.pendingBounces) {
      if (bounce.surface === 'block') bounce.ball.bounce(bounce.normal, blockMin);
      else if (bounce.surface === 'lever') bounce.ball.mirror(bounce.normal, SWITCH.bounceKeep);
      else bounce.ball.mirror(bounce.normal, WALL.bounceKeep);
    }
    this.pendingBounces.length = 0;
  }

  /** Camera viewport under the HUD band, zoomed so the whole board fits. */
  private place(screen: Rect): void {
    const rows = verticalGroupKeyed(screen, [
      fixed(ui(HUD_ROW)),
      spacer(ui(8)),
      flexible(1, { key: 'board' }),
      spacer(ui(16)),
    ]);
    const box = rows.board!;
    const camera = this.cameras.main;
    camera.setViewport(box.x, box.y, box.w, box.h);
    camera.setZoom(Math.min(box.w / this.worldRect.w, box.h / this.worldRect.h));
    camera.centerOn(this.worldRect.x + this.worldRect.w / 2, this.worldRect.y + this.worldRect.h / 2);
  }

  /**
   * Where seat `n` starts. Every level has exactly one start — nobody begins
   * nearer the goal than anybody else — so several players share it, spread
   * around it in a ring. Stacked on one point they would resolve by shoving
   * each other across the board before the countdown finished.
   *
   * The radius is set by the tightest packing that still leaves the balls
   * clear of each other: `n` balls on a circle of radius R sit `2R·sin(π/n)`
   * apart, so R = 1.5r keeps four of them from overlapping (1.5 × √2 > 2).
   */
  private spawnPoint(seat: number): { x: number; y: number } {
    const start = this.board.start;
    const sharing = this.session.seats.length;
    if (sharing <= 1) return start;
    const angle = (Math.PI * 2 * seat) / sharing - Math.PI / 2;
    const spread = this.ballRadius * 1.5;
    return { x: start.x + Math.cos(angle) * spread, y: start.y + Math.sin(angle) * spread };
  }

  private get ballRadius(): number {
    return this.session.currentLevel().ballSize === 'large' ? BALL.largeRadius : BALL.smallRadius;
  }

  private startRun(): void {
    this.run.running = true;
  }

  update(_time: number, delta: number): void {
    const dtS = delta / 1000;
    this.board.update(dtS);

    if (this.run.running) {
      this.run.elapsedMs += delta;
      // Before steering: the kick is what this frame's drag and tilt then act on.
      this.applyBounces();
      const tune = tuning(this.session.difficulty);
      for (const ball of this.balls) {
        if (ball.state !== 'rolling') continue;
        ball.drive(this.session.seats[ball.seat]!.axes, tune, dtS);
        this.checkHazards(ball);
      }
      this.tickFinishWindow(delta);
    }

    for (const ball of this.balls) ball.sync();
  }

  /** The void, beams, keys and holes, in the order a ball meets them. */
  private checkHazards(ball: Ball): void {
    // No floor under the ball's centre: a void tile, a cut corner, or — on an
    // open board — off the edge entirely. The centre, not the rim, because that
    // is the point at which a real ball tips over an edge instead of resting on
    // it. Nothing pushes back out there; the board simply stops.
    if (this.board.isVoidAt(ball.x, ball.y)) {
      this.kill(ball, 'void');
      return;
    }

    if (this.board.inBeam(ball.x, ball.y, ball.radius)) {
      this.kill(ball, 'beam');
      return;
    }

    // Spikes and saws kill exactly as a beam does: instantly, with no bounce
    // and no fall. They share its cue for now — a blade of its own is on the
    // list in docs/sounds.md.
    if (this.board.onObstacle(ball.x, ball.y, ball.radius)) {
      this.kill(ball, 'beam');
      return;
    }

    const key = this.board.keyUnder(ball.x, ball.y, ball.radius);
    if (key !== undefined) {
      key.taken = true;
      sfx('tb-key');
      this.run.locksOpened.push(key.colour);
      this.tweens.add({
        targets: key.sprite,
        y: key.sprite.y - 40,
        alpha: 0,
        scale: key.sprite.scale * 1.4,
        duration: 260,
        onComplete: () => key.sprite.destroy(),
      });
      this.board.openLock(key.colour);
    }

    const hole = this.board.holeUnder(ball.x, ball.y, ball.radius);
    if (hole === undefined) return;
    if (hole.goal) this.finish(ball, hole.x, hole.y);
    else this.kill(ball, 'hole', hole.x, hole.y);
  }

  private seatRun(ball: Ball) {
    return this.run.seats[ball.seat]!;
  }

  /**
   * A death. Versus puts the ball straight back on its start with the clock
   * still running — the finishing time IS the score there, so a death costs
   * exactly the time it costs. Story takes the ball off the board: one life,
   * and the level restarts once nobody is left rolling.
   */
  private kill(ball: Ball, cause: 'beam' | 'hole' | 'void', atX = ball.x, atY = ball.y): void {
    ball.deaths += 1;
    this.seatRun(ball).deaths = ball.deaths;
    // A beam is electric and instant; a hole and a missing floor are both a
    // fall. Two sounds for three causes, and the ball goes down the same way in
    // all of them.
    sfx(cause === 'beam' ? 'tb-laser' : 'tb-fall');
    ball.fallInto(atX, atY, () => {
      if (this.session.mode === 'versus') {
        ball.park('out');
        this.seatRun(ball).state = 'out';
        this.time.delayedCall(RESPAWN_MS, () => {
          // The level can have ended during the wait — the 15 s window does not
          // stop for a ball that is between lives.
          if (!this.scene.isActive() || !this.run.running) return;
          const at = this.spawnPoint(ball.seat);
          ball.respawn(at.x, at.y);
          sfx('tb-respawn');
          this.seatRun(ball).state = 'rolling';
        });
        return;
      }
      ball.park('out');
      this.seatRun(ball).state = 'out';
      this.afterBallSettled();
    });
  }

  private finish(ball: Ball, atX: number, atY: number): void {
    const at = this.run.elapsedMs;
    ball.finishedAtMs = at;
    sfx('tb-goal');
    ball.fallInto(atX, atY, () => {
      ball.park('home');
      const seat = this.seatRun(ball);
      seat.state = 'home';
      seat.finishedAtMs = at;
      // The first ball home starts everyone else's clock running out — but only
      // if there is somebody else out there. A solo player finishing has nobody
      // to wait for, and a 15-second countdown over an empty board reads as a
      // penalty for winning.
      if (this.run.finishWindowMs === null && this.stillPlaying(ball.seat)) {
        this.run.finishWindowMs = FINISH_WINDOW_MS;
      }
      this.afterBallSettled();
    });
  }

  /**
   * Called once a ball has finished its animation and taken its final state for
   * this attempt. Three outcomes: everybody is done (end the level), everybody
   * is dead and nobody got home (story: run it again from the top), or the
   * level carries on.
   */
  private afterBallSettled(): void {
    if (this.stillPlaying()) return;

    const anyHome = this.run.seats.some((seat) => seat.state === 'home');
    if (!anyHome && this.session.mode === 'story') {
      this.restartLevel();
      return;
    }
    this.endLevel();
  }

  private stillPlaying(exceptSeat = -1): boolean {
    return anyoneStillPlaying(this.run.seats, this.session.mode, exceptSeat);
  }

  /**
   * Story mode, everyone dead: the whole level starts again, and the clock
   * starts again with it. A player who died first has been waiting for the
   * others precisely so that this moment is shared.
   */
  private restartLevel(): void {
    this.run.running = false;
    this.time.delayedCall(700, () => {
      this.scene.stop('Hud');
      this.scene.restart();
    });
  }

  private tickFinishWindow(delta: number): void {
    if (this.run.finishWindowMs === null) return;
    this.run.finishWindowMs -= delta;
    if (this.run.finishWindowMs > 0) return;
    this.run.finishWindowMs = 0;
    // Time is up for everyone still out there. They keep their deaths and no
    // time, which is what `rankResults` puts below every finisher.
    for (const ball of this.balls) {
      if (ball.state !== 'rolling') continue;
      ball.park('out');
      this.seatRun(ball).state = 'out';
    }
    this.endLevel();
  }

  private endLevel(): void {
    if (!this.run.running) return;
    this.run.running = false;
    // Clear the window as well as stopping it: the HUD draws whatever number is
    // in it, and the level takes another beat to hand over to the results.
    this.run.finishWindowMs = null;
    this.session.record(
      this.run.seats.map((seat) => ({
        seat: seat.seat,
        timeMs: seat.finishedAtMs,
        deaths: seat.deaths,
      })),
    );
    this.time.delayedCall(600, () => {
      this.scene.stop('Hud');
      this.scene.start('Results');
    });
  }
}
