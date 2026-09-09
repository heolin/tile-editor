import { CRATE_COLOURS, cellIndex, type Cell, type CrateColour, type LevelSpec } from './level/types';

/**
 * The rules, and nothing else. Pure: no Phaser, no scene, no time — so
 * `tests/board.test.ts` can play a level through move by move.
 *
 * The scene owns what a move LOOKS like; this owns what it means.
 */

export type Direction = 'up' | 'down' | 'left' | 'right';

export const DELTA: Record<Direction, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export interface Crate {
  id: number;
  x: number;
  y: number;
  colour: CrateColour;
  /**
   * In a pit. A sunk crate is part of the floor: it can be walked over, another
   * crate can be pushed onto it, and it can never be moved or got back.
   */
  sunk: boolean;
}

/**
 * One player on the board.
 *
 * `leaving` is the cell a player is still walking OUT of. The logical position
 * moves the instant a step is taken, but the picture takes 130 ms to follow, so
 * without this the other player could walk into a cell that still has somebody
 * standing in it — and the two would overlap for a fifth of a second. The scene
 * clears it when the step's tween ends. It is here rather than in the view
 * because it is a rule about where a player may go, and there is one place for
 * those.
 */
export interface Player {
  seat: number;
  x: number;
  y: number;
  leaving?: Cell;
  /**
   * This player's own steps. The budget is spent from `BoardState.moves`, which
   * is the pair's shared total — this is only so the results screen can say who
   * did what, which on a co-op board is most of what there is to say.
   */
  moves: number;
}

export interface BoardState {
  level: LevelSpec;
  /** In seat order. One on a story board, two on a co-op board. */
  players: Player[];
  crates: Crate[];
  /** Cell indices of the coins still lying there. */
  coins: number[];
  moves: number;
  pushes: number;
}

export interface StepResult {
  seat: number;
  direction: Direction;
  to: Cell;
  /** The crate that was pushed, and where it went. */
  pushed?: { id: number; to: Cell };
  /** Set when that push ended in a pit: the crate is gone and the pit is filled. */
  sank: boolean;
  /** The cell a coin was taken from. */
  coin?: Cell;
  solved: boolean;
  /** The board can no longer be finished. Only a reset gets out of it. */
  stuck: boolean;
}

export function startBoard(level: LevelSpec): BoardState {
  return {
    level,
    players: level.starts.map((cell, seat) => ({ seat, x: cell.x, y: cell.y, moves: 0 })),
    crates: level.crates.map((crate, id) => ({ id, x: crate.x, y: crate.y, colour: crate.colour, sunk: false })),
    coins: level.coins.map((coin) => cellIndex(level, coin.x, coin.y)),
    moves: 0,
    pushes: 0,
  };
}

function inside(level: LevelSpec, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < level.width && y < level.height;
}

export function crateAt(state: BoardState, x: number, y: number): Crate | undefined {
  return state.crates.find((crate) => crate.x === x && crate.y === y && !crate.sunk);
}

/**
 * Whoever is standing on this cell, counting a player who has stepped off it
 * but has not finished walking away.
 */
export function playerAt(state: BoardState, x: number, y: number): Player | undefined {
  return state.players.find(
    (player) =>
      (player.x === x && player.y === y) ||
      (player.leaving?.x === x && player.leaving.y === y),
  );
}

/** The step's picture has finished; the cell behind the player is free again. */
export function settle(state: BoardState, seat: number): void {
  const player = state.players[seat];
  if (player === undefined) throw new Error(`sokoban: no player in seat ${seat}`);
  player.leaving = undefined;
}

function filled(state: BoardState, x: number, y: number): boolean {
  return state.crates.some((crate) => crate.sunk && crate.x === x && crate.y === y);
}

/**
 * Ground a piece may occupy: on the board, floored, unwalled, and either not a
 * pit or a pit somebody has already filled. Says nothing about what is standing
 * there — the two callers check that themselves, because a crate and the player
 * block each other differently.
 */
export function standable(state: BoardState, x: number, y: number): boolean {
  const { level } = state;
  if (!inside(level, x, y)) return false;
  const index = cellIndex(level, x, y);
  if (level.floor[index] === undefined) return false;
  if (level.walls[index] !== undefined) return false;
  const feature = level.features[index];
  if (feature?.pit === true && !filled(state, x, y)) return false;
  return true;
}

/** Is this goal cell holding the crate it wants? */
function satisfied(state: BoardState, index: number): boolean {
  const feature = state.level.features[index];
  if (feature?.colour === undefined) return false;
  const x = index % state.level.width;
  const y = Math.floor(index / state.level.width);
  return state.crates.some(
    (crate) => crate.x === x && crate.y === y && crate.colour === feature.colour && crate.sunk === feature.pit,
  );
}

/** Goal cells still waiting for their crate. */
export function goalsLeft(state: BoardState): number {
  let left = 0;
  for (let index = 0; index < state.level.features.length; index++) {
    const feature = state.level.features[index];
    if (feature?.colour !== undefined && !satisfied(state, index)) left++;
  }
  return left;
}

export function solved(state: BoardState): boolean {
  return goalsLeft(state) === 0;
}

/**
 * Has the board become impossible?
 *
 * Counting, not solving: for each colour, the goals still open against the
 * crates of that colour still on the floor. A crate that fell into a plain pit,
 * or into a pit of the wrong colour, is off that count for good.
 *
 * It does NOT catch a crate shoved into a corner. That is the classic Sokoban
 * deadlock and finding it means searching the puzzle; the player is the one who
 * sees it, and the reset button is what it is for. What this catches is the one
 * case the player cannot undo their way out of, because sinking a crate clears
 * the history.
 */
export function stuck(state: BoardState): boolean {
  for (const colour of CRATE_COLOURS) {
    let wanted = 0;
    for (let index = 0; index < state.level.features.length; index++) {
      const feature = state.level.features[index];
      if (feature?.colour === colour && !satisfied(state, index)) wanted++;
    }
    if (wanted === 0) continue;
    const available = state.crates.filter((crate) => crate.colour === colour && !crate.sunk).length;
    if (available < wanted) return true;
  }
  return false;
}

/**
 * Take one step, for one seat. Returns `null` when the way is blocked and
 * nothing changed — the player has still turned to face that way, but turning
 * is the scene's to draw and costs no move.
 *
 * Two players are resolved one call at a time, in seat order, so when both ask
 * for the same cell in the same frame the first seat gets it and the second is
 * simply blocked. There is no tie to break.
 *
 * Mutates. Take a `snapshot` first if the move has to be undoable.
 */
export function step(state: BoardState, seat: number, direction: Direction): StepResult | null {
  const player = state.players[seat];
  if (player === undefined) throw new Error(`sokoban: no player in seat ${seat}`);
  const delta = DELTA[direction];
  const to = { x: player.x + delta.x, y: player.y + delta.y };
  if (!standable(state, to.x, to.y)) return null;
  // The other player is as solid as a wall, and stays solid until they have
  // finished walking out of the cell.
  if (playerAt(state, to.x, to.y) !== undefined) return null;

  let pushed: StepResult['pushed'];
  let sank = false;
  const crate = crateAt(state, to.x, to.y);
  if (crate !== undefined) {
    const beyond = { x: to.x + delta.x, y: to.y + delta.y };
    // A pit takes a crate even though nobody may stand in it, so the pit test
    // comes first and `standable` is only asked about ground.
    const pit =
      inside(state.level, beyond.x, beyond.y) &&
      state.level.features[cellIndex(state.level, beyond.x, beyond.y)]?.pit === true &&
      !filled(state, beyond.x, beyond.y) &&
      state.level.walls[cellIndex(state.level, beyond.x, beyond.y)] === undefined &&
      state.level.floor[cellIndex(state.level, beyond.x, beyond.y)] !== undefined;
    if (!pit && !standable(state, beyond.x, beyond.y)) return null;
    if (crateAt(state, beyond.x, beyond.y) !== undefined) return null;
    // A crate is not a way to shove the other player around, nor to trap them
    // under one: the cell it lands on has to be empty of people too.
    if (playerAt(state, beyond.x, beyond.y) !== undefined) return null;
    crate.x = beyond.x;
    crate.y = beyond.y;
    crate.sunk = pit;
    sank = pit;
    pushed = { id: crate.id, to: { ...beyond } };
    state.pushes++;
  }

  player.leaving = { x: player.x, y: player.y };
  player.x = to.x;
  player.y = to.y;
  player.moves++;
  state.moves++;

  const coinIndex = cellIndex(state.level, to.x, to.y);
  const coinSlot = state.coins.indexOf(coinIndex);
  let coin: Cell | undefined;
  if (coinSlot >= 0) {
    state.coins.splice(coinSlot, 1);
    coin = { ...to };
  }

  return { seat, direction, to: { ...to }, pushed, sank, coin, solved: solved(state), stuck: stuck(state) };
}

/** Everything a move changes, so it can be put back. */
export interface Snapshot {
  players: { x: number; y: number; moves: number }[];
  crates: { x: number; y: number; sunk: boolean }[];
  coins: number[];
  moves: number;
  pushes: number;
}

export function snapshot(state: BoardState): Snapshot {
  return {
    players: state.players.map((player) => ({ x: player.x, y: player.y, moves: player.moves })),
    crates: state.crates.map((crate) => ({ x: crate.x, y: crate.y, sunk: crate.sunk })),
    coins: [...state.coins],
    moves: state.moves,
    pushes: state.pushes,
  };
}

export function restore(state: BoardState, snap: Snapshot): void {
  for (const player of state.players) {
    const was = snap.players[player.seat];
    if (was === undefined) throw new Error('sokoban: snapshot is from another board');
    player.x = was.x;
    player.y = was.y;
    player.moves = was.moves;
    // Whatever was mid-step is not mid-step any more.
    player.leaving = undefined;
  }
  for (let i = 0; i < state.crates.length; i++) {
    const was = snap.crates[i];
    if (was === undefined) throw new Error('sokoban: snapshot is from another board');
    Object.assign(state.crates[i]!, was);
  }
  state.coins = [...snap.coins];
  state.moves = snap.moves;
  state.pushes = snap.pushes;
}
