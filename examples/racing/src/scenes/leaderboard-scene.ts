import Phaser from 'phaser';
import {
  announceOrbs,
  awardGold,
  claimDailyOrb,
  claimOrbMilestone,
  generateUiTextures,
  LeaderboardPanel,
  loadImages,
  vfx,
} from '@kapsel/shared';
import { DEPTH, GOLD_RULES } from '../constants';
// Side-effect import: registers this game's `rc-*` effect pack.
import '../fx';
import { t } from '../i18n/strings';
import type { RaceSeries } from '../race-series';

/**
 * Cumulative standings after each race. Continue starts the next race (keeping
 * standings, no recalibration); on the last race the button reads Finish and
 * returns to the menu. Back to menu always abandons the series.
 *
 * Unlike Pin the Tail, which lays the same panel over its live board, this one
 * gets a scene and a dark clear of its own — there is nothing behind a finished
 * race worth looking at.
 */
export class LeaderboardScene extends Phaser.Scene {
  constructor(
    private series: RaceSeries,
    private onExit: () => void,
  ) {
    super('Results');
  }

  preload(): void {
    loadImages(this);
  }

  create(): void {
    generateUiTextures(this);
    this.cameras.main.setBackgroundColor('#0d1622');

    const standings = this.series.rankedStandings();
    const last = this.series.isLastRace();

    // Paid after every race, for that race alone — the standings shown above
    // are cumulative, so paying against them would pay for race one's points
    // again after race two. The placing bonus therefore goes to whoever won
    // THIS race, not to whoever leads the series.
    const { total: gold } = awardGold(
      this.series.lastRacePoints.map((points, playerIndex) => ({ playerIndex, score: points })),
      GOLD_RULES,
    );
    // The day's orb is for finishing a race, not for winning one — this screen
    // only exists because a race ended. Same rule as Tilt Ball's board: the
    // achievement is getting to the end, and a solo driver "wins" every time.
    // …and an orb the FIRST time each map is finished, ever. Keyed by the track
    // id — `currentTrack()` is the one that was just raced, and it has already
    // resolved a random pick to a concrete track by now.
    const daily = claimDailyOrb('racing');
    const milestones = claimOrbMilestone('racing', this.series.currentTrack());
    const orbs = daily + milestones;
    // The band on the board says how many; this says what for.
    announceOrbs(this, { daily, milestones });

    new LeaderboardPanel(this, {
      title: last
        ? t('results.final')
        : t('results.standings', { race: this.series.raceIndex + 1 }),
      gold,
      orbs,
      rows: standings.map((row) => ({
        playerIndex: row.playerIndex,
        value: t('results.points', { points: row.points }),
        detail: this.formatTime(row.totalTimeMs),
      })),
      highlightLeader: standings[0]!.points > 0,
      primary: {
        label: t(last ? 'results.finish' : 'results.continue'),
        onClick: () => {
          if (last) {
            this.scene.start('Menu');
            return;
          }
          this.series.advance();
          this.scene.start('Race');
        },
      },
      secondary: { label: t('results.menu'), onClick: () => this.scene.start('Menu') },
    });

    if (last) this.celebrate();

    void this.onExit;
  }

  /**
   * Fireworks over the FINAL standings only, not after every race in a series.
   * A celebration that fires on the way past each round is not a celebration.
   *
   * Placed high and to the sides, and delayed so the panel is on screen first:
   * this congratulates the standings, it must not cover them. Two bursts rather
   * than one, because a single pop reads as a mistake.
   */
  private celebrate(): void {
    const { width, height } = this.scale;
    const y = height * 0.16;
    this.time.delayedCall(380, () =>
      vfx(this, 'rc-firework', { x: width * 0.27, y, depth: DEPTH.hud }),
    );
    this.time.delayedCall(760, () =>
      vfx(this, 'rc-firework', { x: width * 0.73, y: y * 1.35, depth: DEPTH.hud }),
    );
  }

  private formatTime(ms: number): string {
    if (ms <= 0) return '—';
    const s = ms / 1000;
    const m = Math.floor(s / 60);
    const rem = (s % 60).toFixed(1);
    return `${m}:${rem.padStart(4, '0')}`;
  }
}
