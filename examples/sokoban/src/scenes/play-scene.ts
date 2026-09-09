import Phaser from 'phaser';
import type { GameController } from '@playground/game-core';
import { UiRoot, isModalOpen, loadImages, ui, type Rect } from '@kapsel/shared';
import { loadSokobanImages } from '../assets';
import { BoardView } from '../board-view';
import {
  restore,
  settle,
  snapshot,
  startBoard,
  step,
  type BoardState,
  type Direction,
  type Snapshot,
} from '../board';
import { BOARD, hudBandHeight } from '../constants';
import { StepInput } from '../input';
import type { Session, SessionRef } from '../session';

/**
 * The board, the steps and nothing else. The numbers along the top belong to
 * `HudScene`, which runs alongside and stays awake while this one is paused.
 * How much room they take is `hudBandHeight`; the board gets what is left,
 * which on every device we ship to is more than it needs — the puzzles are 6 to
 * 14 cells wide and the art is 128 px a cell.
 */

/**
 * Room under the board for the "reset the board" line, which is the only thing
 * down there now that reset itself has moved up beside the pause button.
 */
const BOTTOM_BAND = 110;

export class PlayScene extends Phaser.Scene {
  private state!: BoardState;
  private view!: BoardView;
  private root!: UiRoot;
  /** One reader per seat: in co-op the two walk independently. */
  private steps: StepInput[] = [];
  /**
   * Moves that can be taken back. Sinking a crate clears it — see `move`.
   *
   * Empty for the whole of a co-op board: with two people moving at once, the
   * last move is not necessarily the move of whoever pressed the button, and
   * "undo somebody else's step" is a worse answer than "start the board again".
   * The reset button is the only way back there.
   */
  private history: Snapshot[] = [];
  /** Per seat: a player may not start a step while their own is still running. */
  private busy: boolean[] = [];
  private finished = false;
  private buttonWas = new WeakMap<GameController, boolean>();
  private session!: Session;

  constructor(
    private seats: GameController[],
    private ref: SessionRef,
  ) {
    super('Play');
  }

  preload(): void {
    loadImages(this);
    loadSokobanImages(this);
  }

  create(): void {
    this.session = this.ref.get();
    this.state = startBoard(this.session.level);
    this.view = new BoardView(this, this.state);
    this.history = [];
    this.busy = this.state.players.map(() => false);
    this.steps = this.state.players.map(() => new StepInput());
    this.finished = false;

    this.root = new UiRoot(this, (screen) => this.place(screen));

    this.session.events.on('undo', this.undo, this);
    this.session.events.on('reset', this.reset, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.session.events.off('undo', this.undo, this);
      this.session.events.off('reset', this.reset, this);
    });

    // The HUD is launched from here rather than listed in the module, because
    // it reads the board this scene has just built.
    this.scene.launch('Hud');
    this.report();
  }

  private place(screen: Rect): void {
    // How tall the HUD is depends on how many rows of goal glyphs it draws, and
    // `hudBandHeight` is the one place that knows — the HUD lays itself out
    // against the same numbers.
    const goals = this.session.level.features.filter((f) => f?.colour !== undefined).length;
    const top = ui(hudBandHeight(goals));
    const bottom = ui(BOTTOM_BAND);
    const margin = (screen.w * (1 - BOARD.widthFraction)) / 2;
    this.view.place({
      x: margin,
      y: top,
      w: screen.w - margin * 2,
      h: Math.max(1, screen.h - top - bottom),
    });
  }

  /**
   * Which controllers drive a given player.
   *
   * In co-op it is one each, by seat — that is the whole point. A story board
   * has one player piece and the picker only offers it to a roster of one, so
   * the other branch is a safety net: if a story board is ever reached with two
   * controllers, either of them moves the character rather than one of them
   * being dead.
   */
  private controllersFor(seat: number): GameController[] {
    if (this.session.level.mode !== 'coop') return this.seats;
    const controller = this.seats[seat];
    return controller === undefined ? [] : [controller];
  }

  update(): void {
    if (this.finished || isModalOpen(this)) return;

    if (this.undoable) {
      for (const controller of this.seats) {
        // The button is read as an edge, not a level: holding it down is one
        // undo, the same way holding a direction is one step until it repeats.
        const pressed = controller.button;
        if (pressed && this.buttonWas.get(controller) !== true) this.undo();
        this.buttonWas.set(controller, pressed);
      }
    }

    const now = this.time.now;
    for (let seat = 0; seat < this.state.players.length; seat++) {
      if (this.busy[seat] === true) continue;
      const reader = this.steps[seat];
      if (reader === undefined) continue;
      for (const controller of this.controllersFor(seat)) {
        const direction = reader.poll(controller.axes, now);
        if (direction !== null) {
          this.move(seat, direction);
          break;
        }
      }
    }
  }

  /** Co-op has no undo; see `history`. */
  private get undoable(): boolean {
    return this.session.level.mode !== 'coop';
  }

  private move(seat: number, direction: Direction): void {
    const before = snapshot(this.state);
    const result = step(this.state, seat, direction);
    if (result === null) {
      // Blocked. The player still turns to face the way they tried, which is
      // the only feedback there is that the input was read at all.
      this.view.face(seat, direction);
      return;
    }
    // A crate in a pit cannot be got back out, so the moves before it cannot be
    // undone either — the board would come back with a filled pit and a crate
    // that exists twice. Clearing the history is what makes "reset" the answer
    // to a lost crate, which is what the stuck banner says.
    if (!this.undoable || result.sank) this.history = [];
    else this.history.push(before);

    this.busy[seat] = true;
    this.view.play(result, () => {
      this.busy[seat] = false;
      // The cell behind them is free again only now, when they are visibly out
      // of it — see `Player.leaving`.
      settle(this.state, seat);
      this.report();
      if (result.solved) this.finish();
    });
    this.report();
  }

  private undo(): void {
    if (!this.undoable || this.finished || this.busy.some(Boolean)) return;
    const previous = this.history.pop();
    if (previous === undefined) return;
    restore(this.state, previous);
    this.view.refresh();
    for (const reader of this.steps) reader.reset();
    this.report();
  }

  private reset(): void {
    if (this.finished) return;
    this.state = startBoard(this.session.level);
    this.history = [];
    this.busy = this.state.players.map(() => false);
    for (const reader of this.steps) reader.reset();
    // A fresh board means fresh images: crates that sank joined the ground
    // plane. `destroy` stops the old view's tweens first — a step that was
    // still animating would otherwise finish against pictures that no longer
    // exist, and clear this seat's `busy` flag on the new board.
    this.view.destroy();
    this.view = new BoardView(this, this.state);
    // The placement closure reads `this.view`, so the new one only has to be
    // put where the old one was — a second UiRoot would add a second listener.
    this.root.refresh();
    this.report();
  }

  /** Hand the HUD the numbers it draws, and leave them where it can find them. */
  private report(): void {
    this.session.board = this.state;
    this.session.events.emit('board', this.state);
  }

  private finish(): void {
    this.finished = true;
    this.scene.stop('Hud');
    this.scene.start('Results', {
      moves: this.state.moves,
      perPlayer: this.state.players.map((player) => player.moves),
      coins: this.state.level.coins.length - this.state.coins.length,
    });
  }
}
