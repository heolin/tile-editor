import { BOARD } from './constants';
import type { Direction } from './board';

/**
 * Two axes into single steps on a grid. Pure, so `tests/input.test.ts` can hold
 * a stick over and check that one press is one step.
 *
 * The same object serves every controller the hub has, because they all arrive
 * as the same two axes: a capsule's tilt, a phone's tilt, the on-screen pad and
 * the keyboard. What differs is only how steadily the numbers come, and that is
 * what the two thresholds are for.
 */
export class StepInput {
  /** The direction currently being held, or null when the stick is centred. */
  private held: Direction | null = null;
  /** When the held direction may fire again. */
  private nextAt = 0;

  /**
   * The direction to step this frame, or null.
   *
   * A fresh direction fires at once and then waits `holdMs`; after that it
   * repeats every `repeatMs`. The first wait is the longer one so a single
   * press is a single step — without it a deliberate tap walks two cells.
   */
  poll(axes: { x: number; y: number }, now: number): Direction | null {
    const direction = this.direction(axes);
    if (direction !== this.held) {
      this.held = direction;
      if (direction === null) return null;
      this.nextAt = now + BOARD.holdMs;
      return direction;
    }
    if (direction === null || now < this.nextAt) return null;
    this.nextAt = now + BOARD.repeatMs;
    return direction;
  }

  /** Forget the hold, so the next reading starts a fresh press. */
  reset(): void {
    this.held = null;
  }

  /**
   * One of four directions, or none.
   *
   * The larger axis wins outright: a board is four-way and a diagonal lean has
   * to become one of them rather than nothing. Releasing uses a lower threshold
   * than pressing (`axisOff` against `axisOn`), so a tilt held near the line
   * does not stutter between stepping and stopping.
   */
  private direction(axes: { x: number; y: number }): Direction | null {
    const limit = this.held === null ? BOARD.axisOn : BOARD.axisOff;
    const horizontal = Math.abs(axes.x) >= Math.abs(axes.y);
    const value = horizontal ? axes.x : axes.y;
    if (Math.abs(value) < limit) return null;
    if (horizontal) return value > 0 ? 'right' : 'left';
    return value > 0 ? 'down' : 'up';
  }
}
