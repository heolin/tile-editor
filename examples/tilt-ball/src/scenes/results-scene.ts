import Phaser from 'phaser';
import {
  LeaderboardPanel,
  announceOrbs,
  awardGold,
  claimDailyOrb,
  claimOrbMilestone,
  generateUiTextures,
  loadImages,
} from '@kapsel/shared';
import { GOLD_RULES } from '../constants';
import { levelsFor } from '../level/levels';
import { recordTime, unlockThrough } from '../progress';
import { t } from '../i18n/strings';
import { formatTime, levelCleared, rankResults, versusPoints } from '../rules';
import { Session, type SessionRef } from '../session';

/**
 * What happened on the board just played, and where to go next.
 *
 * Story shows this level's times and offers the next level; versus shows the
 * running standings and continues the series. Both pay out, because every game
 * in the hub pays on every board.
 */
export class ResultsScene extends Phaser.Scene {
  constructor(private ref: SessionRef) {
    super('Results');
  }

  preload(): void {
    loadImages(this);
  }

  create(): void {
    generateUiTextures(this);
    this.cameras.main.setBackgroundColor('#0d1622');

    const session = this.ref.require();
    const level = session.currentLevel();
    const results = session.results();
    const ranked = rankResults(results);
    const cleared = levelCleared(results);

    // Best time is the fastest ANY player managed, kept per level per
    // difficulty — one board played on hard is not the same board as on easy.
    const fastest = ranked.find((row) => row.timeMs !== null)?.timeMs ?? null;
    if (fastest !== null) recordTime(level.id, session.difficulty, fastest);

    const unlocked = this.unlockNext(session, cleared);

    // The score gold is paid against is the placing itself: the game's only
    // number is a time, and a time is worth nothing without the board it was
    // set on.
    const { total: gold } = awardGold(
      ranked.map((row, place) => ({
        playerIndex: row.seat,
        score: versusPoints(place, row.timeMs !== null),
      })),
      GOLD_RULES,
    );
    // The day's orb is for FINISHING a board, not for winning one: this game's
    // only number is a time, and a solo player would "win" every board they
    // played. Clearing it is the achievement, and it is the same achievement
    // whether one player or four were on it.
    // …and an orb the FIRST time each board is cleared, ever. Keyed by the
    // level id, not by a count, so a board cleared again pays nothing and a
    // board added later still has its own first time waiting.
    const daily = cleared ? claimDailyOrb('tilt-ball') : 0;
    const milestones = cleared ? claimOrbMilestone('tilt-ball', level.id) : 0;
    const orbs = daily + milestones;
    // The band on the board says how many; this says what for — and for a board
    // cleared for the first time, that is the whole point of the orb.
    announceOrbs(this, { daily, milestones });

    new LeaderboardPanel(this, {
      title: this.title(session, cleared),
      gold,
      orbs,
      rows:
        session.mode === 'versus'
          ? session.standings().map((row) => ({
              playerIndex: row.seat,
              value: `${row.points} pts`,
              detail: this.detailFor(results, row.seat),
            }))
          : ranked.map((row) => ({
              playerIndex: row.seat,
              value: row.timeMs === null ? '—' : formatTime(row.timeMs),
              detail: row.deaths === 0 ? 'no deaths' : `${row.deaths} deaths`,
            })),
      highlightLeader: cleared,
      primary: this.primary(session, unlocked),
      secondary: { label: t('results.menu'), onClick: () => this.scene.start('Setup') },
    });
  }

  /** Story only: open the level after this one. Returns its id, if there is one. */
  private unlockNext(session: Session, cleared: boolean): string | null {
    if (session.mode !== 'story' || !cleared) return null;
    const story = levelsFor('story');
    const index = story.findIndex((candidate) => candidate.id === session.currentLevel().id);
    if (index < 0) return null;
    unlockThrough(index);
    return story[index + 1]?.id ?? null;
  }

  private title(session: Session, cleared: boolean): string {
    if (session.mode === 'versus') {
      return session.isLastLevel()
        ? t('results.final')
        : t('results.board', { index: session.levelIndex + 1, total: session.levelCount });
    }
    return t(cleared ? 'results.cleared' : 'results.out-of-time');
  }

  /** Versus: the time this player set on the board just played. */
  private detailFor(results: { seat: number; timeMs: number | null }[], seat: number): string {
    const row = results.find((result) => result.seat === seat);
    return row?.timeMs === undefined || row.timeMs === null
      ? t('results.no-finish')
      : formatTime(row.timeMs);
  }

  private primary(session: Session, unlockedNext: string | null): { label: string; onClick: () => void } {
    if (session.mode === 'versus') {
      if (session.isLastLevel()) {
        return { label: t('results.finish'), onClick: () => this.scene.start('Setup') };
      }
      return {
        label: t('results.continue'),
        onClick: () => {
          session.advance();
          this.scene.start('Play');
        },
      };
    }

    if (unlockedNext !== null) {
      return {
        label: t('results.next-level'),
        onClick: () => {
          this.ref.set(
            new Session(session.mode, session.difficulty, session.seats, [unlockedNext]),
          );
          this.scene.start('Play');
        },
      };
    }
    return { label: t('results.again'), onClick: () => this.scene.start('Play') };
  }
}
