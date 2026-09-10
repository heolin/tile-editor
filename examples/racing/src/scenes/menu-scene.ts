import Phaser from 'phaser';
import {
  CORNER_BUTTON,
  FONT,
  FlatButton,
  ScreenHeader,
  ScreenTitle,
  SPACE,
  SegmentedControl,
  SelectableTile,
  Stepper,
  centerOf,
  DifficultyBar,
  fitInParent,
  fixed,
  flexSpacer,
  flexible,
  generateUiTextures,
  gridGroup,
  horizontalGroup,
  loadImages,
  placeAt,
  placeStretched,
  preferred,
  spacer,
  TYPE,
  ui,
  uiFont,
  UiRoot,
  verticalGroupKeyed,
  type Difficulty,
  type Rect,
} from '@kapsel/shared';
import { RACE } from '../constants';
import { MODE_RACES, TRACK_COUNT, type RaceMode, type TrackSlot } from '../race-series';
import type { RaceSeries } from '../race-series';
import { howToPlay } from '../how-to-play';
import { milestones } from '../milestones';
import { t } from '../i18n/strings';
import { preloadTrackThumbs, trackThumbKey } from '../track/track-assets';

const RANDOM_TILE = TRACK_COUNT; // index of the random tile in the grid

const COLS = 3;
const ROWS = 2;

/**
 * Track tiles stay proportional to the canvas width, not scaled by `ui()`: the
 * canvas is always 1080 logical px wide, so this is the same fraction of the
 * screen on every device, and the grid is structurally identical everywhere.
 */
const TILE_FRACTION = 0.22;
const GAP_FRACTION = 0.22; // of the tile

// Row heights, in reference-tablet logical px — reserved space for each band of
// the stack. Intrinsic (they hold text and controls), so they go through `ui()`.
/**
 * Heading and section labels share a row height and a gap to the content below,
 * so "TRACKS -> tiles" and "MODE/LAPS -> controls" read as the same rhythm. Both
 * use the same text style, so the rows must match or the gaps look unequal even
 * when the spacers are identical.
 */
const TEXT_ROW = 64;
const HEADING_GAP = 24;
const MODE_BTN = 160;
/**
 * Clear space under the track grid, and under the Mode/Laps block.
 *
 * Both are fixed rather than flexible because on a squat screen there is no
 * surplus at all — the content overflows and every flexible track collapses to
 * zero. Anything expressed only as a `flexSpacer` therefore disappears exactly
 * where spacing matters most, which is why weighting the spacers alone changed
 * nothing there.
 */
const GRID_BOTTOM_GAP = 24;
const CONTROLS_BOTTOM_GAP = 96;
/**
 * Floor for the controls band. Its real height follows the controls themselves
 * (see `place`), because a fixed band leaves the segments and stepper floating
 * in the middle of it, far below their labels.
 */
const CONTROLS_MIN_H = 90;
const START_W = 420;
const START_H = 110;
const DIFFICULTY_ROW = 120;

/**
 * Pre-race menu: pick tracks (2×3 grid, last tile = random), race mode
 * (single / 3 / 5), and lap count, then Start. Selection is ordered — each
 * picked tile shows its race-order badge; changing mode auto-selects the first
 * N tracks. Start is disabled until exactly the required number is chosen.
 */
export class MenuScene extends Phaser.Scene {
  private tiles: SelectableTile[] = [];
  private selected: TrackSlot[] = [];
  private mode: RaceMode = 'single';
  private laps: number = RACE.DEFAULT_LAPS;
  private difficulty: Difficulty = 'easy';
  private start!: FlatButton;
  /** Everything rebuilt on each layout pass, so it can be cleared in one call. */
  private content!: Phaser.GameObjects.Container;
  private header!: ScreenHeader;
  private title!: ScreenTitle;
  private bgImage?: Phaser.GameObjects.Image;
  private bgScrim!: Phaser.GameObjects.Rectangle;

  constructor(
    private series: RaceSeries,
    private onExit: () => void,
  ) {
    super('Menu');
  }

  preload(): void {
    loadImages(this);
    preloadTrackThumbs(this);
  }

  create(): void {
    generateUiTextures(this);
    this.cameras.main.setBackgroundColor('#161c28');
    this.buildBackground();
    this.header = new ScreenHeader(this, {
      onBack: () => this.onExit(),
      howTo: howToPlay,
      milestones,
    });
    // The one pre-game screen with no room for a title band of its own: the
    // track grid and the two controls already fill a 4:3 tablet. So the name
    // goes in the corner row itself, in the gap between the three buttons —
    // `ScreenTitle` shrinks to whatever that gap is, and the layout below keeps
    // every pixel it had. Same ink as the other eight, dark backdrop or not: at
    // this size the white frame is most of the letter, so the name reads as the
    // same sticker here as on a meadow.
    this.title = new ScreenTitle(this, { text: t('setup.title') });
    this.content = this.add.container(0, 0);

    // UiRoot calls `place` now and again whenever the logical canvas changes, so
    // the layout below is written once for the whole 4:3–22:9 envelope.
    new UiRoot(this, (screen) => this.place(screen));
  }

  /**
   * Positions everything from the screen rect. Idempotent: the control layer is
   * cleared and rebuilt because the shared widgets bake their geometry at
   * construction — once they grow a `setRect`, this becomes a reposition and the
   * layout code above it stays exactly as it is.
   */
  private place(screen: Rect): void {
    const { w: width } = screen;
    this.layoutBackground(screen);
    this.header.layout(screen);
    this.title.setRect(this.titleBox(screen));

    this.content.removeAll(true);
    this.tiles = [];

    // The grid is sized from the canvas width, so it is identical at every
    // aspect; only the space around it changes.
    const tileSize = width * TILE_FRACTION;
    const tileGap = tileSize * GAP_FRACTION;
    const gridW = COLS * tileSize + (COLS - 1) * tileGap;
    const gridH = ROWS * tileSize + (ROWS - 1) * tileGap;

    // The controls band is exactly as tall as the taller of its two controls.
    // Segments are square and sized from the column width, so a fixed band would
    // leave them centred in dead space well below their label.
    const contentW = width - ui(SPACE.lg) * 2;
    const colW = (contentW - ui(SPACE.lg)) / 2;
    const segSide = (colW - ui(SPACE.md) * 2) / 3;
    const controlsH = Math.max(segSide, ui(CONTROLS_MIN_H));

    // One declaration for the whole screen, serving 1080x1440 (4:3) through
    // 1080x2400 (22:9) without being tuned for either: the flexible spacers take
    // up surplus height, and the `preferred` bands give height back when there is
    // a shortfall. The controls are `fixed` because shrinking a touch target is
    // never the right way to save space — padding and the grid yield instead.
    const rows = verticalGroupKeyed(
      screen,
      [
        spacer(ui(SPACE.xxl), ui(SPACE.md)), // clear of the back button
        preferred(ui(TEXT_ROW), { key: 'heading', min: ui(44) }),
        // Fixed, not flexible: this gap is the reference the controls gap below
        // matches, so it must not vary with the screen.
        spacer(ui(HEADING_GAP), ui(SPACE.md)),
        preferred(gridH, { key: 'grid', min: gridH * 0.55, cross: gridW, align: 'center' }),
        spacer(ui(GRID_BOTTOM_GAP), ui(SPACE.md)),
        flexSpacer(),
        preferred(ui(TEXT_ROW), { key: 'controlLabels', min: ui(44) }),
        spacer(ui(HEADING_GAP), ui(SPACE.md)),
        preferred(controlsH, { key: 'controls', min: ui(CONTROLS_MIN_H) }),
        spacer(ui(CONTROLS_BOTTOM_GAP), ui(SPACE.lg)),
        // Weighted 2:1 against the spacer above the labels, so any *surplus*
        // pools below the controls too. The fixed gap above carries the spacing
        // when there is no surplus to weight.
        flexSpacer(2),
        preferred(ui(DIFFICULTY_ROW), { key: 'difficulty', min: ui(90) }),
        spacer(ui(SPACE.lg), ui(SPACE.sm)),
        fixed(ui(START_H), { key: 'start', cross: ui(START_W), align: 'center' }),
        spacer(ui(SPACE.xl), ui(SPACE.md)),
      ],
      { padding: { l: ui(SPACE.lg), r: ui(SPACE.lg) } },
    );

    // Section titles are plain white — a dimmed caption grey read as disabled.
    const headingStyle = { fontFamily: FONT, fontSize: uiFont(TYPE.heading), color: '#ffffff' };
    const heading = this.add
      .text(0, 0, t('menu.tracks'), { ...headingStyle, fontStyle: 'bold' })
      .setOrigin(0.5);
    placeAt(heading, rows.heading!);
    this.content.add(heading);

    // ── Track grid (2 rows × 3 cols, last tile = random) ─────────────────
    // Contain-fit the grid's own aspect into whatever row height survived, then
    // derive the tile from the fitted width so tiles and gaps keep their
    // proportions as the grid shrinks.
    const gridBox = fitInParent(rows.grid!, gridW / gridH);
    const cellGap = (gridBox.w / (COLS + (COLS - 1) * GAP_FRACTION)) * GAP_FRACTION;
    const { cells } = gridGroup(gridBox, RANDOM_TILE + 1, {
      columns: COLS,
      spacing: cellGap,
      cellRatio: 1,
    });
    cells.forEach((cell, i) => {
      const isRandom = i === RANDOM_TILE;
      const at = centerOf(cell);
      const tile = new SelectableTile(this, {
        x: at.x,
        y: at.y,
        size: cell.w,
        texture: isRandom ? 'shuffle' : trackThumbKey(i),
        cropSquare: !isRandom,
        asIcon: isRandom,
        onTap: () => this.onTileTap(i),
      });
      this.tiles.push(tile);
      this.content.add(tile.container);
    });

    // ── Mode and Laps, side by side ──────────────────────────────────────
    // One band split into two columns, with a matching label row above it, so
    // the two controls read as a pair instead of stacking down the screen.
    const [modeLabelCell, lapsLabelCell] = horizontalGroup(
      rows.controlLabels!,
      [flexible(), flexible()],
      { spacing: ui(SPACE.lg) },
    );
    const [modeCell, lapsCell] = horizontalGroup(
      rows.controls!,
      [flexible(), flexible()],
      { spacing: ui(SPACE.lg) },
    );

    const modeLabel = this.add.text(0, 0, t('menu.races'), headingStyle).setOrigin(0.5);
    placeAt(modeLabel, modeLabelCell!);
    this.content.add(modeLabel);

    const lapsLabel = this.add.text(0, 0, t('menu.laps'), headingStyle).setOrigin(0.5);
    placeAt(lapsLabel, lapsLabelCell!);
    this.content.add(lapsLabel);

    const modeAt = centerOf(modeCell!);
    const segmented = new SegmentedControl<RaceMode>(this, {
      x: modeAt.x,
      y: modeAt.y,
      // Just the count: the RACES label above the row already says what it means,
      // and dropping the sublabel lets each segment be a plain square.
      options: [
        { label: '1', value: 'single' },
        { label: '3', value: '3' },
        { label: '5', value: '5' },
      ],
      value: this.mode,
      buttonWidth: MODE_BTN, // square, matching the row it is given
      buttonHeight: MODE_BTN,
      gap: SPACE.md,
      textureScale: 0.5,
      onChange: (m) => this.setMode(m),
    });
    // Segments are square: in a half-width column the band is far taller than a
    // third of its width, and stretching to fill it would give three very tall,
    // narrow buttons. Derive the height from the segment width and centre the
    // row in the column instead.
    // Clamped to the band as well as the column: the band is now sized from the
    // segment width, so these agree, but the clamp keeps it honest if either changes.
    const segFit = Math.min(segSide, modeCell!.h);
    const segRect = {
      x: modeCell!.x,
      y: modeCell!.y + (modeCell!.h - segFit) / 2,
      w: modeCell!.w,
      h: segFit,
    };
    segmented.setRect(segRect);
    this.content.add(segmented.container);

    const lapsAt = centerOf(lapsCell!);
    const stepper = new Stepper(this, {
      x: lapsAt.x,
      y: lapsAt.y,
      label: t('menu.laps'),
      // The column already has a LAPS label above it.
      showLabel: false,
      min: RACE.MIN_LAPS,
      max: RACE.MAX_LAPS,
      value: this.laps,
      spread: 150,
      labelSize: TYPE.heading,
      valueSize: TYPE.title,
      onChange: (v) => {
        this.laps = v;
      },
    });
    stepper.setRect(lapsCell!);
    this.content.add(stepper.container);

    // ── Start button ─────────────────────────────────────────────────────
    const startAt = centerOf(rows.start!);
    this.start = new FlatButton(this, startAt.x, startAt.y, {
      width: rows.start!.w,
      height: rows.start!.h,
      text: t('menu.start'),
      fontSize: TYPE.heading,
      texture: 'button-green',
      textureScale: 0.5,
      onClick: () => this.onStart(),
    });
    this.content.add(this.start.container);

    // ── Difficulty ───────────────────────────────────────────────────────
    const diffAt = centerOf(rows.difficulty!);
    const difficulty = new DifficultyBar(this, {
      x: diffAt.x,
      y: diffAt.y,
      width: rows.difficulty!.w,
      value: this.difficulty,
      label: t('menu.difficulty'),
      showValueLabel: true,
      onChange: (v) => {
        this.difficulty = v;
      },
    });
    difficulty.setRect(rows.difficulty!);
    this.content.add(difficulty.container);

    // Re-apply selection state to the freshly built tiles. On the first pass
    // `selected` is empty, so seed it from the current mode instead.
    if (this.selected.length === 0) this.setMode(this.mode);
    else this.refresh();
  }

  /** Dark square button (top-left) with the left arrow — quits to the hub. */
  /**
   * The band the name sits in: the corner row, between the back button on the
   * left and the two buttons on the right, with a gap either side. Derived from
   * the same constants `CornerButton` anchors with, so it cannot drift out from
   * under them.
   */
  private titleBox(screen: Rect): Rect {
    const corner = ui(CORNER_BUTTON);
    const gap = ui(SPACE.sm);
    const left = ui(SPACE.md) + corner + gap;
    const right = ui(SPACE.md) + corner * 2 + gap * 2;
    return { x: left, y: ui(SPACE.md), w: screen.w - left - right, h: corner };
  }

  /** Track1 image, blurred + darkened, behind the menu. */
  private buildBackground(): void {
    if (this.textures.exists('track-thumb-1')) {
      this.bgImage = this.add.image(0, 0, 'track-thumb-1').setDepth(-10).setAngle(20);
      // Blur is optional polish — the FX API isn't in every Phaser build.
      const fx = (
        this.bgImage as unknown as {
          preFX?: { addBlur: (q: number, x: number, y: number, s: number, c: number, n: number) => void };
        }
      ).preFX;
      fx?.addBlur(1, 2, 2, 1.2, 0xffffff, 6);
    }
    this.bgScrim = this.add.rectangle(0, 0, 1, 1, 0x0d1119, 0.72).setDepth(-9);
  }

  private layoutBackground(screen: Rect): void {
    if (this.bgImage !== undefined) {
      const img = this.bgImage;
      // Cover the canvas twice over, so the 20° rotation never exposes a corner.
      placeAt(img, screen);
      img.setScale(Math.max(screen.w / img.width, screen.h / img.height) * 2);
    }
    placeStretched(this.bgScrim, screen);
  }

  private slotEquals(a: TrackSlot, b: TrackSlot): boolean {
    if (a.kind === 'random' && b.kind === 'random') return true;
    return a.kind === 'track' && b.kind === 'track' && a.id === b.id;
  }

  private tileSlot(i: number): TrackSlot {
    return i === RANDOM_TILE ? { kind: 'random' } : { kind: 'track', id: i };
  }

  private required(): number {
    return MODE_RACES[this.mode];
  }

  private onTileTap(i: number): void {
    const slot = this.tileSlot(i);
    const idx = this.selected.findIndex((s) => this.slotEquals(s, slot));
    if (idx >= 0) {
      this.selected.splice(idx, 1); // toggle off
    } else if (this.selected.length < this.required()) {
      this.selected.push(slot);
    } else {
      // Already at the required count — replace the last-picked track.
      this.selected[this.selected.length - 1] = slot;
    }
    this.refresh();
  }

  private setMode(mode: RaceMode): void {
    this.mode = mode;
    const n = this.required();
    // Auto-select the first N concrete tracks in order.
    this.selected = Array.from({ length: Math.min(n, TRACK_COUNT) }, (_, i) => ({
      kind: 'track' as const,
      id: i,
    }));
    this.refresh();
  }

  private refresh(): void {
    for (let i = 0; i <= RANDOM_TILE; i++) {
      const slot = this.tileSlot(i);
      const pos = this.selected.findIndex((s) => this.slotEquals(s, slot));
      this.tiles[i].setSelected(pos >= 0);
      this.tiles[i].setBadge(pos >= 0 ? String(pos + 1) : null);
    }
    this.start?.setEnabled(this.selected.length === this.required());
  }

  private onStart(): void {
    this.series.configure({
      orderedTracks: this.selected,
      laps: this.laps,
      mode: this.mode,
      difficulty: this.difficulty,
    });
    this.series.resetStandings();
    this.scene.start('Ready');
    void this.onExit;
  }
}
