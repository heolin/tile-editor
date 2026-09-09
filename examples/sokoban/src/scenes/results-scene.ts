import Phaser from 'phaser';
import {
  LeaderboardPanel,
  addGold,
  awardGold,
  generateUiTextures,
  loadImages,
} from '@kapsel/shared';
import { COIN_GOLD, GOLD_RULES } from '../constants';
import { levelsFor } from '../level/levels';
import { t } from '../i18n/strings';
import { bestMoves, recordMoves, unlockThrough } from '../progress';
import { Session, type SessionRef } from '../session';

/** What the play scene hands over when the last goal is filled. */
export interface ResultsData {
  /** The pair's shared total, which is what the budget was spent from. */
  moves: number;
  /** Each seat's own steps, in seat order. */
  perPlayer: number[];
  coins: number;
}

/**
 * The board is solved. What it was worth, and where to go next.
 *
 * Payment is in two parts, and they are separate on purpose: the moves left in
 * the budget go through `awardGold` like every other game's score, while the
 * coins picked up on the board are a flat `addGold` — they are the board's own
 * reward for a detour, not a measure of how well it was solved. A coin taken on
 * a board that was then reset was never taken: this only ever runs on a finish.
 */
export class ResultsScene extends Phaser.Scene {
  private outcome!: ResultsData;

  constructor(private ref: SessionRef) {
    super('Results');
  }

  init(data: ResultsData): void {
    this.outcome = data;
  }

  preload(): void {
    loadImages(this);
  }

  create(): void {
    generateUiTextures(this);
    this.cameras.main.setBackgroundColor('#0d1622');

    const session = this.ref.get();
    const level = session.level;
    const previousBest = bestMoves(level.id, session.difficulty);
    const record = recordMoves(level.id, session.difficulty, this.outcome.moves);
    const unlocked = unlockThrough(session.mode, session.levelIndex);

    // Under the budget pays; over it pays the participation coin only. The
    // budget is the level's par scaled by the difficulty, so the same board is
    // worth more when it was solved with less room to spare.
    const spare = Math.max(0, session.budget - this.outcome.moves);
    const { total: gold } = awardGold([{ playerIndex: 0, score: spare }], GOLD_RULES);
    const coinGold = this.outcome.coins * COIN_GOLD;
    if (coinGold > 0) addGold(coinGold);

    const last = session.levelIndex >= levelsFor(session.mode).length - 1;
    // ONE short line under the row, not every notice joined together. The panel
    // draws this at body size and the value above it at heading size, both
    // sized for "1240" and a lap time — a sentence there fills the panel. The
    // coins are left out on purpose: they are already in the gold band.
    const detail =
      record && previousBest !== null
        ? t('results.best')
        : unlocked
          ? t('results.unlocked')
          : this.outcome.moves > session.budget
            ? t('results.over-budget', { budget: session.budget })
            : undefined;

    new LeaderboardPanel(this, {
      title: t('results.title'),
      // A row per seat, showing that player's own steps — on a co-op board the
      // interesting thing is who walked how far, and a single row would leave
      // the second player off a screen they just played. The VALUE is the bare
      // number, the way every other game passes a score: the panel draws it at
      // heading size, where "6 moves" fills the panel and "6" does not.
      rows: this.outcome.perPlayer.map((moves, seat) => ({
        playerIndex: seat,
        value: String(moves),
        detail: seat === 0 ? detail : undefined,
      })),
      // Nobody wins a co-op board, and on a story board there is one row.
      highlightLeader: false,
      gold: gold + coinGold,
      primary: last
        ? { label: t('results.retry'), onClick: () => this.replay(session.levelIndex) }
        : { label: t('results.next'), onClick: () => this.replay(session.levelIndex + 1) },
      secondary: { label: t('results.levels'), onClick: () => this.toPicker() },
    });
  }

  /** Play a level: the next one, or this one again. */
  private replay(index: number): void {
    const session = this.ref.get();
    this.ref.set(new Session(session.mode, index, session.difficulty));
    this.scene.start('Play');
  }

  private toPicker(): void {
    // Back to the picker rather than out of the game: leaving the hub is the
    // pause menu's job, and from the picker it is one more tap.
    this.scene.start('Setup');
  }
}
