import Phaser from 'phaser';
import { DEPTH, OIL } from '../constants';
import type { RacingLine } from '../race/racing-line';

interface Slick {
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Image;
  /** Who dropped it, and until when they are immune (manager seconds). */
  dropper: number;
  graceUntil: number;
}

/**
 * The oil powerup's slicks: a handful of one-shot hazards on the road.
 *
 * Dropped BEHIND the taker, which is what makes this the one powerup aimed at
 * the field rather than at yourself — you cannot hit what you have already
 * driven past, and everyone still coming has to pick a way through.
 *
 * Hit detection is a distance check for the same reason the pickups use one:
 * with at most a handful of slicks and four cars it is a couple of dozen
 * comparisons a frame, and a Matter sensor would mean opening a new collision
 * category on cars that today only collide with walls.
 */
export class OilSlicks {
  private slicks: Slick[] = [];

  constructor(
    private scene: Phaser.Scene,
    private adopt: (obj: Phaser.GameObjects.GameObject) => void,
  ) {}

  /**
   * Lay `OIL.MIN`–`OIL.MAX` slicks back down the line from `lineIndex`.
   *
   * The batch takes one even slot each across the corridor, so no two candidates
   * in a batch can land on each other and the drop reads as a trail. Each slot
   * is then filled by `place`, which always places — the count in the constants
   * is the count that appears, from anywhere on any track.
   */
  drop(line: RacingLine, lineIndex: number, dropper: number, nowS: number): void {
    const count = Phaser.Math.Between(OIL.MIN, OIL.MAX);
    const step = (OIL.BEHIND_TO - OIL.BEHIND_FROM) / count;
    for (let i = 0; i < count; i++) {
      this.place(line, lineIndex, OIL.BEHIND_FROM + step * i, step, dropper, nowS);
    }
    this.retireOldest();
  }

  /**
   * Fill one slot with a slick: a point on the racing line, pushed sideways off
   * it along the line's own normal.
   *
   * **This always places.** The retries only look for `OIL.MIN_GAP_PX` of
   * clearance from slicks already down — spacing is a preference, not a
   * condition. Slicks are one-shot but never expire, so a second oil powerup on
   * the same stretch a lap later finds the last batch still lying there; when
   * that was a hard filter, the drop produced one slick or none.
   *
   * There is deliberately **no on-road test**. The racing line is the road
   * centreline, so a point on it is on the road by construction, and the
   * clearance either side of it measures 60px at the tightest point of all five
   * tracks against an `OIL.LATERAL` of 26 — a check could only ever fire on a
   * bug in itself, which is exactly what happened when one was tried against
   * `TrackAnalysis.loop`. Keep `OIL.LATERAL` well under that 60px and the
   * invariant holds; a slick a few px onto the verge would be cosmetic anyway,
   * where a rejected one is a powerup that did nothing.
   */
  private place(
    line: RacingLine,
    lineIndex: number,
    slotFrom: number,
    slotSpan: number,
    dropper: number,
    nowS: number,
  ): void {
    let x = 0;
    let y = 0;

    for (let attempt = 0; attempt < OIL.PLACE_ATTEMPTS; attempt++) {
      const frac = slotFrom + slotSpan * Phaser.Math.FloatBetween(0.1, 0.9);
      const s = line.sample(line.advance(lineIndex, -frac * line.length));
      const side = Phaser.Math.FloatBetween(-1, 1) * OIL.LATERAL;
      x = s.x - Math.sin(s.headingRad) * side;
      y = s.y + Math.cos(s.headingRad) * side;
      if (!this.slicks.some((o) => Phaser.Math.Distance.Between(o.x, o.y, x, y) < OIL.MIN_GAP_PX)) {
        break;
      }
    }

    this.add(x, y, dropper, nowS);
  }

  private add(x: number, y: number, dropper: number, nowS: number): void {
    const sprite = this.scene.add
      .image(x, y, 'oil')
      .setDisplaySize(OIL.SPRITE_PX, OIL.SPRITE_PX)
      .setRotation(Phaser.Math.FloatBetween(0, Math.PI * 2))
      .setDepth(DEPTH.objLow)
      .setAlpha(0);
    this.adopt(sprite);
    this.scene.tweens.add({ targets: sprite, alpha: 0.95, duration: 200 });

    this.slicks.push({
      x,
      y,
      sprite,
      dropper,
      graceUntil: nowS + OIL.DROPPER_GRACE_MS / 1000,
    });
  }

  /**
   * Retire the oldest slicks past `OIL.MAX_LIVE`.
   *
   * Nothing else ever removes one that is not driven over, and four players
   * taking oil across a five-lap race would otherwise carpet the circuit.
   */
  private retireOldest(): void {
    while (this.slicks.length > OIL.MAX_LIVE) {
      const oldest = this.slicks.shift();
      if (oldest) this.fade(oldest.sprite);
    }
  }

  /**
   * First car within `OIL.RADIUS` of a slick takes it, and the slick is gone.
   *
   * `onHit` is where the spin happens; this class only owns the hazard.
   */
  update(
    nowS: number,
    cars: readonly { x: number; y: number; canHit: boolean }[],
    onHit: (carIndex: number, x: number, y: number) => void,
  ): void {
    if (this.slicks.length === 0) return;
    const r2 = OIL.RADIUS * OIL.RADIUS;

    for (let i = this.slicks.length - 1; i >= 0; i--) {
      const slick = this.slicks[i];
      for (let c = 0; c < cars.length; c++) {
        const car = cars[c];
        if (!car.canHit) continue;
        // Dropped behind them, so this should never bite — but a rewind puts a
        // car back down the line onto its own oil, and being spun by your own
        // powerup reads as a bug rather than as a joke.
        if (c === slick.dropper && nowS < slick.graceUntil) continue;
        const dx = car.x - slick.x;
        const dy = car.y - slick.y;
        if (dx * dx + dy * dy > r2) continue;

        this.slicks.splice(i, 1);
        this.fade(slick.sprite);
        onHit(c, slick.x, slick.y);
        break;
      }
    }
  }

  clear(): void {
    for (const slick of this.slicks) {
      this.scene.tweens.killTweensOf(slick.sprite);
      slick.sprite.destroy();
    }
    this.slicks = [];
  }

  /** Smeared away rather than blinked out — a car drove through it. */
  private fade(sprite: Phaser.GameObjects.Image): void {
    this.scene.tweens.killTweensOf(sprite);
    this.scene.tweens.add({
      targets: sprite,
      alpha: 0,
      scale: sprite.scale * 1.35,
      duration: 260,
      onComplete: () => sprite.destroy(),
    });
  }
}
