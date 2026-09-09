import Phaser from 'phaser';
import type { GameController } from '@playground/game-core';
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
  Stepper,
  TYPE,
  UiRoot,
  fitInParent,
  fixed,
  flexSpacer,
  flexible,
  generateUiTextures,
  horizontalGroup,
  loadImages,
  placeAt,
  preferred,
  spacer,
  ui,
  uiFont,
  verticalGroup,
  verticalGroupKeyed,
  type Difficulty,
  type Rect,
} from '@kapsel/shared';
import { hasThumb, loadLevelThumbs, loadTiltBallImages, thumbKey } from '../assets';
import { textureKey } from '../level/tiled';
import { levelsFor, randomVersusQueue } from '../level/levels';
import type { LevelMode, LevelSpec } from '../level/types';
import { howToPlay } from '../how-to-play';
import { milestones } from '../milestones';
import { t } from '../i18n/strings';
import { bestTime, unlockedCount } from '../progress';
import { formatTime } from '../rules';
import { Session, type SessionRef } from '../session';

// Reference-px band heights, matching the Plane Cave and racing setup screens so
// every pre-game screen in the hub reads as one product. The title's band is
// `TITLE_ROW`, from shared, which is where the other eight take theirs.
/** Tall enough for a real button; START is the same height. */
const MODE_ROW = 104;
/**
 * Room under the mode buttons for "requires 2+ players". Reserved whether or not
 * the line is showing, so the buttons do not move when a second player joins —
 * and so the story button never sits at a different height from the versus one.
 */
const MODE_HINT_ROW = 40;
/** The level's name and number, and under it the record, in a smaller size. */
const NAME_ROW = 56;
const RECORD_ROW = 44;
/**
 * How much of the fitted box the picture actually takes. The tenth it gives up
 * becomes the room the two lines below it needed — and because the shrunk box
 * keeps its TOP edge, the picture rises by half of that at the same time.
 */
const THUMB_SHRINK = 0.9;
const DIFFICULTY_ROW = 120;
const START_W = 420;
const START_H = 110;
const ARROW_COL = 110;
const LOCK_BADGE = 120;
/** Thumbnail aspect, fixed by the baker: a 16x20 board plus its frame. */
const THUMB_RATIO = 410 / 512;

/** The line under a mode that cannot be picked. */
const INK = { blocked: '#8b95a6' };
const LOCKED_TINT = 0x4a5262;

/** Versus is a race, and a race needs somebody to race. */
const VERSUS_MIN_PLAYERS = 2;

/**
 * Pick a mode, pick what to play, pick how hard.
 *
 * Mode is two buttons at the top, blue for the one you are on and grey for the
 * other — the pairing `SegmentedControl` uses, but built from two `FlatButton`s
 * because versus has to be DISABLED for a single player and a segment cannot be.
 *
 * **Nothing on this screen is ever rebuilt.** Every object is created once in
 * `create` and only repositioned in the layout pass, and switching mode toggles
 * visibility rather than tearing a band down. The other six setup screens in
 * the hub clear and rebuild a content container, because they were written when
 * the shared widgets baked their geometry at construction — `FlatButton`,
 * `DifficultyBar` and `Stepper` have since grown `setRect` and `ArrowButton` a
 * `place`, which is exactly the change racing's menu predicted would make the
 * rebuild unnecessary.
 *
 * It also removes a whole class of bug, and this screen had one: rebuilding
 * from `DifficultyBar.onChange` destroyed the bar while its own ~200 ms value
 * tween was running, and that tween went on calling `setSlices` into freed
 * vertex data.
 */
export class SetupScene extends Phaser.Scene {
  private mode: LevelMode = 'story';
  private difficulty: Difficulty = 'easy';
  private storyIndex = 0;
  private versusCount = 2;

  private bg!: AnimatedBackground;
  private header!: ScreenHeader;
  private title!: ScreenTitle;
  private modeButtons: { mode: LevelMode; button: FlatButton }[] = [];
  /** Shown under VERSUS MODE when there is nobody to race. */
  private versusHint!: Phaser.GameObjects.Text;
  private difficultyBar!: DifficultyBar;
  private startButton!: FlatButton;

  // Story picker.
  private thumb!: Phaser.GameObjects.Image;
  private lockBadge!: Phaser.GameObjects.Image;
  private previous!: ArrowButton;
  private next!: ArrowButton;
  // Versus picker.
  private boards!: Stepper;
  /** The level's name and its place in the ladder. Story only. */
  private levelName!: Phaser.GameObjects.Text;
  /**
   * The line under it: the record, or what is in the way of playing. Shared by
   * both pickers — they are never on screen together, and giving each its own
   * copy of the same rect is how the two would drift apart.
   */
  private caption!: Phaser.GameObjects.Text;

  constructor(
    private seats: GameController[],
    private ref: SessionRef,
    private onStart: () => void,
    private onExit: () => void,
  ) {
    super('Setup');
  }

  preload(): void {
    loadImages(this);
    loadTiltBallImages(this);
    loadLevelThumbs(this);
  }

  create(): void {
    generateUiTextures(this);
    this.bg = new AnimatedBackground(this, { grass: 'low' });
    this.header = new ScreenHeader(this, {
      onBack: () => this.onExit(),
      howTo: howToPlay,
      milestones,
    });

    // Start on the furthest level the player has reached, not back at the first
    // one — the ladder is where they left it.
    this.storyIndex = Math.min(unlockedCount(), levelsFor('story').length) - 1;

    this.build();
    new UiRoot(this, (screen) => this.place(screen));
  }

  // ── built once ─────────────────────────────────────────────────────────

  private build(): void {
    const story = levelsFor('story');
    const versus = levelsFor('versus');
    if (story.length === 0) throw new Error('tilt-ball: no story levels');
    if (versus.length === 0) throw new Error('tilt-ball: no versus levels');
    this.versusCount = Phaser.Math.Clamp(this.versusCount, 1, versus.length);

    // Translated, like the lobby card that leads here — and dark ink inside the
    // white frame, as on every other pre-game screen. It was white-on-sky here,
    // which was the one name in the product with no frame around it.
    this.title = new ScreenTitle(this, { text: t('setup.title') });

    // Two buttons rather than two words: at heading size the words were as big
    // as the title. Blue for the mode you are on and grey for the other, which
    // is the same pairing `SegmentedControl` uses — built here instead of with
    // it because versus has to be DISABLED for a single player, and a segment
    // cannot be.
    this.modeButtons = (
      [
        ['story', t('setup.story')],
        ['versus', t('setup.versus')],
      ] as const
    ).map(([mode, label]) => {
      const button = new FlatButton(this, 0, 0, {
        width: ui(300),
        height: ui(MODE_ROW),
        text: label,
        fontSize: TYPE.subheading,
        // Dark rather than grey for the mode that is not selected: the pair
        // reads better against the pale sky, and Box Depot's picker uses the
        // same two plates. `textureScale` is what lets a `button-dark` be 104
        // tall at all — its insets total 122, so the nine-slice would clamp.
        texture: 'button-dark',
        textureScale: 0.5,
        onClick: () => {
          if (this.mode === mode) return;
          this.mode = mode;
          this.sync();
        },
      });
      return { mode: mode as LevelMode, button };
    });

    this.versusHint = this.add
      .text(0, 0, t('setup.versus-needs', { min: VERSUS_MIN_PLAYERS }), {
        fontFamily: FONT,
        color: INK.blocked,
      })
      .setOrigin(0.5);

    // Both pickers exist at once and one of them is hidden. Cheaper than a
    // rebuild, and it means a tap can never destroy something mid-animation.
    this.thumb = this.add.image(0, 0, thumbKey(story[this.storyIndex]!.id));
    this.lockBadge = this.add.image(0, 0, textureKey('block_locked_square'));
    this.previous = new ArrowButton(this, false, () => this.stepStory(-1));
    this.next = new ArrowButton(this, true, () => this.stepStory(1));

    this.boards = new Stepper(this, {
      x: 0,
      y: 0,
      label: t('setup.boards'),
      min: 1,
      max: versus.length,
      value: this.versusCount,
      spread: 180,
      labelSize: TYPE.heading,
      valueSize: TYPE.title,
      onChange: (value) => {
        this.versusCount = value;
        this.sync();
      },
    });

    // Both lines are white: they are what the screen is about, not a footnote.
    this.levelName = this.add
      .text(0, 0, '', { fontFamily: FONT, color: '#ffffff', fontStyle: 'bold', align: 'center' })
      .setOrigin(0.5);
    this.caption = this.add
      .text(0, 0, '', { fontFamily: FONT, color: '#ffffff', align: 'center' })
      .setOrigin(0.5);

    this.difficultyBar = new DifficultyBar(this, {
      x: 0,
      y: 0,
      width: ui(600),
      value: this.difficulty,
      label: t('setup.difficulty'),
      showValueLabel: true,
      onChange: (value) => {
        this.difficulty = value;
        // The caption carries the record for the difficulty selected, so it has
        // to follow the bar. `sync` only sets text and flags — it never touches
        // the bar itself, which is mid-tween at this exact moment.
        this.sync();
      },
    });

    this.startButton = new FlatButton(this, 0, 0, {
      width: ui(START_W),
      height: ui(START_H),
      text: t('setup.start'),
      fontSize: TYPE.heading,
      texture: 'button-green',
      textureScale: 0.5,
      onClick: () => this.start(),
    });
  }

  // ── placed on every layout pass ────────────────────────────────────────

  /**
   * Position and size everything from the screen rect. Creates nothing, so it
   * is safe to run at any moment — including from a widget's own callback,
   * though `sync` is the one that gets called from there.
   */
  private place(screen: Rect): void {
    this.bg.place(screen);
    this.header.layout(screen);

    const rows = verticalGroupKeyed(
      screen,
      [
        spacer(ui(SPACE.xxl), ui(SPACE.md)), // clear of the back button
        preferred(ui(TITLE_ROW), { key: 'title', min: ui(64) }),
        spacer(ui(SPACE.sm), ui(SPACE.xs)),
        fixed(ui(MODE_ROW + MODE_HINT_ROW), { key: 'mode' }),
        spacer(ui(SPACE.md), ui(SPACE.sm)),
        flexible(1, { key: 'picker' }),
        spacer(ui(SPACE.md), ui(SPACE.sm)),
        preferred(ui(DIFFICULTY_ROW), { key: 'difficulty', min: ui(90) }),
        spacer(ui(SPACE.md), ui(SPACE.sm)),
        fixed(ui(START_H), { key: 'start', cross: ui(START_W), align: 'center' }),
        spacer(ui(SPACE.xl), ui(SPACE.md)),
      ],
      { padding: { l: ui(SPACE.lg), r: ui(SPACE.lg) } },
    );

    this.title.setRect(rows.title!);

    const halves = horizontalGroup(rows.mode!, [flexible(), flexible()], { spacing: ui(SPACE.md) });
    this.modeButtons.forEach((entry, index) => {
      const [seat, hint] = verticalGroup(halves[index]!, [
        flexible(),
        fixed(ui(MODE_HINT_ROW)),
      ]);
      entry.button.setRect(seat!);
      // The line about players belongs under the button it is about.
      if (entry.mode === 'versus') {
        this.versusHint.setFontSize(uiFont(TYPE.caption));
        placeAt(this.versusHint, hint!);
      }
    });

    // Two rows at the foot of the band: the name, and the record under it.
    const [pickerBand, nameRow, captionRow] = verticalGroup(
      rows.picker!,
      [flexible(), fixed(ui(NAME_ROW)), fixed(ui(RECORD_ROW))],
      { spacing: ui(SPACE.xs) },
    );
    this.placeStoryPicker(pickerBand!);
    this.placeVersusPicker(pickerBand!);
    this.levelName.setFontSize(uiFont(TYPE.subheading));
    placeAt(this.levelName, nameRow!);
    this.placeCaption(captionRow!);

    this.difficultyBar.setRect(rows.difficulty!);
    this.startButton.setRect(rows.start!);

    this.sync();
  }

  /** Thumbnail between two arrows. */
  private placeStoryPicker(band: Rect): void {
    // Arrows take a fixed column each; the picture gets what is left, fitted to
    // the thumbnail's aspect so it never stretches.
    const arrowW = ui(ARROW_COL);
    const [leftCol, pictureCol, rightCol] = horizontalGroup(
      band,
      [fixed(arrowW), flexible(), fixed(arrowW)],
      { spacing: ui(SPACE.xs) },
    );
    const fitted = fitInParent(pictureCol!, THUMB_RATIO);
    // Smaller than the space it was given, anchored to the TOP of it: the
    // picture loses a tenth and rises by half of that, and what it gives up is
    // where the two lines under it live.
    const box = {
      x: fitted.x + (fitted.w * (1 - THUMB_SHRINK)) / 2,
      y: fitted.y,
      w: fitted.w * THUMB_SHRINK,
      h: fitted.h * THUMB_SHRINK,
    };
    const middle = box.y + box.h / 2;

    this.thumb.setPosition(box.x + box.w / 2, middle).setDisplaySize(box.w, box.h);
    this.lockBadge
      .setPosition(box.x + box.w / 2, middle)
      .setDisplaySize(ui(LOCK_BADGE), ui(LOCK_BADGE));
    this.previous.place(leftCol!.x + leftCol!.w / 2, middle);
    this.next.place(rightCol!.x + rightCol!.w / 2, middle);
  }

  /** Versus picks only how many boards the series runs over. */
  private placeVersusPicker(band: Rect): void {
    const [, stepperRow] = verticalGroup(band, [flexSpacer(), preferred(ui(200)), flexSpacer()], {
      spacing: ui(SPACE.sm),
    });
    this.boards.setRect(stepperRow!);
  }

  private placeCaption(rect: Rect): void {
    this.caption.setFontSize(uiFont(TYPE.caption));
    this.caption.setWordWrapWidth(rect.w);
    placeAt(this.caption, rect);
  }

  // ── state, applied in place ────────────────────────────────────────────

  /**
   * Everything that can change without moving anything: which mode is bold,
   * which picker is showing, which thumbnail, whether it is locked, which
   * arrows are live, and the caption.
   *
   * Creates and destroys nothing, so it is safe from inside a widget callback
   * — which is the whole reason it exists as a separate step.
   */
  private sync(): void {
    for (const entry of this.modeButtons) {
      // Order matters: `setTexture` records the colour and applies it only while
      // the button is live, so a disabled versus stays grey however it is set.
      entry.button.setTexture(this.mode === entry.mode ? 'button-blue' : 'button-dark');
      entry.button.setEnabled(this.modeAllowed(entry.mode));
    }
    this.versusHint.setVisible(!this.modeAllowed('versus'));

    const story = this.mode === 'story';
    this.thumb.setVisible(story);
    this.previous.container.setVisible(story);
    this.next.container.setVisible(story);
    this.boards.container.setVisible(!story);

    if (!story) {
      this.lockBadge.setVisible(false);
      // Versus has no level to name: the stepper is the choice, and the line
      // under it says what that choice means.
      this.levelName.setText('');
      const available = levelsFor('versus').length;
      this.caption.setText(
        t('setup.versus-caption', { available, count: this.versusCount }),
      );
      return;
    }

    const levels = levelsFor('story');
    const open = Math.min(unlockedCount(), levels.length);
    const level = levels[this.storyIndex]!;
    const locked = this.storyIndex >= open;

    if (!hasThumb(level.id)) {
      throw new Error(`tilt-ball: no thumbnail for ${level.id} — run tools/tilt-ball-thumbs/bake.py`);
    }
    this.thumb.setTexture(thumbKey(level.id));
    if (locked) this.thumb.setTint(LOCKED_TINT);
    else this.thumb.clearTint();
    this.lockBadge.setVisible(locked);

    this.previous.setEnabled(this.storyIndex > 0);
    // The ladder stops at the first level that is not open yet: you may look at
    // the one you are about to unlock, and no further.
    this.next.setEnabled(this.storyIndex < open - 1);

    // The title itself comes from the level's `.tmj` and is not translated —
    // see the note in i18n/strings.ts.
    this.levelName.setText(
      t('setup.level-line', {
        title: level.title.toUpperCase(),
        index: this.storyIndex + 1,
        total: levels.length,
      }),
    );
    this.caption.setText(this.storyRecord(level, locked));
  }

  /**
   * Versus is a race and needs somebody to race: with one controller in the
   * roster it is greyed out, says so, and refuses the tap. Story is always
   * available — a ladder is a fine thing to work through alone.
   */
  private modeAllowed(mode: LevelMode): boolean {
    return mode === 'story' || this.seats.length >= VERSUS_MIN_PLAYERS;
  }

  /** The second line: the record on this difficulty, or why there is none. */
  private storyRecord(level: LevelSpec, locked: boolean): string {
    if (locked) return t('setup.locked');
    const best = bestTime(level.id, this.difficulty);
    return best === null ? t('setup.no-record') : t('setup.best', { time: formatTime(best) });
  }

  private stepStory(direction: number): void {
    const levels = levelsFor('story');
    this.storyIndex = Phaser.Math.Clamp(this.storyIndex + direction, 0, levels.length - 1);
    this.sync();
  }

  private start(): void {
    const queue =
      this.mode === 'story'
        ? [levelsFor('story')[this.storyIndex]!.id]
        : randomVersusQueue(this.versusCount);
    this.ref.set(new Session(this.mode, this.difficulty, this.seats, queue));
    this.onStart();
  }
}
