/**
 * What a level is, once the Tiled JSON has been parsed. Nothing downstream of
 * the loader ever sees a gid, a tileset or a layer.
 */

/** The five crate colours, in the order the HUD lists them. */
export type CrateColour = 'brown' | 'red' | 'blue' | 'green' | 'grey';

export const CRATE_COLOURS: readonly CrateColour[] = [
  'brown',
  'red',
  'blue',
  'green',
  'grey',
] as const;

/**
 * Story is one player and a ladder of boards. Co-op is a separate ladder of
 * boards drawn for TWO, on one screen with two controllers — not online, and
 * not the same boards with a second character dropped in.
 */
export type LevelMode = 'story' | 'coop';

export type TileKind =
  /** The floor. A cell without one is outside the board and cannot be entered. */
  | 'ground'
  /** Solid. Neither the player nor a crate passes. */
  | 'wall'
  /** A mark on the floor: a crate of its colour belongs here. */
  | 'goal'
  /**
   * A pit. Anything pushed in is gone and the cell becomes walkable. A pit with
   * a colour is ALSO a goal — the crate of that colour is what it wants, and
   * any other crate fills it wrongly and cannot be got back.
   */
  | 'hole'
  | 'crate'
  /**
   * Where a player starts. One per seat: a story board has the first, a co-op
   * board has both, and the tileset carries a tile per seat so the editor shows
   * which character stands where.
   */
  | 'start'
  /** Ten gold, paid when the level is finished rather than when it is taken. */
  | 'coin';

/** One entry of the tileset: what a piece of art IS, wherever it is placed. */
export interface TileDef {
  /** Art basename, e.g. `crate_red`. */
  name: string;
  /** Texture key, `sk-` + name. */
  key: string;
  kind: TileKind;
  /** Crates, goals and coloured pits. A pit without one takes any crate. */
  colour?: CrateColour;
  /** Start tiles: which seat stands here, 0-based. */
  seat?: number;
}

/**
 * A cell's ground-plane feature: a goal marker, a pit, or a pit that is a goal.
 *
 * `colour` is what makes it a goal. `pit` is what makes it swallow a crate. The
 * two are independent, and all three combinations exist:
 *
 * - a marker (`colour`, not a pit) — a crate of that colour must stand on it
 * - a plain pit (no colour) — terrain: a crate pushed in is lost, and the
 *   filled cell can then be walked over, which is the point of pushing one in
 * - a coloured pit — both: fill it with that colour and it is satisfied, fill
 *   it with anything else and the level can no longer be finished
 */
export interface Feature {
  /** The art on the ground here. */
  key: string;
  pit: boolean;
  colour?: CrateColour;
}

export interface CratePlacement {
  x: number;
  y: number;
  colour: CrateColour;
}

export interface Cell {
  x: number;
  y: number;
}

export interface LevelSpec {
  /** File stem — `07_story`. Also the thumbnail's key. */
  id: string;
  title: string;
  mode: LevelMode;
  /**
   * Where the puzzle came from, when it is not ours. Shown on the picker: the
   * imported sets are used on the condition that they stay credited.
   */
  source?: string;
  /** The move count a good solution takes. `BUDGET` scales it per difficulty. */
  parMoves: number;
  width: number;
  height: number;
  /** Per cell, row-major. `undefined` is off the board. */
  floor: (string | undefined)[];
  walls: (string | undefined)[];
  features: (Feature | undefined)[];
  crates: CratePlacement[];
  coins: Cell[];
  /** One per seat, in seat order. Story boards have one, co-op boards two. */
  starts: Cell[];
}

export function cellIndex(level: { width: number }, x: number, y: number): number {
  return y * level.width + x;
}
