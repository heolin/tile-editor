import Phaser from 'phaser';
import type { Difficulty } from '@kapsel/shared';
import type { BoardState } from './board';
import { BUDGET } from './constants';
import { levelAt } from './level/levels';
import type { LevelMode, LevelSpec } from './level/types';

/**
 * What the picker decided, and the one channel between the play scene and the
 * HUD scene that sits over it.
 *
 * The two are separate scenes because `PauseMenu` really pauses: a paused scene
 * takes no input, so the buttons cannot live on the scene they pause. They talk
 * through this rather than through `scene.get`, so neither has to know the
 * other's key or whether it is awake.
 */
export class Session {
  readonly level: LevelSpec;
  /** Moves this level may take and still pay in full. */
  readonly budget: number;
  /** `board`, `undo` and `reset` travel over this. */
  readonly events = new Phaser.Events.EventEmitter();
  /**
   * The last board the play scene reported, kept so the HUD can draw itself
   * the moment it is created.
   *
   * The HUD is launched BY the play scene, so its `create` runs a frame later
   * and it misses the first `board` event — without this the counter and the
   * goal glyphs stay blank until the player's first move, which reads as a
   * broken HUD rather than a late one.
   */
  board: BoardState | null = null;

  constructor(
    readonly mode: LevelMode,
    readonly levelIndex: number,
    readonly difficulty: Difficulty,
  ) {
    this.level = levelAt(mode, levelIndex);
    this.budget = Math.max(1, Math.round(this.level.parMoves * BUDGET[difficulty]));
  }
}

/**
 * A box holding the current session, so the scenes can be constructed once, in
 * `mount`, before anything has been picked.
 */
export class SessionRef {
  private session: Session | null = null;

  set(session: Session): void {
    this.session = session;
  }

  get(): Session {
    if (this.session === null) throw new Error('sokoban: no level has been picked yet');
    return this.session;
  }
}
