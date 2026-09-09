import { describe, expect, it } from 'vitest';
import { BOARD } from '../src/constants';
import { StepInput } from '../src/input';

const CENTRE = { x: 0, y: 0 };
const RIGHT = { x: 1, y: 0 };
const DOWN = { x: 0, y: 1 };

describe('turning two axes into steps', () => {
  it('takes one step for one press', () => {
    const input = new StepInput();
    expect(input.poll(RIGHT, 0)).toBe('right');
    expect(input.poll(RIGHT, 10)).toBeNull();
    expect(input.poll(RIGHT, BOARD.holdMs - 1)).toBeNull();
  });

  it('repeats while the direction is held', () => {
    const input = new StepInput();
    input.poll(RIGHT, 0);
    expect(input.poll(RIGHT, BOARD.holdMs)).toBe('right');
    expect(input.poll(RIGHT, BOARD.holdMs + BOARD.repeatMs)).toBe('right');
  });

  it('starts a fresh press after the stick comes back', () => {
    const input = new StepInput();
    input.poll(RIGHT, 0);
    expect(input.poll(CENTRE, 20)).toBeNull();
    expect(input.poll(RIGHT, 30)).toBe('right');
  });

  it('ignores a lean too small to mean anything', () => {
    const input = new StepInput();
    expect(input.poll({ x: BOARD.axisOn - 0.01, y: 0 }, 0)).toBeNull();
  });

  it('holds the direction through a smaller lean, but not a centred one', () => {
    // Pressing takes `axisOn`, releasing takes `axisOff`. Without the gap a
    // tilt held near the line stutters between stepping and stopping.
    const input = new StepInput();
    input.poll(DOWN, 0);
    const easing = { x: 0, y: (BOARD.axisOn + BOARD.axisOff) / 2 };
    expect(input.poll(easing, BOARD.holdMs)).toBe('down');
    expect(input.poll({ x: 0, y: BOARD.axisOff - 0.01 }, BOARD.holdMs * 2)).toBeNull();
  });

  it('picks one of four directions from a diagonal', () => {
    const input = new StepInput();
    expect(input.poll({ x: 0.9, y: 0.8 }, 0)).toBe('right');
    input.reset();
    expect(input.poll({ x: 0.7, y: -0.8 }, 100)).toBe('up');
  });
});
