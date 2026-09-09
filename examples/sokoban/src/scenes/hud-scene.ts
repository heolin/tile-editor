import Phaser from 'phaser';
import {
  FONT,
  FlatButton,
  PauseMenu,
  SPACE,
  TYPE,
  UiRoot,
  loadImages,
  ui,
  uiFont,
  type Rect,
} from '@kapsel/shared';
import { hudKey, loadSokobanImages } from '../assets';
import { stuck, type BoardState } from '../board';
import { GOAL_ICON, GOAL_ROW, HUD } from '../constants';
import type { CrateColour } from '../level/types';
import { t } from '../i18n/strings';
import type { Session, SessionRef } from '../session';

/**
 * The numbers over the board: which level this is, how many moves have gone,
 * which goals are still open, and the three controls — undo, reset, pause.
 *
 * A scene of its own because `PauseMenu` really pauses: it puts the play scene
 * into Phaser's PAUSED state, and a paused scene takes no input, so the button
 * that resumes it cannot live there. The board is never touched from here —
 * undo and reset are asked for through `Session.events` and the play scene is
 * the one that decides what they mean.
 */
/**
 * Mirrored from `PauseMenu`, which does not export them: the corner control's
 * size and the margin it hangs from. Reset sits beside it, matched, because two
 * corner buttons of different sizes read as two different kinds of thing.
 */
const PAUSE_BTN = 110;
const CORNER_GAP = 12;
/** The reset icon, a circular arrow drawn to match the pause glyph's weight. */
const RESET_ICON = 'reset';
/** Beside the move counter, so the two numbers are obviously steps. */
const STEP_ICON = 'footstep';
const STEP_ICON_SIZE = 44;

/**
 * Fit a level's name into `maxW` and at most two lines — the room the band
 * reserves for it. Wrapping is what a long name wants; shrinking is the floor
 * under a name too long to wrap into two.
 */
function fitTitle(text: Phaser.GameObjects.Text, maxW: number): void {
  let size = Math.round(ui(TYPE.subheading));
  const floor = Math.round(ui(TYPE.label));
  text.setFontSize(`${size}px`);
  text.setWordWrapWidth(maxW);
  while (size > floor && text.getWrappedText().length > 2) {
    size = Math.max(floor, Math.floor(size * 0.9));
    text.setFontSize(`${size}px`);
  }
}

export class HudScene extends Phaser.Scene {
  private session!: Session;
  private title!: Phaser.GameObjects.Text;
  private moves!: Phaser.GameObjects.Text;
  private movesIcon!: Phaser.GameObjects.Image;
  /** Where the counter's right edge sits, kept because the number changes width. */
  private movesAnchor = { x: 0, y: 0 };
  private stuckLine!: Phaser.GameObjects.Text;
  private goals: { colour: CrateColour; image: Phaser.GameObjects.Image }[] = [];
  /**
   * Reset lives in the top corner beside pause, as an icon.
   *
   * There is no undo button. Taking a move back is the controller's action
   * button, which the ready screen explains, and on a co-op board there is no
   * undo at all — see `PlayScene.history`. A pair of word-buttons under the
   * board cost it a fifth of the screen for two things a player uses rarely.
   */
  private reset!: FlatButton;

  constructor(
    private ref: SessionRef,
    private onExit: () => void,
  ) {
    super('Hud');
  }

  preload(): void {
    loadImages(this);
    loadSokobanImages(this);
  }

  create(): void {
    this.session = this.ref.get();
    const level = this.session.level;

    this.title = this.add
      .text(0, 0, level.title, {
        fontFamily: FONT,
        fontSize: uiFont(TYPE.subheading),
        color: '#e8edf7',
        fontStyle: 'bold',
      })
      // Anchored by its TOP-LEFT, not its middle: a title that takes two lines
      // has to grow DOWNWARD into the room reserved for it, and a centred one
      // grew half a line up off the screen and half a line onto the glyphs.
      .setOrigin(0, 0);

    this.moves = this.add
      .text(0, 0, '', {
        fontFamily: FONT,
        fontSize: uiFont(TYPE.heading),
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(1, 0.5);
    this.movesIcon = this.add
      .image(0, 0, STEP_ICON)
      .setDisplaySize(ui(STEP_ICON_SIZE), ui(STEP_ICON_SIZE))
      .setOrigin(1, 0.5);

    // EMPTIED, not appended to. A Phaser scene instance is built once and its
    // `create` runs again on every start, so this array still holds the glyphs
    // of the last board — destroyed with that run's scene. Pushing onto it left
    // `render` reading a dead Image, whose `setTexture` throws on a `scene` that
    // is no longer there. Every field a `create` fills has to be cleared here.
    this.goals = [];

    // One glyph per goal, in the order the level lists them, so a board with
    // two colours shows two runs rather than an interleaved row.
    for (let index = 0; index < level.features.length; index++) {
      const colour = level.features[index]?.colour;
      if (colour === undefined) continue;
      this.goals.push({
        colour,
        image: this.add.image(0, 0, hudKey(colour, false)).setDisplaySize(ui(GOAL_ICON), ui(GOAL_ICON)),
      });
    }

    this.stuckLine = this.add
      .text(0, 0, t('stuck.title'), {
        fontFamily: FONT,
        fontSize: uiFont(TYPE.label),
        color: '#ff5a4d',
        fontStyle: 'bold',
        align: 'center',
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.reset = new FlatButton(this, 0, 0, {
      width: ui(PAUSE_BTN),
      height: ui(PAUSE_BTN),
      icon: RESET_ICON,
      // The pause button draws its glyph at 52 in a 110 button; matching the
      // fraction keeps the two corner controls looking like a pair.
      iconFrac: 52 / 110,
      texture: 'button-dark',
      onClick: () => this.session.events.emit('reset'),
    });

    const pause = new PauseMenu(this, {
      onExit: () => {
        this.scene.stop('Play');
        this.onExit();
      },
      onPause: () => this.scene.pause('Play'),
      onResume: () => this.scene.resume('Play'),
    });
    void pause;

    this.session.events.on('board', this.render, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.session.events.off('board', this.render, this);
    });

    new UiRoot(this, (screen) => this.place(screen));

    // The play scene reported the starting board before this scene existed —
    // see `Session.board`.
    const board = this.session.board;
    if (board !== null) this.render(board);
  }

  /** The board changed: redraw the counter, the glyphs and the stuck line. */
  private render(state: BoardState): void {
    this.moves.setText(t('hud.budget', { used: state.moves, budget: this.session.budget }));
    // Over the budget is not a loss — the level is still finishable, it just
    // stops paying in full — so the number goes red rather than anything ending.
    this.moves.setColor(state.moves > this.session.budget ? '#ff5a4d' : '#ffffff');
    // The icon follows the number's left edge, and the number changes width on
    // the tenth move — so this runs on every redraw, not only on a resize.
    this.placeMoves();

    let slot = 0;
    const level = state.level;
    for (let index = 0; index < level.features.length; index++) {
      const feature = level.features[index];
      if (feature?.colour === undefined) continue;
      const x = index % level.width;
      const y = Math.floor(index / level.width);
      const done = state.crates.some(
        (crate) => crate.x === x && crate.y === y && crate.colour === feature.colour && crate.sunk === feature.pit,
      );
      const glyph = this.goals[slot];
      if (glyph === undefined) throw new Error('sokoban: the HUD has fewer glyphs than the board has goals');
      glyph.image.setTexture(hudKey(feature.colour, done));
      slot++;
    }

    // Counting, not solving: `stuck` catches the one case a player cannot undo
    // their way out of, because sinking a crate cleared the history.
    this.stuckLine.setVisible(stuck(state));
  }

  /** The counter and its glyph, hung off the anchor the layout last set. */
  private placeMoves(): void {
    const { x, y } = this.movesAnchor;
    this.moves.setPosition(x, y);
    this.movesIcon.setPosition(x - this.moves.width - ui(SPACE.xs), y);
  }

  private place(screen: Rect): void {
    const margin = ui(SPACE.lg);
    const top = screen.y + ui(SPACE.md);

    // The title has the first row to itself, because the pause button is in
    // that corner and a long level name would otherwise run under it. The move
    // counter goes a row down, on the right, opposite the goal glyphs — that
    // row is short whatever the level is called.
    // The name shares the top with the two corner buttons, so it wraps clear of
    // them — and takes at most the two lines the band reserves.
    this.title.setPosition(screen.x + margin, top);
    fitTitle(this.title, screen.w - margin - ui(PAUSE_BTN * 2 + CORNER_GAP + SPACE.md * 2));

    // Beside the pause button, at the same size and the same margin from the
    // top — `PauseMenu` anchors its own from the top-right with `SPACE.md`.
    const corner = ui(PAUSE_BTN);
    this.reset.setRect({
      x: screen.x + screen.w - ui(SPACE.md) - corner * 2 - ui(CORNER_GAP),
      y: screen.y + ui(SPACE.md),
      w: corner,
      h: corner,
    });
    // Goal glyphs in rows of five, under the title's reserved block — which is
    // also below the corner buttons, so the counter opposite them has somewhere
    // to sit. Their row is fixed, not measured off the title: see `HUD`.
    const step = ui(GOAL_ICON + HUD.rowGap);
    const goalsY = screen.y + ui(HUD.margin + HUD.titleBlock + HUD.gap + GOAL_ICON / 2);
    this.goals.forEach((goal, index) => {
      goal.image.setPosition(
        screen.x + margin + ui(GOAL_ICON) / 2 + (index % GOAL_ROW) * step,
        goalsY + Math.floor(index / GOAL_ROW) * step,
      );
    });
    // The icon sits to the LEFT of the number, and both hang off the right
    // margin — so the pair stays put as the number grows from 0 to three digits.
    this.movesAnchor = { x: screen.x + screen.w - margin, y: goalsY };
    this.placeMoves();

    // Under the board, in the strip the two word-buttons used to take.
    this.stuckLine.setPosition(screen.x + screen.w / 2, screen.y + screen.h - ui(SPACE.xl));
    this.stuckLine.setWordWrapWidth(screen.w - margin * 2);
  }
}
