import Phaser from 'phaser';
import {
  AnimatedBackground,
  ArrowButton,
  ScreenHeader,
  ScreenTitle,
  TITLE_ROW,
  DifficultyBar,
  FONT,
  FlatButton,
  SPACE,
  TYPE,
  UiRoot,
  fixed,
  flexible,
  generateUiTextures,
  loadImages,
  spacer,
  ui,
  uiFont,
  verticalGroupKeyed,
  type Difficulty,
  type Rect,
} from '@kapsel/shared';
import type { GameController } from '@playground/game-core';
import { hasThumb, loadLevelThumbs, thumbKey } from '../assets';
import { BUDGET } from '../constants';
import { levelsFor } from '../level/levels';
import { SEATS } from '../level/tiled';
import type { LevelMode } from '../level/types';
import { howToPlay } from '../how-to-play';
import { t } from '../i18n/strings';
import { bestMoves, unlockedCount } from '../progress';
import { Session, type SessionRef } from '../session';

/**
 * Pick a board and how much slack it gives you.
 *
 * Reference-px bands, matching the Tilt Ball and Plane Cave setup screens so
 * every pre-game screen in the hub reads as one product.
 *
 * **Nothing here is ever rebuilt.** Every object is created once in `create`
 * and only repositioned in the layout pass — the shared widgets have `setRect`,
 * so the clear-and-rebuild the older setup screens do is unnecessary, and
 * rebuilding while a widget's own tween is running is how one of them ended up
 * writing into freed vertex data.
 */
/** Tall enough for a real button; START is the same height. */
const MODE_ROW = 104;
/**
 * Room under the mode buttons for "needs 2 players". Reserved whether or not
 * the line is showing, so the buttons do not move when a second controller
 * joins — the same call Tilt Ball's picker made.
 */
const MODE_HINT_ROW = 40;
const NAME_ROW = 56;
const CAPTION_ROW = 44;
const DIFFICULTY_ROW = 120;
const START_W = 420;
const START_H = 110;
const ARROW_COL = 110;

/**
 * The picker sits on the shared sky-and-grass backdrop, which is PALE. Ink is
 * dark here for the same reason it is dark on the Hop Up and Plane Cave
 * pickers: pale text on a pale sky is text nobody reads. The same goes for the
 * difficulty bar, which takes `onLight` for exactly this.
 */
const INK = { title: '#20313f', body: '#3d5468', blocked: '#8a3d2f' };
const LOCKED_TINT = 0x4a5262;

const MODES: readonly LevelMode[] = ['story', 'coop'];

export class SetupScene extends Phaser.Scene {
  private mode: LevelMode = 'story';
  /** Where the picker sits in each ladder, so switching back returns there. */
  private index: Record<LevelMode, number> = { story: 0, coop: 0 };
  private difficulty: Difficulty = 'easy';

  private bg!: AnimatedBackground;
  private header!: ScreenHeader;
  private title!: ScreenTitle;
  private modeButtons: { mode: LevelMode; button: FlatButton }[] = [];
  /** One per mode, in `MODES` order: why this mode cannot be picked. */
  private modeHints: Phaser.GameObjects.Text[] = [];
  private thumb!: Phaser.GameObjects.Image;
  private previous!: ArrowButton;
  private next!: ArrowButton;
  private name!: Phaser.GameObjects.Text;
  private caption!: Phaser.GameObjects.Text;
  private difficultyBar!: DifficultyBar;
  private start!: FlatButton;

  constructor(
    private seats: GameController[],
    private ref: SessionRef,
    private onStart: () => void,
    private onExit: () => void,
  ) {
    super('Setup');
  }

  /**
   * A mode is playable when the roster is exactly the size its boards are drawn
   * for. Co-op needs two people; story boards have one player piece, and with
   * two controllers plugged in the second person would sit and watch. So the
   * roster picks the mode and the other one is shown greyed with the reason.
   */
  private modeAllowed(mode: LevelMode): boolean {
    return this.seats.length === SEATS[mode];
  }

  private levels(): ReturnType<typeof levelsFor> {
    return levelsFor(this.mode);
  }

  private get current(): number {
    return this.index[this.mode];
  }

  preload(): void {
    loadImages(this);
    loadLevelThumbs(this);
  }

  create(): void {
    generateUiTextures(this);
    this.bg = new AnimatedBackground(this, { grass: 'low' });
    // No milestones button: Box Depot pays no orbs yet, and a trophy over an
    // empty list would promise a reward that does not exist.
    this.header = new ScreenHeader(this, { onBack: () => this.onExit(), howTo: howToPlay });

    // Open on the furthest board reached in each ladder, not back at the first
    // one — the ladder is where the player left it.
    for (const mode of MODES) {
      this.index[mode] = Math.max(0, Math.min(unlockedCount(mode), levelsFor(mode).length) - 1);
    }

    // Translated, like the lobby card that leads here: a player who tapped
    // "Magazyn" should not arrive at a screen headed BOX DEPOT.
    this.title = new ScreenTitle(this, { text: t('setup.title'), color: INK.title });

    this.modeButtons = MODES.map((mode) => ({
      mode,
      button: new FlatButton(this, 0, 0, {
        width: ui(START_W),
        height: ui(MODE_ROW),
        text: t(`setup.${mode}`),
        fontSize: TYPE.subheading,
        // `button-dark`'s insets total 122 px vertically, so a nine-slice of it
        // cannot be drawn 104 tall — it clamps, and the button comes out taller
        // than the row reserved for it. Drawing the plate at half size and
        // scaling it back shrinks the border detail with it.
        textureScale: 0.5,
        onClick: () => this.pickMode(mode),
      }),
    }));
    // One line per mode, under the button it is about, saying why it cannot be
    // picked. Room for it is reserved either way, so the buttons never move.
    this.modeHints = MODES.map((mode) =>
      this.add
        .text(0, 0, t(`setup.${mode}-needs`, { seats: SEATS[mode] }), {
          fontFamily: FONT,
          fontSize: uiFont(TYPE.caption),
          color: INK.blocked,
        })
        .setOrigin(0.5)
        .setVisible(false),
    );

    // The roster decides where the picker opens: with two controllers there is
    // nothing to do on a story board, so co-op is what comes up.
    this.mode = MODES.find((mode) => this.modeAllowed(mode)) ?? 'story';

    this.thumb = this.add.image(0, 0, thumbKey(this.levels()[0]!.id)).setOrigin(0.5);

    this.previous = new ArrowButton(this, false, () => this.move(-1));
    this.next = new ArrowButton(this, true, () => this.move(1));

    this.name = this.add
      .text(0, 0, '', {
        fontFamily: FONT,
        fontSize: uiFont(TYPE.heading),
        color: INK.title,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.caption = this.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: uiFont(TYPE.label), color: INK.body })
      .setOrigin(0.5);
    this.difficultyBar = new DifficultyBar(this, {
      x: 0,
      y: 0,
      width: 100,
      value: this.difficulty,
      label: t('setup.difficulty'),
      showValueLabel: true,
      onLight: true,
      onChange: (value) => {
        this.difficulty = value;
        this.refresh();
      },
    });

    this.start = new FlatButton(this, 0, 0, {
      width: ui(START_W),
      height: ui(START_H),
      text: t('setup.start'),
      fontSize: TYPE.heading,
      onClick: () => this.launch(),
    });

    new UiRoot(this, (screen) => this.place(screen));
    this.refresh();
  }

  private move(step: number): void {
    const count = this.levels().length;
    this.index[this.mode] = Math.min(count - 1, Math.max(0, this.current + step));
    this.refresh();
  }

  private pickMode(mode: LevelMode): void {
    if (!this.modeAllowed(mode)) return;
    this.mode = mode;
    this.refresh();
  }

  private locked(index: number): boolean {
    return index + 1 > unlockedCount(this.mode);
  }

  /** Put the current board's picture and numbers on screen. */
  private refresh(): void {
    for (const { mode, button } of this.modeButtons) {
      // Blue for the mode you are on, grey for the other — the pairing
      // `SegmentedControl` uses, built from two buttons because co-op has to be
      // DISABLED for a single player and a segment cannot be.
      button.setTexture(mode === this.mode ? 'button-blue' : 'button-dark');
      button.setEnabled(this.modeAllowed(mode));
    }
    MODES.forEach((mode, index) => {
      this.modeHints[index]?.setVisible(!this.modeAllowed(mode));
    });

    const levels = this.levels();
    const level = levels[this.current]!;
    const locked = this.locked(this.current);

    // A level whose thumbnail has not been baked still has to be pickable, so
    // the picture is simply left as it was and the name carries the screen.
    if (hasThumb(level.id)) this.thumb.setTexture(thumbKey(level.id));
    this.thumb.setTint(locked ? LOCKED_TINT : 0xffffff);

    this.name.setText(`${this.current + 1}. ${level.title}`);

    if (locked) {
      this.caption.setText(t('setup.locked'));
      this.caption.setColor(INK.blocked);
    } else {
      const best = bestMoves(level.id, this.difficulty);
      const budget = Math.max(1, Math.round(level.parMoves * BUDGET[this.difficulty]));
      this.caption.setText(
        best === null ? t('setup.par', { count: budget }) : t('setup.best', { count: best }),
      );
      this.caption.setColor(INK.body);
    }

    this.previous.setEnabled(this.current > 0);
    this.next.setEnabled(this.current < levels.length - 1);
    this.start.setEnabled(!locked);
    // The picture's aspect is the board's, and every board has its own, so the
    // fit is recomputed here rather than baked into the layout.
    this.fitThumb();
  }

  private thumbBox: Rect = { x: 0, y: 0, w: 1, h: 1 };

  private fitThumb(): void {
    // Every board has its own aspect, so the picture is fitted to the box
    // rather than the box to a fixed ratio.
    const source = this.thumb.texture.getSourceImage();
    const box = this.thumbBox;
    const scale = Math.min(box.w / source.width, box.h / source.height);
    this.thumb.setDisplaySize(source.width * scale, source.height * scale);
    this.thumb.setPosition(box.x + box.w / 2, box.y + box.h / 2);
  }

  private place(screen: Rect): void {
    this.bg.place(screen);
    this.header.layout(screen);

    const rows = verticalGroupKeyed(
      screen,
      [
        // Clear of the back button, which keeps its corner.
        spacer(ui(SPACE.xxl), ui(SPACE.md)),
        fixed(ui(TITLE_ROW), { key: 'title' }),
        spacer(ui(SPACE.sm), ui(SPACE.xs)),
        fixed(ui(MODE_ROW), { key: 'modes' }),
        fixed(ui(MODE_HINT_ROW), { key: 'modeHint' }),
        spacer(ui(SPACE.sm)),
        flexible(1, { key: 'thumb' }),
        spacer(ui(SPACE.md)),
        fixed(ui(NAME_ROW), { key: 'name' }),
        fixed(ui(CAPTION_ROW), { key: 'caption' }),
        spacer(ui(SPACE.md)),
        fixed(ui(DIFFICULTY_ROW), { key: 'difficulty' }),
        spacer(ui(SPACE.md)),
        fixed(ui(START_H), { key: 'start' }),
        spacer(ui(SPACE.xl)),
      ],
      { padding: { l: ui(SPACE.lg), r: ui(SPACE.lg) } },
    );

    this.title.setRect(rows.title!);

    // The two mode buttons share their row, side by side.
    const modeRow = rows.modes!;
    const modeW = (modeRow.w - ui(SPACE.sm)) / 2;
    this.modeButtons.forEach(({ button }, index) => {
      button.setRect({
        x: modeRow.x + index * (modeW + ui(SPACE.sm)),
        y: modeRow.y,
        w: modeW,
        h: modeRow.h,
      });
    });
    const hintRow = rows.modeHint!;
    this.modeHints.forEach((hint, index) => {
      hint.setPosition(modeRow.x + index * (modeW + ui(SPACE.sm)) + modeW / 2, hintRow.y + hintRow.h / 2);
    });

    const thumbRow = rows.thumb!;
    const arrow = ui(ARROW_COL);
    this.thumbBox = {
      x: thumbRow.x + arrow,
      y: thumbRow.y,
      w: thumbRow.w - arrow * 2,
      h: thumbRow.h,
    };
    this.fitThumb();
    this.previous.place(thumbRow.x + arrow / 2, thumbRow.y + thumbRow.h / 2);
    this.next.place(thumbRow.x + thumbRow.w - arrow / 2, thumbRow.y + thumbRow.h / 2);

    const centre = (rect: Rect): { x: number; y: number } => ({
      x: rect.x + rect.w / 2,
      y: rect.y + rect.h / 2,
    });
    this.name.setPosition(centre(rows.name!).x, centre(rows.name!).y);
    this.caption.setPosition(centre(rows.caption!).x, centre(rows.caption!).y);

    this.difficultyBar.setRect(rows.difficulty!);
    const startRow = rows.start!;
    this.start.setRect({
      x: startRow.x + (startRow.w - ui(START_W)) / 2,
      y: startRow.y,
      w: ui(START_W),
      h: ui(START_H),
    });
  }

  private launch(): void {
    if (this.locked(this.current)) return;
    this.ref.set(new Session(this.mode, this.current, this.difficulty));
    this.onStart();
  }
}
