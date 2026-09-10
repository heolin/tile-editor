import Phaser from 'phaser';
import { ControllerEvents, type GameController } from '@playground/game-core';
import { TrikiController } from '@playground/controller-triki';
import { INPUT } from '../constants';

export interface CarControl {
  steer: number; // −1 (left) … +1 (right)
  throttle: number; // 0 … 1 (no reverse)
  rewind: boolean; // rising edge of the button — put me back on the track
}

/**
 * Turns a controller into a {steer, throttle} car control each frame.
 *
 * TRIKI capsule, held like a steering wheel facing the player:
 *  - steer   = faceRoll.angleDeg (roll about the face normal / gyroZ), shaped
 *              with expo + an output low-pass, exactly like lab-wheel.
 *  - throttle = forward/back PITCH from the orientation filter (gyro-driven, so
 *              it only responds to rotation about the forward/back axis — steering
 *              roll and lateral tilt don't move it, unlike raw accelZ which any
 *              tilt shifts). Signed: forward tilt = accelerate, back = reverse.
 *  - button  = rewind (a rising edge, consumed once). Calibration deliberately
 *              does NOT live here — it belongs to the calibration screen only,
 *              so the button is free for a real gameplay action.
 *
 * Keyboard fallback: A/D or ←/→ steer, W/↑ accelerate, Space rewind.
 */
export class CarInput {
  private triki: TrikiController | null;
  private steerOut = 0;
  private throttleOut = 0;
  /** Set by the button event, consumed by the next sample(). */
  private pendingRewind = false;
  private last: CarControl = { steer: 0, throttle: 0, rewind: false };

  constructor(private controller: GameController) {
    this.triki = controller instanceof TrikiController ? controller : null;
    controller.events.on(ControllerEvents.BUTTON_CHANGE, this.onButton);
  }

  /** Drop the button listener — the controller outlives the scene. */
  destroy(): void {
    this.controller.events.off(ControllerEvents.BUTTON_CHANGE, this.onButton);
  }

  /**
   * Latched on the event rather than polled in sample(), so a quick tap that
   * starts and ends between two frames still registers.
   */
  private onButton = (down: boolean): void => {
    if (down) this.pendingRewind = true;
  };

  sample(): CarControl {
    const rewind = this.pendingRewind;
    this.pendingRewind = false;

    if (!this.triki) return (this.last = { ...this.keyboard(), rewind });

    // Steering: faceRoll angle → normalized → power curve → low-pass.
    const norm = Phaser.Math.Clamp(this.triki.motion.faceRoll.angleDeg / INPUT.MAX_ANGLE_DEG, -1, 1);
    const shaped = this.shapeSteer(norm);
    this.steerOut += (1 - INPUT.STEER_SMOOTHING) * (shaped - this.steerOut);

    // Throttle: forward/back PITCH (gyro-driven → isolated from steering roll and
    // lateral tilt). Forward = accelerate, back = reverse. Dead zone + quadratic.
    const raw = this.triki.motion.orientation.euler.pitch * INPUT.THROTTLE_SIGN;
    const t = this.shapeThrottle(raw);
    this.throttleOut += (1 - INPUT.THROTTLE_SMOOTHING) * (t - this.throttleOut);

    return (this.last = { steer: this.steerOut, throttle: this.throttleOut, rewind });
  }

  private keyboard(): CarControl {
    const { x, y } = this.controller.axes;
    // Up = accelerate, down = reverse.
    return {
      steer: Phaser.Math.Clamp(x, -1, 1),
      throttle: Phaser.Math.Clamp(-y, -1, 1),
      rewind: false,
    };
  }

  /** Signed throttle: dead zone around rest, then a quadratic ramp each way. */
  private shapeThrottle(raw: number): number {
    const a = Math.abs(raw);
    if (a <= INPUT.THROTTLE_DEADZONE_DEG) return 0;
    const lin = Phaser.Math.Clamp(
      (a - INPUT.THROTTLE_DEADZONE_DEG) / (INPUT.THROTTLE_FULL_DEG - INPUT.THROTTLE_DEADZONE_DEG),
      0,
      1,
    );
    return Math.sign(raw) * Math.pow(lin, INPUT.THROTTLE_POWER);
  }

  /**
   * Normalized wheel input [-1,1] → steer via a power curve (small angles turn
   * a little, larger angles ramp up). No dead zone.
   */
  private shapeSteer(n: number): number {
    // Power curve, no dead zone: small angles turn a little, large angles ramp up.
    return Math.sign(n) * Math.pow(Math.abs(n), INPUT.STEER_POWER);
  }

  /** Live input values for an on-screen tuning overlay. */
  debugInfo(): { angle: number; steer: number; throttle: number; throttleRaw: number } {
    return {
      angle: this.triki ? this.triki.motion.faceRoll.angleDeg : 0,
      steer: this.last.steer,
      throttle: this.last.throttle,
      throttleRaw: this.debugThrottleRaw(),
    };
  }

  /** Debug read of the raw throttle DOF (for tuning overlays). */
  debugThrottleRaw(): number {
    if (!this.triki) return Phaser.Math.Clamp(-this.controller.axes.y, -1, 1);
    return this.triki.motion.orientation.euler.pitch * INPUT.THROTTLE_SIGN;
  }
}
