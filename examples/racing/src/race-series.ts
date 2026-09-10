import type { GameController } from '@playground/game-core';
import type { Difficulty } from '@kapsel/shared';

export const TRACK_COUNT = 5;

export type RaceMode = 'single' | '3' | '5';

/** How many tracks a mode requires the player to select. */
export const MODE_RACES: Record<RaceMode, number> = { single: 1, '3': 3, '5': 5 };

/** A chosen slot in the series: a concrete track, or a deferred random pick. */
export type TrackSlot = { kind: 'track'; id: number } | { kind: 'random' };

/** One player's result in a single race, reported by RaceScene. */
export interface RaceResult {
  playerIndex: number;
  finished: boolean; // completed all laps before the clock ran out
  timeMs: number; // finish time, or the full duration if DNF
  place: number; // 1..N finishing order (DNFs sorted after finishers)
}

export interface PlayerStanding {
  playerIndex: number;
  points: number;
  totalTimeMs: number;
  finishes: number;
  wins: number;
}

/**
 * Carries state across the Menu → Ready → Race → Leaderboard scene loop.
 * Constructed once in game-module.mount and injected into every scene ctor
 * (the ctor runs once even though scene.start re-runs create()), so it's the
 * stable cross-scene store — no registry/scene-data plumbing needed.
 */
export class RaceSeries {
  orderedTracks: TrackSlot[] = [{ kind: 'track', id: 0 }];
  laps = 3;
  mode: RaceMode = 'single';
  /** Drives the steering assist strength (easy pulls hardest, hard not at all). */
  difficulty: Difficulty = 'easy';
  raceIndex = 0;
  standings: PlayerStanding[] = [];
  /**
   * Points scored in the LAST race alone, by player index — what the gold
   * payout on the results screen is for.
   *
   * Kept here rather than recomputed from `standings`, which are cumulative: a
   * payout against those would pay for race one's points again after race two.
   */
  lastRacePoints: number[] = [];

  /** Concrete track id chosen for each race (random resolves+memoises here). */
  private resolved: (number | undefined)[] = [];

  constructor(readonly players: GameController[]) {
    this.resetStandings();
  }

  configure(cfg: {
    orderedTracks: TrackSlot[];
    laps: number;
    mode: RaceMode;
    difficulty: Difficulty;
  }): void {
    this.orderedTracks = cfg.orderedTracks.slice();
    this.laps = cfg.laps;
    this.mode = cfg.mode;
    this.difficulty = cfg.difficulty;
    this.raceIndex = 0;
    this.resolved = new Array(this.orderedTracks.length).fill(undefined);
  }

  resetStandings(): void {
    this.lastRacePoints = this.players.map(() => 0);
    this.standings = this.players.map((_, i) => ({
      playerIndex: i,
      points: 0,
      totalTimeMs: 0,
      finishes: 0,
      wins: 0,
    }));
  }

  get totalRaces(): number {
    return this.orderedTracks.length;
  }

  isLastRace(): boolean {
    return this.raceIndex >= this.totalRaces - 1;
  }

  /** Resolve (and memoise) the concrete track id for the current race. */
  currentTrack(): number {
    if (this.resolved[this.raceIndex] !== undefined) {
      return this.resolved[this.raceIndex] as number;
    }
    const slot = this.orderedTracks[this.raceIndex];
    let id: number;
    if (slot.kind === 'track') {
      id = slot.id;
    } else {
      // Random: prefer a track not already used this series.
      const used = new Set(this.resolved.filter((v): v is number => v !== undefined));
      const free = Array.from({ length: TRACK_COUNT }, (_, i) => i).filter((i) => !used.has(i));
      const pool = free.length > 0 ? free : Array.from({ length: TRACK_COUNT }, (_, i) => i);
      id = pool[Math.floor(Math.random() * pool.length)];
    }
    this.resolved[this.raceIndex] = id;
    return id;
  }

  /** Fold one race's results into the cumulative standings. */
  recordRace(results: RaceResult[]): void {
    const n = results.length;
    this.lastRacePoints = this.players.map(() => 0);
    for (const r of results) {
      const s = this.standings[r.playerIndex];
      if (!s) continue;
      // Placement points: 1st = n, last = 1; DNF scores 0.
      const points = r.finished ? n - r.place + 1 : 0;
      this.lastRacePoints[r.playerIndex] = points;
      s.points += points;
      s.totalTimeMs += r.timeMs;
      if (r.finished) s.finishes += 1;
      if (r.place === 1 && r.finished) s.wins += 1;
    }
  }

  advance(): void {
    this.raceIndex += 1;
  }

  /** Standings sorted best-first: more points, then lower total time. */
  rankedStandings(): PlayerStanding[] {
    return this.standings
      .slice()
      .sort((a, b) => b.points - a.points || a.totalTimeMs - b.totalTimeMs);
  }
}
