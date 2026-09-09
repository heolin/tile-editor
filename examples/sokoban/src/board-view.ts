import Phaser from 'phaser';
import type { Rect } from '@kapsel/shared';
import {
  COIN_KEY,
  crateDoneKey,
  crateKey,
  crateSunkKey,
  playerColour,
  playerKey,
  type PlayerColour,
} from './assets';
import type { BoardState, Crate, Direction, StepResult } from './board';
import { BOARD, CELL, FRAME } from './constants';
import { cellIndex, type LevelSpec } from './level/types';

const FRAME_TEXTURE = 'sk-frame';

/**
 * The frame's art, generated once per texture manager: a rounded rectangle
 * stroked in the outermost band of a square, stretched by the nine-slice.
 *
 * Drawn rather than shipped because it is a stroke and a radius, and a PNG of
 * it would be a file nobody could tune. `Graphics` is used only to bake the
 * texture and destroyed immediately — nothing here draws with it per frame.
 */
function frameTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(FRAME_TEXTURE)) return FRAME_TEXTURE;
  const size = FRAME.textureSize;
  const t = FRAME.thickness;
  const graphics = scene.make.graphics({ x: 0, y: 0 }, false);
  graphics.lineStyle(t, FRAME.color, 1);
  graphics.strokeRoundedRect(t / 2, t / 2, size - t, size - t, FRAME.cornerRadius);
  graphics.generateTexture(FRAME_TEXTURE, size, size);
  graphics.destroy();
  return FRAME_TEXTURE;
}

/**
 * The board on screen: what a move LOOKS like. The rules live in `board.ts` and
 * this never decides anything — it is handed a state and told what changed.
 *
 * Built once at native size (128 px cells) inside one container, then scaled to
 * fit. Nothing here is rebuilt on a resize; `place` moves and scales the
 * container and that is the whole layout pass.
 *
 * The projection is `CELL`: ground squashed into 128x96, standing pieces at
 * their full 128 px anchored to the bottom of their cell, drawn in row order so
 * the lower one covers the one behind it.
 */
export class BoardView {
  readonly root: Phaser.GameObjects.Container;
  /** Native size, before `place` scales it. */
  readonly nativeWidth: number;
  readonly nativeHeight: number;

  /** The ground plane: floor, goal markers, pits, and crates that fell in. */
  private ground: Phaser.GameObjects.Container;
  /** Everything that stands up. Sorted by row on every move. */
  private standing: Phaser.GameObjects.Container;

  /**
   * Every tween this view has started and that has not finished.
   *
   * Kept so `destroy` can stop them. A tween outlives the pictures it moves:
   * destroying a game object does not cancel the tween's completion handler,
   * and that handler reaches for `actor.image` out of a closure, so it crashes
   * on a board that has been thrown away. Resetting mid-step did exactly that.
   *
   * The crash is the loud half. The quiet half is `onDone`, which clears the
   * seat's "busy" flag — fired late, it clears it on the NEW board, and that
   * seat's next move goes in while the previous one is still animating.
   */
  private running = new Set<Phaser.Tweens.Tween>();

  private crateImages = new Map<number, Phaser.GameObjects.Image>();
  private coinImages = new Map<number, Phaser.GameObjects.Image>();
  /**
   * One per seat, in seat order: the picture, which way it is looking, and
   * which of the two step frames comes next. Each is its own because in co-op
   * the two walk independently.
   */
  private cast: {
    colour: PlayerColour;
    image: Phaser.GameObjects.Image;
    facing: Direction;
    /** Alternates 2, 3, 2, 3 — one step frame per move. See `assets.playerKey`. */
    stepFrame: 2 | 3;
  }[] = [];

  constructor(
    private scene: Phaser.Scene,
    private state: BoardState,
  ) {
    const level = state.level;
    this.nativeWidth = level.width * CELL.width;
    this.nativeHeight = level.height * CELL.height + CELL.rise;

    this.root = scene.add.container(0, 0);
    this.ground = scene.add.container(0, 0);
    this.standing = scene.add.container(0, 0);
    this.root.add([this.ground, this.standing]);

    this.buildGround(level);
    this.buildWalls(level);
    for (const crate of state.crates) this.addCrate(crate);
    for (const index of state.coins) this.addCoin(level, index);

    for (const player of state.players) {
      const colour = playerColour(player.seat);
      const image = scene.add
        .image(0, 0, playerKey(colour, 'down', 1))
        .setOrigin(0.5, 1)
        .setDisplaySize(CELL.art, CELL.art);
      this.standing.add(image);
      this.moveStanding(image, player.x, player.y);
      this.cast.push({ colour, image, facing: 'down', stepFrame: 2 });
    }
    this.sort();

    this.buildFrame();
  }

  /**
   * The white picture frame, drawn `FRAME.thickness` outside the board on every
   * side. The generated texture puts its stroke in that outermost band, so the
   * frame's inner edge lands on the board's boundary and covers no floor.
   *
   * Added last so it draws over the board, and inside `root` so it scales with
   * it. `place` fits the framed size, not the board's, or the frame would be
   * the part that lands off the screen.
   */
  private buildFrame(): void {
    const t = FRAME.thickness;
    const inset = FRAME.textureSize / 2 - 1;
    const frame = this.scene.add
      .nineslice(
        this.nativeWidth / 2,
        this.nativeHeight / 2,
        frameTexture(this.scene),
        undefined,
        this.nativeWidth + t * 2,
        this.nativeHeight + t * 2,
        // The insets MUST be passed here, not left to `setSlices`: a nine-slice
        // decides `is3Slice` in its constructor and never clears it, and a
        // 3-slice silently ignores its height.
        inset,
        inset,
        inset,
        inset,
      )
      .setOrigin(0.5);
    this.root.add(frame);
  }

  /**
   * Ground-plane placement: the cell, squashed.
   *
   * The TOP row is the exception. Above it lies the band the standing pieces of
   * row 0 reach up into, and with nothing drawn there the board opens with a
   * dark notch along its top edge. So row 0's floor is drawn the full height of
   * the art and reaches the top edge instead. Only the floor stretches — the
   * markers on it keep their cell, because they are things lying on the ground
   * rather than the ground itself.
   */
  private placeGround(image: Phaser.GameObjects.Image, x: number, y: number, floor = false): void {
    const top = floor && y === 0;
    image.setOrigin(0, 0).setDisplaySize(CELL.width, top ? CELL.height + CELL.rise : CELL.height);
    image.setPosition(x * CELL.width, top ? 0 : y * CELL.height + CELL.rise);
  }

  /** Standing placement: full height, bottom edge on the cell's bottom edge. */
  private moveStanding(image: Phaser.GameObjects.Image, x: number, y: number): void {
    image.setPosition(x * CELL.width + CELL.width / 2, (y + 1) * CELL.height + CELL.rise);
    image.setDepth(y);
  }

  private buildGround(level: LevelSpec): void {
    for (let index = 0; index < level.floor.length; index++) {
      const key = level.floor[index];
      if (key === undefined) continue;
      const image = this.scene.add.image(0, 0, key);
      this.placeGround(image, index % level.width, Math.floor(index / level.width), true);
      this.ground.add(image);
    }
    for (let index = 0; index < level.features.length; index++) {
      const feature = level.features[index];
      if (feature === undefined) continue;
      const image = this.scene.add.image(0, 0, feature.key);
      this.placeGround(image, index % level.width, Math.floor(index / level.width));
      this.ground.add(image);
    }
  }

  private buildWalls(level: LevelSpec): void {
    for (let index = 0; index < level.walls.length; index++) {
      const key = level.walls[index];
      if (key === undefined) continue;
      const image = this.scene.add.image(0, 0, key).setOrigin(0.5, 1).setDisplaySize(CELL.art, CELL.art);
      this.moveStanding(image, index % level.width, Math.floor(index / level.width));
      this.standing.add(image);
    }
  }

  private addCrate(crate: Crate): void {
    const image = this.scene.add
      .image(0, 0, crateKey(crate.colour))
      .setOrigin(0.5, 1)
      .setDisplaySize(CELL.art, CELL.art);
    this.standing.add(image);
    this.crateImages.set(crate.id, image);
    this.moveStanding(image, crate.x, crate.y);
    // A board can START with a crate already on its mark — the imported ones
    // often do — so the face is chosen here and not only after a move.
    this.dressCrate(crate);
  }

  private addCoin(level: LevelSpec, index: number): void {
    const image = this.scene.add.image(0, 0, COIN_KEY).setOrigin(0.5, 1).setDisplaySize(CELL.art, CELL.art);
    this.standing.add(image);
    this.coinImages.set(index, image);
    this.moveStanding(image, index % level.width, Math.floor(index / level.width));
  }

  /**
   * Row order, so a piece one row down covers the one behind it. Phaser sorts a
   * container's children by a property on demand; the depth of a piece is
   * simply its row, and only a move can change it.
   */
  private sort(): void {
    this.standing.sort('depth');
  }

  /**
   * Which face a crate shows: the marked one when it is standing where it
   * belongs, the sunk one when it is in a pit — and a sunk crate leaves the
   * standing pieces for the ground plane it has become.
   */
  private dressCrate(crate: Crate): void {
    const image = this.crateImages.get(crate.id);
    if (image === undefined) throw new Error(`sokoban: crate ${crate.id} has no image`);
    if (crate.sunk) {
      image.setTexture(crateSunkKey(crate.colour));
      this.standing.remove(image);
      this.ground.add(image);
      this.placeGround(image, crate.x, crate.y);
      return;
    }
    const feature = this.state.level.features[cellIndex(this.state.level, crate.x, crate.y)];
    const home = feature?.colour === crate.colour && !feature.pit;
    image.setTexture(home ? crateDoneKey(crate.colour) : crateKey(crate.colour));
  }

  /** Put every piece where the state says it is, with no animation. */
  refresh(): void {
    for (const crate of this.state.crates) {
      const image = this.crateImages.get(crate.id);
      if (image === undefined) throw new Error(`sokoban: crate ${crate.id} has no image`);
      // A crate that was sunk and has been undone or reset has to come back out
      // of the ground plane it joined.
      if (!crate.sunk && this.ground.exists(image)) {
        this.ground.remove(image);
        this.standing.add(image);
        image.setOrigin(0.5, 1).setDisplaySize(CELL.art, CELL.art);
      }
      if (crate.sunk) {
        this.dressCrate(crate);
      } else {
        this.moveStanding(image, crate.x, crate.y);
        this.dressCrate(crate);
      }
    }
    for (const [index, image] of this.coinImages) {
      image.setVisible(this.state.coins.includes(index));
    }
    for (const player of this.state.players) {
      const actor = this.actor(player.seat);
      actor.facing = 'down';
      actor.image.setTexture(playerKey(actor.colour, 'down', 1));
      this.moveStanding(actor.image, player.x, player.y);
    }
    this.sort();
  }

  private actor(seat: number): BoardView['cast'][number] {
    const actor = this.cast[seat];
    if (actor === undefined) throw new Error(`sokoban: no picture for seat ${seat}`);
    return actor;
  }

  /** Turn on the spot. Costs no move, so it is not part of a step. */
  face(seat: number, direction: Direction): void {
    const actor = this.actor(seat);
    actor.facing = direction;
    actor.image.setTexture(playerKey(actor.colour, direction, 1));
  }

  /**
   * Animate one step. `onDone` fires when the tween ends, which is when the
   * next move may be taken — a step is short enough that queueing one behind it
   * would feel like input lag rather than a queue.
   */
  play(result: StepResult, onDone: () => void): void {
    const actor = this.actor(result.seat);
    actor.facing = result.direction;
    actor.stepFrame = actor.stepFrame === 2 ? 3 : 2;
    actor.image.setTexture(playerKey(actor.colour, actor.facing, actor.stepFrame));
    actor.image.setDepth(result.to.y);

    const targets: Phaser.GameObjects.Image[] = [actor.image];
    const ends: { x: number; y: number }[] = [
      {
        x: result.to.x * CELL.width + CELL.width / 2,
        y: (result.to.y + 1) * CELL.height + CELL.rise,
      },
    ];

    const pushed = result.pushed;
    if (pushed !== undefined) {
      const image = this.crateImages.get(pushed.id);
      if (image === undefined) throw new Error(`sokoban: crate ${pushed.id} has no image`);
      image.setDepth(pushed.to.y);
      targets.push(image);
      ends.push({
        x: pushed.to.x * CELL.width + CELL.width / 2,
        y: (pushed.to.y + 1) * CELL.height + CELL.rise,
      });
    }
    this.sort();

    if (result.coin !== undefined) {
      const image = this.coinImages.get(cellIndex(this.state.level, result.coin.x, result.coin.y));
      if (image === undefined) throw new Error('sokoban: a coin was taken from a cell with no coin');
      this.track(
        this.scene.tweens.add({
          targets: image,
          y: image.y - CELL.height * 0.6,
          alpha: 0,
          duration: BOARD.stepMs * 3,
          onComplete: () => image.setVisible(false).setAlpha(1).setY(image.y + CELL.height * 0.6),
        }),
      );
    }

    this.track(
      this.scene.tweens.add({
        targets,
        // Both pieces travel the same distance in the same time, so one tween
        // with two targets would need one destination. `getEnd` gives each its
        // own.
        x: { getEnd: (_t: object, _k: string, _v: number, index: number) => ends[index]!.x },
        y: { getEnd: (_t: object, _k: string, _v: number, index: number) => ends[index]!.y },
        duration: BOARD.stepMs,
        ease: 'Linear',
        onComplete: () => {
          actor.image.setTexture(playerKey(actor.colour, actor.facing, 1));
          for (const crate of this.state.crates) this.dressCrate(crate);
          this.sort();
          onDone();
        },
      }),
    );
  }

  /** Remember a tween until it finishes, so `destroy` can stop it. */
  private track(tween: Phaser.Tweens.Tween): void {
    this.running.add(tween);
    tween.on(Phaser.Tweens.Events.TWEEN_COMPLETE, () => this.running.delete(tween));
  }

  /**
   * Scale the whole board into `rect`, centred.
   *
   * It may go above 1:1 — a six-cell puzzle on a tall phone should fill the
   * screen rather than sit small in the middle of it, and the art is 128 px a
   * cell, which is more than any of these boards needs at 1:1.
   */
  place(rect: Rect): void {
    // The frame sticks out on every side, so what has to fit is the board plus
    // twice its thickness — fitting the board alone puts the frame off-screen.
    const framed = {
      w: this.nativeWidth + FRAME.thickness * 2,
      h: this.nativeHeight + FRAME.thickness * 2,
    };
    const scale = Math.min(rect.w / framed.w, rect.h / framed.h);
    this.root.setScale(scale);
    // `root`'s origin is the board's top-left corner, which is one frame
    // thickness inside the fitted box.
    this.root.setPosition(
      rect.x + (rect.w - framed.w * scale) / 2 + FRAME.thickness * scale,
      rect.y + (rect.h - framed.h * scale) / 2 + FRAME.thickness * scale,
    );
  }

  destroy(): void {
    // Before the pictures go, or their completion handlers run against a board
    // that no longer exists.
    for (const tween of this.running) tween.remove();
    this.running.clear();
    this.root.destroy(true);
  }
}
