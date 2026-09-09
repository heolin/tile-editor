import Phaser from 'phaser';
import {
  FONT,
  PauseMenu,
  SPACE,
  TYPE,
  UiRoot,
  fixed,
  flexible,
  horizontalGroup,
  inset,
  loadImages,
  runCountdown,
  spacer,
  ui,
  uiFont,
  verticalGroupKeyed,
  type Rect,
} from '@kapsel/shared';
import { KEY_OUTLINE_KEY, ballColour, ballKey, loadTiltBallImages } from '../assets';
import { HUD_ROW } from '../constants';
import { textureKey } from '../level/tiled';
import type { LockColour } from '../level/types';
import { formatTime } from '../rules';
import { t } from '../i18n/strings';
import type { RunState } from '../run-state';
import type { Session, SessionRef } from '../session';

/**
 * Everything drawn at screen scale while the board is drawn zoomed: the clocks,
 * the level name, the keys still to find, the countdown, and the pause control.
 *
 * A scene of its own rather than a fixed layer inside the play scene, because
 * the play scene's camera is zoomed to fit the board and every HUD element
 * would inherit that zoom. It also survives a story restart, which restarts the
 * play scene under it — the state it draws lives in `RunState`, which is reset
 * per level rather than rebuilt.
 */
const BALL_ICON = 56;
const KEY_ICON = 54;
/**
 * The pause button's own size and margin, mirrored from `PauseMenu` (which does
 * not export them) so the keys can be hung under it. `BackButton` carries the
 * same 110 for the same reason — the two corner controls are size-matched.
 */
const PAUSE_BTN = 110;

export class HudScene extends Phaser.Scene {
  private title!: Phaser.GameObjects.Text;
  private pills: {
    container: Phaser.GameObjects.Container;
    icon: Phaser.GameObjects.Image;
    time: Phaser.GameObjects.Text;
  }[] = [];
  private keyIcons: { colour: LockColour; image: Phaser.GameObjects.Image }[] = [];
  private windowLabel!: Phaser.GameObjects.Text;
  private pause!: PauseMenu;

  private session!: Session;

  constructor(
    private ref: SessionRef,
    private run: RunState,
    private onExit: () => void,
  ) {
    super('Hud');
  }

  preload(): void {
    loadImages(this);
    loadTiltBallImages(this);
  }

  create(): void {
    this.session = this.ref.require();
    this.title = this.add
      .text(0, 0, '', {
        fontFamily: FONT,
        fontSize: uiFont(TYPE.label),
        color: '#e8edf7',
        fontStyle: 'bold',
      })
      .setOrigin(0, 0.5);

    this.pills = this.session.seats.map((_, seat) => {
      const icon = this.add
        .image(0, 0, ballKey(ballColour(seat), this.session.currentLevel().ballSize))
        .setDisplaySize(ui(BALL_ICON), ui(BALL_ICON));
      const time = this.add
        .text(0, 0, '0:00.0', {
          fontFamily: FONT,
          fontSize: uiFont(TYPE.label),
          color: '#ffffff',
        })
        .setOrigin(0, 0.5);
      const container = this.add.container(0, 0, [icon, time]);
      return { container, icon, time };
    });

    this.keyIcons = this.run.locksNeeded.map((colour) => ({
      colour,
      image: this.add.image(0, 0, KEY_OUTLINE_KEY).setDisplaySize(ui(KEY_ICON), ui(KEY_ICON)),
    }));

    this.windowLabel = this.add
      .text(0, 0, '', {
        fontFamily: FONT,
        fontSize: uiFont(TYPE.title),
        color: '#ff5a4d',
        fontStyle: 'bold',
        stroke: '#1b2733',
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setAlpha(0);

    // The pause control lives here, not in the play scene, because the play
    // scene's camera is zoomed and viewport-clipped — a screen-space button
    // there would land in the middle of the board. Pausing this scene is not
    // enough on its own, so the callbacks pause the board's scene too.
    this.pause = new PauseMenu(this, {
      onExit: () => {
        this.scene.stop('Play');
        this.onExit();
      },
      onPause: () => this.scene.pause('Play'),
      onResume: () => this.scene.resume('Play'),
    });
    void this.pause;

    new UiRoot(this, (screen) => this.place(screen));

    // The board is built and standing still; this is what starts the clock.
    runCountdown(this, {
      x: this.scale.width / 2,
      y: this.scale.height / 2,
      onDone: () => this.run.startRun(),
    });
  }

  /**
   * Everything lives inside the same top band the play scene reserves
   * (`HUD_ROW`) — below it is the board's camera viewport, and anything drawn
   * there would sit on top of the level.
   */
  private place(screen: Rect): void {
    const band = { x: screen.x, y: screen.y, w: screen.w, h: ui(HUD_ROW) };
    const rows = verticalGroupKeyed(
      band,
      [
        spacer(ui(SPACE.sm), ui(SPACE.xs)),
        fixed(ui(48), { key: 'title' }),
        spacer(ui(SPACE.xs)),
        flexible(1, { key: 'pills' }),
      ],
      { padding: { l: ui(SPACE.lg), r: ui(SPACE.lg) } },
    );

    // Left-aligned, so the title starts where the first clock does, and kept
    // clear of the pause button in the corner above it.
    this.title.setPosition(rows.title!.x, rows.title!.y + rows.title!.h / 2);
    this.title.setWordWrapWidth(rows.title!.w - ui(SPACE.xxl));

    // The keys hang UNDER the pause button, right-aligned to the same margin:
    // that corner is where the run's controls and state live, and the title row
    // is the level's name, which can be long.
    const step = ui(KEY_ICON + SPACE.xs);
    const keysWidth =
      this.keyIcons.length === 0 ? 0 : this.keyIcons.length * ui(KEY_ICON) + (this.keyIcons.length - 1) * ui(SPACE.xs);
    const keysY = screen.y + ui(SPACE.md + PAUSE_BTN + SPACE.xs) + ui(KEY_ICON) / 2;
    this.keyIcons.forEach((key, index) => {
      key.image.setPosition(
        screen.x + screen.w - ui(SPACE.md) - ui(KEY_ICON) / 2 - (this.keyIcons.length - 1 - index) * step,
        keysY,
      );
    });

    // The clocks give way to the keys rather than running under them. With no
    // keys the reserve is the pause button's own column, as it was before.
    const cells = horizontalGroup(
      inset(rows.pills!, { r: keysWidth === 0 ? ui(SPACE.xxl) : keysWidth + ui(SPACE.md) }),
      this.pills.map(() => flexible()),
      { spacing: ui(SPACE.sm) },
    );
    this.pills.forEach((pill, index) => {
      const cell = cells[index]!;
      pill.container.setPosition(cell.x, cell.y + cell.h / 2);
      pill.icon.setPosition(ui(BALL_ICON) / 2, 0);
      pill.time.setPosition(ui(BALL_ICON) + ui(SPACE.xs), 0);
    });

    this.windowLabel.setPosition(screen.w / 2, band.y + band.h + ui(SPACE.lg));
  }

  update(): void {
    const name = this.run.levelTitle.toUpperCase();
    this.title.setText(
      this.run.seriesLabel === null
        ? name
        : t('hud.series', { series: this.run.seriesLabel, title: name }),
    );

    this.run.seats.forEach((seat, index) => {
      const pill = this.pills[index];
      if (pill === undefined) return;
      const shown = seat.finishedAtMs ?? this.run.elapsedMs;
      pill.time.setText(formatTime(shown));
      // Finished is gold and solid, dead is dimmed, still going is white.
      if (seat.state === 'home') {
        pill.time.setColor('#f5b731');
        pill.container.setAlpha(1);
      } else if (seat.state === 'rolling' || seat.state === 'falling') {
        pill.time.setColor('#ffffff');
        pill.container.setAlpha(1);
      } else {
        pill.time.setColor('#9aa4b5');
        pill.container.setAlpha(this.session.mode === 'story' ? 0.45 : 1);
      }
    });

    for (const key of this.keyIcons) {
      const taken = this.run.locksOpened.includes(key.colour);
      key.image.setTexture(taken ? textureKey(keyArt(key.colour)) : KEY_OUTLINE_KEY);
      key.image.setDisplaySize(ui(KEY_ICON), ui(KEY_ICON));
    }

    const remaining = this.run.finishWindowMs;
    if (remaining === null || remaining <= 0) {
      this.windowLabel.setAlpha(0);
      return;
    }
    this.windowLabel.setAlpha(1).setText(String(Math.ceil(remaining / 1000)));
  }
}

function keyArt(colour: LockColour): string {
  return colour === 'yellow' ? 'key' : `key_${colour}`;
}
