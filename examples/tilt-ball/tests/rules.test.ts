import { describe, expect, it } from 'vitest';
import {
  anyoneStillPlaying,
  formatTime,
  levelCleared,
  rankResults,
  versusPoints,
  type SeatStatus,
} from '../src/rules';

describe('ranking', () => {
  const result = (seat: number, timeMs: number | null, deaths = 0) => ({ seat, timeMs, deaths });

  it('puts finishers first, fastest first', () => {
    const ranked = rankResults([result(0, 41_200), result(1, 30_100), result(2, null)]);
    expect(ranked.map((row) => row.seat)).toEqual([1, 0, 2]);
  });

  it('separates the non-finishers by how often they died', () => {
    const ranked = rankResults([result(0, null, 4), result(1, null, 1), result(2, null, 1)]);
    // Seat order breaks the tie, so the table is stable between renders.
    expect(ranked.map((row) => row.seat)).toEqual([1, 2, 0]);
  });

  it('pays nothing for not finishing, whatever the place', () => {
    expect(versusPoints(0, true)).toBe(5);
    expect(versusPoints(3, true)).toBe(1);
    expect(versusPoints(0, false)).toBe(0);
    // Beyond the fourth place the table runs out; a point is the floor.
    expect(versusPoints(9, true)).toBe(1);
  });

  it('clears a level when ANY player gets home', () => {
    expect(levelCleared([result(0, null), result(1, 12_000)])).toBe(true);
    expect(levelCleared([result(0, null), result(1, null)])).toBe(false);
  });
});

describe('who is still playing', () => {
  const seat = (n: number, state: SeatStatus['state']): SeatStatus => ({ seat: n, state });

  it('has nobody to wait for when the only player finishes', () => {
    // The bug this pins: a solo run showed a 15-second countdown over an empty
    // board after the player had already won.
    expect(anyoneStillPlaying([seat(0, 'home')], 'story', 0)).toBe(false);
    expect(anyoneStillPlaying([seat(0, 'home')], 'versus', 0)).toBe(false);
  });

  it('waits for a versus player who is between lives, but not a story one', () => {
    const seats = [seat(0, 'home'), seat(1, 'out')];
    expect(anyoneStillPlaying(seats, 'versus', 0)).toBe(true);
    expect(anyoneStillPlaying(seats, 'story', 0)).toBe(false);
  });

  it('counts a ball still falling — its outcome is not decided yet', () => {
    expect(anyoneStillPlaying([seat(0, 'home'), seat(1, 'falling')], 'story', 0)).toBe(true);
  });

  it('ignores the seat it is asked to exclude, and nothing else', () => {
    const seats = [seat(0, 'rolling'), seat(1, 'rolling')];
    expect(anyoneStillPlaying(seats, 'story', 0)).toBe(true);
    expect(anyoneStillPlaying(seats, 'story')).toBe(true);
  });
});

describe('formatTime', () => {
  it('reads as m:ss.t', () => {
    expect(formatTime(0)).toBe('0:00.0');
    expect(formatTime(9_450)).toBe('0:09.4');
    expect(formatTime(72_900)).toBe('1:12.9');
  });
});
