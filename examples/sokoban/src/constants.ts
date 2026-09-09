import type { Difficulty } from '@kapsel/shared';

/**
 * Every number the board's look and feel depends on, in one place.
 */

/**
 * The projection.
 *
 * The art is 128 px square; a cell is 128 wide and only 96 tall, and that 32 px
 * is the whole look of the board. It is drawn as a ground plane seen at an
 * angle with things standing on it:
 *
 * - **ground** (floor, goal markers, pits) is squashed into the 128x96 cell. It
 *   tiles, so it must not be cut, and a squashed marker reads as one lying on a
 *   foreshortened floor.
 * - **standing** (walls, crates, the player, coins) keeps its full 128 px and
 *   is anchored to the BOTTOM of its cell, so it rises `CELL.rise` into the row
 *   behind it. Drawn in row order, a vertical run of walls shows one front face
 *   — the bottom one — and a player standing behind a wall is half hidden by it.
 *
 * The level files know nothing about this: a `.tmj` is a square 128 px grid,
 * which is what a Sokoban board is. The projection lives here and in the
 * thumbnail baker, and nowhere else.
 */
export const CELL = {
  art: 128,
  width: 128,
  height: 96,
  /** How far a standing piece reaches above its own cell. */
  rise: 128 - 96,
} as const;

/** The largest board the editor's template offers, and the loader accepts. */
export const GRID = { width: 14, height: 18 } as const;

/**
 * The white picture frame around the board. Purely a picture: the board's own
 * walls are what stop anything, and a cell off the board is unenterable because
 * it is off the board.
 *
 * The same numbers Tilt Ball's frame uses, because it is the same frame — the
 * two boards sit side by side in one product and a second white edge with its
 * own radius would read as a different game.
 */
export const FRAME = {
  /** Drawn entirely OUTSIDE the board, so it covers no floor. */
  thickness: 24,
  cornerRadius: 28,
  color: 0xf4f6fb,
  /** Source size of the generated nine-slice texture. */
  textureSize: 128,
} as const;

export const BOARD = {
  /**
   * How much of the canvas width the board takes. The rest is the margin the
   * board's shadow and the screen's edge need.
   */
  widthFraction: 0.9,
  /** One step, in ms. Long enough to read as a step, short enough to hold a direction. */
  stepMs: 130,
  /**
   * A held direction repeats after this, then every `repeatMs`. The first wait
   * is longer so a single press is a single step and nobody walks two cells by
   * pressing once.
   */
  holdMs: 260,
  repeatMs: 130,
  /**
   * How far a stick or a tilt must go before it is a direction at all, and how
   * far it must come back before another step is allowed from a fresh press.
   */
  axisOn: 0.55,
  axisOff: 0.3,
} as const;

/**
 * The move budget that still pays full gold, as a multiple of the level's own
 * `parMoves`. Difficulty here is not a different board or a different physics —
 * it is how much slack the same puzzle gives you.
 */
export const BUDGET: Record<Difficulty, number> = { easy: 1.6, medium: 1.3, hard: 1.0 };

/** What a coin picked up on a finished board is worth. */
export const COIN_GOLD = 10;

/**
 * How the finish pays. `score` is the move budget left over, so a tight
 * solution pays more, and running out pays the participation coin only.
 */
export const GOLD_RULES = { scorePerCoin: 4, maxPerformance: 20 } as const;

/**
 * HUD: one glyph per goal, this many to a row, at this size.
 *
 * Both live here rather than in the HUD scene because the play scene needs them
 * too: how many rows of glyphs there are is how much of the screen the HUD
 * takes, and the board gets what is left.
 */
export const GOAL_ROW = 5;
export const GOAL_ICON = 52;

/**
 * The band above the board, in reference px.
 *
 * Both scenes read this: the HUD lays itself out inside it and the play scene
 * reserves it before fitting the board. They must agree, and the way to make
 * them agree is one function rather than two sets of numbers.
 *
 * The title's room is RESERVED for two lines whether it needs them or not. A
 * band that grew with the text would move the board every time a level with a
 * longer name came up, and a title that overran a one-line band walked over the
 * goal glyphs — which is what it did. `HudScene` shrinks a title that would
 * take three.
 *
 * The two numbers that are not derived match `SPACE.md` and `SPACE.xs`. They
 * are written out because this module is imported by the level loader, which
 * the node tests import, and the shared barrel brings Phaser with it.
 */
export const HUD = {
  margin: 24,
  /** Two lines at `TYPE.subheading`, plus the gap under them. */
  titleBlock: 112,
  gap: 16,
  rowGap: 8,
} as const;

/** How tall the HUD needs to be for a board with this many goals. */
export function hudBandHeight(goals: number): number {
  const rows = Math.max(1, Math.ceil(goals / GOAL_ROW));
  return (
    HUD.margin + HUD.titleBlock + HUD.gap + rows * GOAL_ICON + (rows - 1) * HUD.rowGap + HUD.gap
  );
}
