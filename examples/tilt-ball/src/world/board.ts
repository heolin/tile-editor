import Phaser from 'phaser';
import { sfx } from '@kapsel/shared';
import blockBodies from '../assets/block-bodies.json';
import {
  BLOCK_SLICE,
  BOUNCE,
  CAPTURE_FRACTION,
  DEPTH,
  FRAME,
  HOLE_RADIUS,
  KEY_GRAB_PAD,
  LASER,
  OBSTACLE,
  RAIL,
  ROTATOR,
  SWITCH,
  VOID,
  WALL,
} from '../constants';
import { initialLaserState, resolveBeams, switchPlate } from '../level/lasers';
import { distanceToShape, killReach, obstacleShapeAt, otherFrame } from '../level/obstacles';
import {
  advanceOnPath,
  pointOnPath,
  projectOnPath,
  resolveRails,
  type RailPath,
  type RailRider,
} from '../level/rails';
import { textureKey } from '../level/tiled';
import type { LaserColour, LevelSpec, LockColour, PlacedElement } from '../level/types';
import { buildVoidGrid, voidAt, voidCorners, type VoidGrid } from '../level/voids';

/**
 * The board: every static thing a level puts on the screen, built once from a
 * `LevelSpec`.
 *
 * Walls are Matter bodies with a separate sprite that never moves (except the
 * rotators, which move both together) — the same two-object arrangement Merge
 * Zoo uses, and for the same reason: `matter.add.gameObject` overwrites a
 * sprite's origin from the body's centre of mass, which is wrong for every
 * shape whose centre of mass is not its middle. The corner blocks are exactly
 * that shape.
 *
 * Holes, keys and beams have NO bodies. They are proximity tests run in the
 * play scene's update against the ball centres — a sensor body would give us
 * collision events we would then have to filter by distance anyway, because a
 * hole must swallow a ball that is over its middle, not one that touched its
 * rim.
 */

/** Matter collision categories. Balls collide with walls and with each other. */
export const CAT = { BALL: 0x0001, WALL: 0x0002 } as const;

const BLOCK_HULLS = (blockBodies as { blocks: Record<string, { size: number[]; hull: number[][] }> })
  .blocks;

interface Wall {
  body: MatterJS.BodyType;
  /** A nine-slice when the level stretched it; see `placeBlockArt`. */
  sprite: Phaser.GameObjects.Image | Phaser.GameObjects.NineSlice;
  lock?: LockColour;
  /**
   * The sprite's scale as laid out, which is NOT 1 — the art is drawn at
   * whatever size the level asked for via `setDisplaySize`. The recoil animation
   * swells from here and comes back to here.
   */
  baseScaleX: number;
  baseScaleY: number;
}

interface Rotator {
  wall: Wall;
  /** Seconds between the START of one 90° turn and the start of the next. */
  periodS: number;
  /** Counts up to `periodS`, then a turn is fired. */
  waitedS: number;
  turning: boolean;
}

export interface Hole {
  x: number;
  y: number;
  /** Visible radius of the pit, source px. */
  radius: number;
  /** Only the large ball fits. */
  large: boolean;
  goal: boolean;
  lock?: LockColour;
  locked: boolean;
  sprite: Phaser.GameObjects.Image;
}

export interface KeyPickup {
  x: number;
  y: number;
  /** Half the art's short side — the reach a ball has to close to take it. */
  radius: number;
  colour: LockColour;
  sprite: Phaser.GameObjects.Image;
  taken: boolean;
}

export interface Beam {
  colour: LaserColour;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  sprite: Phaser.GameObjects.Image;
}

/** A spike strip or a saw: where it is now, and what it is doing. */
interface Obstacle {
  element: PlacedElement;
  sprite: Phaser.GameObjects.Image;
  /** Its centre now — the same as the element's unless it rides a rail. */
  x: number;
  y: number;
  /** The two texture keys of an animated one, in order. */
  frames?: [string, string];
  frameAgeMs: number;
  frame: number;
  rider?: { path: RailPath; speedPxS: number; at: RailRider };
}

/** A lever on the board, and the last time a ball threw it. */
interface Switch {
  body: MatterJS.BodyType;
  sprite: Phaser.GameObjects.Image;
  colour: LaserColour;
  lastThrownAt: number;
}

export class Board {
  /**
   * Where every ball begins. Exactly ONE per level, by rule: all four players
   * start from the same point, spread around it in a ring by the play scene.
   * A level with two of them would be starting some players nearer the goal
   * than others, which is not a thing this game does.
   */
  start!: { x: number; y: number };
  readonly holes: Hole[] = [];
  readonly keys: KeyPickup[] = [];
  readonly beams: Beam[] = [];

  private obstacles: Obstacle[] = [];
  /** The tracks, by `railId`, resolved before anything is placed on them. */
  private rails = new Map<number, RailPath>();
  private switches: Switch[] = [];
  /** Which colours are lit. A beam not in here has no laser on this board. */
  private lasersOn = new Map<LaserColour, boolean>();
  private walls: Wall[] = [];
  private rotators: Rotator[] = [];
  /** The bouncy blocks by body id, so a hit can find the one it hit. */
  private bouncyWalls = new Map<number, Wall>();
  private background!: Phaser.GameObjects.TileSprite;
  /** Only a `wall`-edged board has one; an open board's floor just stops. */
  private frame?: Phaser.GameObjects.NineSlice;
  private voidGrid!: VoidGrid;

  constructor(
    private scene: Phaser.Scene,
    readonly level: LevelSpec,
  ) {
    this.buildBackground();
    // Built first: it validates the void tiles, and a board with a void off the
    // grid should say so before anything is drawn.
    this.voidGrid = buildVoidGrid(level);
    // Before the place loop, because a saw is placed ON a rail and has to be
    // able to ask where its track goes.
    this.rails = resolveRails(level.id, level.elements);
    if (level.edges === 'wall') this.buildFrame();
    for (const element of level.elements) this.place(element);
    // After the loop: a beam is two objects, so it can only be built once the
    // whole element list has been seen. The void's corners are the same — they
    // are a property of the finished grid, not of any one tile.
    this.buildLasers();
    this.buildVoidCorners();

    const starts = level.elements.filter((element) => element.def.kind === 'start');
    if (starts.length !== 1) {
      throw new Error(`tilt-ball: level ${level.id} has ${starts.length} starts — a level has exactly one`);
    }
    this.start = { x: starts[0]!.x, y: starts[0]!.y };
    if (!this.holes.some((hole) => hole.goal)) {
      throw new Error(`tilt-ball: level ${level.id} has no goal`);
    }
  }

  // ── construction ───────────────────────────────────────────────────────

  private buildBackground(): void {
    this.background = this.scene.add
      .tileSprite(0, 0, this.level.widthPx, this.level.heightPx, this.level.backgroundKey)
      .setOrigin(0, 0)
      .setDepth(DEPTH.background);
  }

  /**
   * The outer wall: a generated white rounded frame sitting entirely OUTSIDE
   * the board, like a picture frame, plus four static rectangles occupying
   * exactly the same band.
   *
   * The nine-slice is drawn `thickness` larger than the board on every side and
   * the generated texture puts its stroke in that outermost band, so the frame's
   * inner edge lands on the boundary and covers none of the floor. The colliders
   * sit in the same band, which is what makes the wall the picture of itself.
   */
  private buildFrame(): void {
    const { widthPx: w, heightPx: h } = this.level;
    const t = FRAME.thickness;

    this.frame = this.scene.add
      .nineslice(
        w / 2,
        h / 2,
        frameTexture(this.scene),
        undefined,
        w + t * 2,
        h + t * 2,
        FRAME.textureSize / 2 - 1,
        FRAME.textureSize / 2 - 1,
        FRAME.textureSize / 2 - 1,
        FRAME.textureSize / 2 - 1,
      )
      .setOrigin(0.5)
      .setDepth(DEPTH.frame);

    const opts = {
      isStatic: true,
      restitution: WALL.restitution,
      friction: WALL.friction,
      collisionFilter: { category: CAT.WALL, mask: CAT.BALL, group: 0 },
    };
    const add = (x: number, y: number, rw: number, rh: number): void => {
      const body = this.scene.matter.bodies.rectangle(x, y, rw, rh, opts);
      this.scene.matter.world.add(body);
    };
    add(w / 2, -t / 2, w + t * 2, t);
    add(w / 2, h + t / 2, w + t * 2, t);
    add(-t / 2, h / 2, t, h + t * 2);
    add(w + t / 2, h / 2, t, h + t * 2);
  }

  private place(element: PlacedElement): void {
    switch (element.def.kind) {
      case 'start':
        this.placeSprite(element, DEPTH.hole);
        return;
      case 'hole':
      case 'goal':
        this.placeHole(element);
        return;
      case 'key':
        this.placeKey(element);
        return;
      case 'laser-start':
      case 'laser-end':
        // Both ends are drawn and made solid by `buildLasers`, which needs the
        // whole element list to pair them up.
        return;
      case 'void':
        this.placeVoid(element);
        return;
      case 'switch':
        this.placeSwitch(element);
        return;
      case 'decor':
      case 'rail':
        // Scenery, and the track a saw rides. Neither is solid, neither is
        // deadly, and the rail's shape is worked out by `resolveRails` from the
        // same objects — here they are only pictures on the floor.
        this.placeSprite(element, element.def.kind === 'rail' ? DEPTH.rail : DEPTH.decor);
        return;
      case 'obstacle':
        this.placeObstacle(element);
        return;
      case 'block':
        this.placeBlock(element);
        return;
      default: {
        // Exhaustive: a new kind in the tileset must be handled here, not
        // silently dropped onto the floor of a level nobody can finish.
        const kind: never = element.def.kind;
        throw new Error(`tilt-ball: unhandled element kind '${String(kind)}'`);
      }
    }
  }

  private placeSprite(element: PlacedElement, depth: number): Phaser.GameObjects.Image {
    return this.scene.add
      .image(element.x, element.y, element.def.key)
      .setDisplaySize(element.width, element.height)
      .setRotation(Phaser.Math.DegToRad(element.rotationDeg))
      .setFlip(element.flipH, element.flipV)
      .setDepth(depth);
  }

  private placeHole(element: PlacedElement): void {
    const sprite = this.placeSprite(element, DEPTH.hole);
    // The art's pit is smaller than its plate, and a level may scale the object,
    // so the radius is the authored pit scaled by however the art was drawn.
    const scale = element.width / element.def.width;
    this.holes.push({
      x: element.x,
      y: element.y,
      radius: (element.def.large ? HOLE_RADIUS.large : HOLE_RADIUS.small) * scale,
      large: element.def.large,
      goal: element.def.kind === 'goal',
      lock: element.def.lock,
      locked: element.def.kind === 'goal' && element.def.lock !== undefined,
      sprite,
    });
  }

  private placeKey(element: PlacedElement): void {
    if (element.def.lock === undefined) {
      throw new Error(`tilt-ball: key art ${element.def.name} carries no lock colour`);
    }
    const sprite = this.placeSprite(element, DEPTH.key);
    // A key is the one thing on the board that is not part of the scenery, so
    // it gets a slow bob to say so.
    this.scene.tweens.add({
      targets: sprite,
      scale: sprite.scale * 1.12,
      duration: 620,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    this.keys.push({
      x: element.x,
      y: element.y,
      radius: Math.min(element.width, element.height) / 2,
      colour: element.def.lock,
      sprite,
      taken: false,
    });
  }

  /**
   * One rectangle of missing floor. No body: a ball does not bounce off the
   * absence of a floor, it falls into it — which the play scene tests for
   * against `isVoidAt`, the same way it tests for a hole.
   *
   * Drawn a pixel oversize on every side (see `VOID.bleedPx`), so two voids
   * sharing an edge cannot show a hairline of floor between them.
   */
  private placeVoid(element: PlacedElement): void {
    this.scene.add
      .image(element.x, element.y, element.def.key)
      .setDisplaySize(element.width + VOID.bleedPx * 2, element.height + VOID.bleedPx * 2)
      .setDepth(DEPTH.void);
  }

  /**
   * A spike strip or a saw: a picture, a killing shape, and — for the two saws
   * — a second frame and possibly a rail to ride.
   *
   * No body, deliberately. An obstacle is a distance test against the ball
   * centres in `obstacleUnder`, the same arrangement the beams use, because
   * touching one is death and there is nothing to bounce off.
   */
  private placeObstacle(element: PlacedElement): void {
    const sprite = this.placeSprite(element, DEPTH.obstacle);
    const frames = otherFrame(element.def.name);
    if (frames !== undefined && !this.scene.textures.exists(textureKey(frames))) {
      // The second frame is found by name rather than placed, so a missing one
      // would otherwise be a saw that draws Phaser's missing-texture square
      // every other 90 ms.
      throw new Error(
        `tilt-ball: obstacle '${element.def.name}' has no second frame — expected art named ${frames}`,
      );
    }
    const obstacle: Obstacle = {
      element,
      sprite,
      x: element.x,
      y: element.y,
      frames: frames === undefined ? undefined : [element.def.key, textureKey(frames)],
      frameAgeMs: 0,
      frame: 0,
    };

    if (element.railId !== undefined) {
      const path = this.rails.get(element.railId);
      if (path === undefined) {
        throw new Error(
          `tilt-ball: level ${this.level.id} has a saw at (${element.x}, ${element.y}) on rail ` +
            `${element.railId}, and there is no rail with that id`,
        );
      }
      // A saw starts where the author put it, so its position is projected onto
      // the track rather than snapped to one end. Too far off and that is a
      // misplacement, not something to guess at.
      const at = projectOnPath(path, element.x, element.y);
      if (at.awayPx > RAIL.mountTolerancePx) {
        throw new Error(
          `tilt-ball: level ${this.level.id} has a saw at (${element.x}, ${element.y}) sitting ` +
            `${at.awayPx.toFixed(0)}px off rail ${element.railId} — put it on the track`,
        );
      }
      obstacle.rider = {
        path,
        speedPxS: element.speedPxS ?? RAIL.defaultSpeedPxS,
        at: { distance: at.distance, forward: element.direction !== 'backward' },
      };
      const start = pointOnPath(path, at.distance);
      obstacle.x = start.x;
      obstacle.y = start.y;
      sprite.setPosition(start.x, start.y);
    }

    this.obstacles.push(obstacle);
  }

  /**
   * The rounded corners of the floor. Where two void cells meet at a corner,
   * a black quarter is laid over the floor cell's corner to cut it back — the
   * same black as the void tiles, so the two read as one shape.
   *
   * One texture, four rotations, so this stays a single batch however many
   * corners a board has.
   */
  private buildVoidCorners(): void {
    const r = VOID.cornerRadius;
    for (const corner of voidCorners(this.voidGrid)) {
      // The patch fills the quarter of the cell nearest that corner, so its
      // centre sits half a radius inward along both axes.
      this.scene.add
        .image(corner.x - (corner.dx * r) / 2, corner.y - (corner.dy * r) / 2, cornerTexture(this.scene))
        .setDisplaySize(r, r)
        .setRotation(cornerAngle(corner.dx, corner.dy))
        .setDepth(DEPTH.void);
    }
  }

  /**
   * Every laser on the board, from the pairs `resolveBeams` worked out: the two
   * emitters as art and as solid boxes, and the beam between them.
   *
   * The receiving end is drawn facing back down the beam whatever rotation it
   * was saved with — one less thing an author has to get right, and there is
   * nothing else its rotation could mean.
   */
  private buildLasers(): void {
    const resolved = resolveBeams(this.level.id, this.level.elements);
    for (const beam of resolved) {
      this.placeSprite(beam.start, DEPTH.laser);
      this.scene.add
        .image(beam.end.x, beam.end.y, beam.end.def.key)
        .setDisplaySize(beam.end.width, beam.end.height)
        .setRotation(beam.angleRad + Math.PI)
        .setDepth(DEPTH.laser);

      // Both ends are solid. They are furniture bolted to the board, and a ball
      // rolling through one reads as a hole in the level. Plain rectangles
      // rather than baked hulls: `tools/ball-bodies` traces `blocks/` only, and
      // this art is a rounded box with no shape worth tracing.
      this.addEmitterBody(beam.start, beam.angleRad);
      this.addEmitterBody(beam.end, beam.angleRad);

      // A plain stretched image: the beam art is a uniform strip, every row the
      // same, so there are no caps to smear and nothing for a nine-slice to do.
      const sprite = this.scene.add
        .image((beam.x1 + beam.x2) / 2, (beam.y1 + beam.y2) / 2, textureKey(`laser_${beam.colour}`))
        // The whole tile is drawn, so it has to be scaled by the ratio between
        // it and the strip inside it — ask for 36 px of tile and you get a
        // 9 px beam.
        .setDisplaySize((LASER.widthPx * LASER.artTilePx) / LASER.artStripPx, beam.lengthPx)
        .setRotation(beam.angleRad)
        .setDepth(DEPTH.laser);
      this.scene.tweens.add({
        targets: sprite,
        alpha: 0.72,
        duration: 140,
        yoyo: true,
        repeat: -1,
      });

      this.beams.push({
        colour: beam.colour,
        x1: beam.x1,
        y1: beam.y1,
        x2: beam.x2,
        y2: beam.y2,
        sprite,
      });
    }

    // The levers decide which of them are lit, and they may say "off".
    this.lasersOn = initialLaserState(this.level.id, this.level.elements, resolved);
    for (const beam of this.beams) beam.sprite.setVisible(this.isLaserOn(beam.colour));
  }

  /**
   * A lever. Solid, so the ball hits something when it throws it — but only the
   * PLATE is solid: the handle sticks out of the tile diagonally and is not a
   * thing to bounce off. The plate sits low in the art, so the body is offset
   * along the object's own axis and turns with it.
   */
  private placeSwitch(element: PlacedElement): void {
    const colour = element.laserColour;
    if (colour === undefined) {
      throw new Error(`tilt-ball: switch art ${element.def.name} carries no laser colour`);
    }
    const sprite = this.placeSprite(element, DEPTH.block);

    const plate = switchPlate(element);
    const body = this.scene.matter.bodies.rectangle(plate.cx, plate.cy, plate.width, plate.height, {
      isStatic: true,
      angle: plate.angle,
      restitution: WALL.restitution,
      friction: WALL.friction,
      collisionFilter: { category: CAT.WALL, mask: CAT.BALL, group: 0 },
    });
    this.scene.matter.world.add(body);
    this.switches.push({ body, sprite, colour, lastThrownAt: -SWITCH.retriggerMs });
  }

  /** A static box for one laser emitter, turned with the beam. */
  private addEmitterBody(element: PlacedElement, angle: number): void {
    const body = this.scene.matter.bodies.rectangle(element.x, element.y, element.width, element.height, {
      isStatic: true,
      angle,
      restitution: WALL.restitution,
      friction: WALL.friction,
      collisionFilter: { category: CAT.WALL, mask: CAT.BALL, group: 0 },
    });
    this.scene.matter.world.add(body);
  }

  /**
   * A block's picture: a plain image at its own size, and a **nine-slice** when
   * the level stretched it, so the rounded corners and rivets stay the size
   * they were drawn instead of smearing along the stretch.
   *
   * Insets go in the CONSTRUCTOR and all four are non-zero, both of which
   * matter: a nine-slice built with a zero top and bottom silently becomes a
   * 3-slice whose height cannot be set at all.
   *
   * Two things this deliberately does not do. The corner blocks are triangles
   * and there is nothing to slice, so they stay images. And a nine-slice has no
   * Flip component in Phaser, so `flipH`/`flipV` are dropped here — every
   * rectangular block in this set is symmetric on both axes, so the picture is
   * identical either way, and the COLLIDER still mirrors properly.
   */
  private placeBlockArt(element: PlacedElement): Phaser.GameObjects.Image | Phaser.GameObjects.NineSlice {
    const stretched =
      element.width !== element.def.width || element.height !== element.def.height;
    if (!stretched || element.def.name.includes('corner')) {
      return this.placeSprite(element, DEPTH.block);
    }
    const insetX = Math.min(BLOCK_SLICE.maxInsetPx, element.def.width / 4);
    const insetY = Math.min(BLOCK_SLICE.maxInsetPx, element.def.height / 4);
    return this.scene.add
      .nineslice(
        element.x,
        element.y,
        element.def.key,
        undefined,
        element.width,
        element.height,
        insetX,
        insetX,
        insetY,
        insetY,
      )
      .setOrigin(0.5)
      .setRotation(Phaser.Math.DegToRad(element.rotationDeg))
      .setDepth(DEPTH.block);
  }

  private placeBlock(element: PlacedElement): void {
    const shape = BLOCK_HULLS[element.def.name];
    if (shape === undefined) {
      throw new Error(
        `tilt-ball: no baked body for '${element.def.name}' — re-run tools/ball-bodies/bake.py`,
      );
    }

    const angle = Phaser.Math.DegToRad(element.rotationDeg);
    const scaleX = (element.width / element.def.width) * (element.flipH ? -1 : 1);
    const scaleY = (element.height / element.def.height) * (element.flipV ? -1 : 1);
    const verts = shape.hull.map(([hx, hy]) => {
      const sx = hx! * scaleX;
      const sy = hy! * scaleY;
      return {
        x: element.x + sx * Math.cos(angle) - sy * Math.sin(angle),
        y: element.y + sx * Math.sin(angle) + sy * Math.cos(angle),
      };
    });
    // A mirrored hull runs the other way round, and Matter needs one winding.
    if (scaleX * scaleY < 0) verts.reverse();

    const centre = centroid(verts);
    // `fromVertices` moves the body so its CENTRE OF MASS lands on the position
    // it is given. For a triangle that is not the middle of the art, so the
    // centroid is what must be passed — otherwise every corner block sits a
    // sixth of its size away from the picture of it.
    const body = this.scene.matter.bodies.fromVertices(
      centre.x,
      centre.y,
      [verts],
      {
        isStatic: true,
        // The same for every wall, bouncy or not: the kick off a bouncy block
        // is applied by the play scene on contact (see BOUNCE in constants),
        // and a high restitution here would add a second, weaker bounce under
        // it that answers to a different rule.
        restitution: WALL.restitution,
        friction: WALL.friction,
        collisionFilter: { category: CAT.WALL, mask: CAT.BALL, group: 0 },
      },
      true,
    );
    this.scene.matter.world.add(body);

    const sprite = this.placeBlockArt(element);
    const wall: Wall = {
      body,
      sprite,
      lock: element.def.lock,
      baseScaleX: sprite.scaleX,
      baseScaleY: sprite.scaleY,
    };
    this.walls.push(wall);
    if (element.def.bouncy) this.bouncyWalls.set(body.id, wall);

    if (element.def.rotates) {
      const drift = Math.hypot(centre.x - element.x, centre.y - element.y);
      if (drift > 1) {
        // A rotating body turns about its centre of mass while the sprite turns
        // about its middle, so the two only stay together when those agree.
        // Every rotating piece of art is a rectangle, so this is a guard against
        // a future one that is not — not a case to work around silently.
        throw new Error(
          `tilt-ball: rotating block '${element.def.name}' is not centre-balanced (${drift.toFixed(1)}px)`,
        );
      }
      this.rotators.push({
        wall,
        periodS: element.rotatePeriodS > 0 ? element.rotatePeriodS : ROTATOR.defaultPeriodS,
        waitedS: 0,
        turning: false,
      });
    }
  }

  // ── runtime ────────────────────────────────────────────────────────────

  /** Advance the rotating blocks and the obstacles. `dtS` is seconds. */
  update(dtS: number): void {
    for (const rotator of this.rotators) {
      if (rotator.turning) continue;
      rotator.waitedS += dtS;
      if (rotator.waitedS < rotator.periodS) continue;
      rotator.waitedS = 0;
      this.turn(rotator);
    }

    for (const obstacle of this.obstacles) {
      if (obstacle.rider !== undefined) {
        const { path, speedPxS } = obstacle.rider;
        obstacle.rider.at = advanceOnPath(path, obstacle.rider.at, speedPxS * dtS);
        const at = pointOnPath(path, obstacle.rider.at.distance);
        obstacle.x = at.x;
        obstacle.y = at.y;
        obstacle.sprite.setPosition(at.x, at.y);
      }
      if (obstacle.frames === undefined) continue;
      // Two frames, swapped on a timer. A blade needs to look like it is
      // turning; it does not need an animation manager to do it.
      obstacle.frameAgeMs += dtS * 1000;
      if (obstacle.frameAgeMs < OBSTACLE.frameMs) continue;
      obstacle.frameAgeMs = 0;
      obstacle.frame = 1 - obstacle.frame;
      obstacle.sprite.setTexture(obstacle.frames[obstacle.frame]!);
    }
  }

  /** True when a ball of this radius at (x, y) is touching a blade or a spike. */
  onObstacle(x: number, y: number, ballRadius: number): boolean {
    const reach = killReach(ballRadius);
    return this.obstacles.some(
      (obstacle) =>
        distanceToShape(obstacleShapeAt(obstacle.element, obstacle.x, obstacle.y), x, y) <= reach,
    );
  }

  /** True when this body is one of the springy blocks. */
  isBouncy(bodyId: number): boolean {
    return this.bouncyWalls.has(bodyId);
  }

  /**
   * The visible half of a bouncy block's kick: it swells and comes back.
   *
   * Only the ART moves — the collider stays exactly where it was, which is why
   * the swell is small. A block that visibly grew into the lane would be
   * claiming a shape it does not have.
   *
   * Any tween already running on this sprite is killed and its scale reset
   * first: three balls hitting the same block inside 110 ms would otherwise
   * leave it stuck at whatever size the last interrupted tween had reached.
   */
  kick(bodyId: number): void {
    const wall = this.bouncyWalls.get(bodyId);
    if (wall === undefined) return;
    this.scene.tweens.killTweensOf(wall.sprite);
    wall.sprite.setScale(wall.baseScaleX, wall.baseScaleY);
    this.scene.tweens.add({
      targets: wall.sprite,
      scaleX: wall.baseScaleX * BOUNCE.popScale,
      scaleY: wall.baseScaleY * BOUNCE.popScale,
      duration: BOUNCE.popMs,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }

  private turn(rotator: Rotator): void {
    const from = rotator.wall.body.angle;
    const to = from + Math.PI / 2;
    const state = { t: 0 };
    rotator.turning = true;
    // Quiet: several blocks may turn at once and none of them is an event.
    sfx('tb-rotate', { volume: 0.5 });
    this.scene.tweens.add({
      targets: state,
      t: 1,
      duration: ROTATOR.sweepMs,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        const angle = from + (to - from) * state.t;
        this.scene.matter.body.setAngle(rotator.wall.body, angle, false);
        rotator.wall.sprite.setRotation(angle);
      },
      onComplete: () => {
        this.scene.matter.body.setAngle(rotator.wall.body, to, false);
        rotator.wall.sprite.setRotation(to);
        rotator.turning = false;
      },
    });
  }

  /**
   * Take a key: every wall of that colour goes away and every goal of that
   * colour opens. Shared, not per player — a wall cannot be present for one
   * ball and absent for another on the same screen. Story mode is the only
   * mode that has locks, which is why that is a rule and not a compromise.
   */
  openLock(colour: LockColour): void {
    sfx('tb-unlock');
    for (const wall of this.walls) {
      if (wall.lock !== colour) continue;
      this.scene.matter.world.remove(wall.body);
      this.scene.tweens.add({
        targets: wall.sprite,
        alpha: 0,
        scale: wall.sprite.scale * 0.8,
        duration: 220,
        onComplete: () => wall.sprite.destroy(),
      });
    }
    this.walls = this.walls.filter((wall) => wall.lock !== colour);

    for (const hole of this.holes) {
      if (!hole.locked || hole.lock !== colour) continue;
      hole.locked = false;
      hole.sprite.setTexture(unlockedGoalKey(hole));
      this.scene.tweens.add({ targets: hole.sprite, scale: hole.sprite.scale * 1.15, duration: 180, yoyo: true });
    }
  }

  /** The hole a ball of this radius would fall into at (x, y), if any. */
  holeUnder(x: number, y: number, ballRadius: number): Hole | undefined {
    return this.holes.find((hole) => {
      if (hole.locked) return false;
      // A ball too big for the pit rolls over it: the plate is flush with the
      // floor, so there is nothing to feel.
      if (!hole.large && ballRadius > HOLE_RADIUS.small) return false;
      return Math.hypot(hole.x - x, hole.y - y) <= hole.radius * CAPTURE_FRACTION;
    });
  }

  /**
   * The key a ball of this radius picks up at (x, y), if any — anything it
   * touches. Unlike a hole, which must swallow a ball that is over its middle,
   * a key is a pick-up and should come away on contact.
   */
  keyUnder(x: number, y: number, ballRadius: number): KeyPickup | undefined {
    return this.keys.find(
      (key) =>
        !key.taken &&
        Math.hypot(key.x - x, key.y - y) <= key.radius + ballRadius + KEY_GRAB_PAD,
    );
  }

  /**
   * True when there is no floor under this point — a void tile, the cut corner
   * of one, or anything off an open board. One question for both, because they
   * are the same thing to a ball: it falls.
   */
  isVoidAt(x: number, y: number): boolean {
    return voidAt(this.voidGrid, x, y);
  }

  /** True when a ball at (x, y) is standing in a beam that is lit. */
  inBeam(x: number, y: number, ballRadius: number): boolean {
    const reach = LASER.widthPx / 2 + ballRadius * LASER.ballFraction;
    return this.beams.some(
      (beam) =>
        this.isLaserOn(beam.colour) &&
        distanceToSegment(x, y, beam.x1, beam.y1, beam.x2, beam.y2) <= reach,
    );
  }

  isLaserOn(colour: LaserColour): boolean {
    return this.lasersOn.get(colour) === true;
  }

  /**
   * A ball hit this body: if it is a lever, throw it. Returns whether it was
   * one — the caller still bounces the ball off it either way, because a lever
   * is a solid thing in front of a wall.
   *
   * A ball leaning on a lever reports a contact every physics step, so a throw
   * is ignored for `SWITCH.retriggerMs` after the last one. Without it a ball
   * resting there would strobe its laser at 120 Hz.
   */
  hitSwitch(bodyId: number, nowMs: number): boolean {
    const lever = this.switches.find((entry) => entry.body.id === bodyId);
    if (lever === undefined) return false;
    if (nowMs - lever.lastThrownAt >= SWITCH.retriggerMs) {
      lever.lastThrownAt = nowMs;
      this.toggleLaser(lever.colour);
    }
    return true;
  }

  /**
   * Flip one colour. Every lever of that colour moves, wherever it is on the
   * board: they are one switch shown in several places, not several switches.
   */
  private toggleLaser(colour: LaserColour): void {
    const on = !this.isLaserOn(colour);
    this.lasersOn.set(colour, on);
    sfx('tb-switch');
    for (const beam of this.beams) {
      if (beam.colour === colour) beam.sprite.setVisible(on);
    }
    for (const lever of this.switches) {
      if (lever.colour === colour) lever.sprite.setTexture(switchTexture(colour, on));
    }
  }

  /** Which lock colours this level actually uses — for the HUD. */
  lockColours(): LockColour[] {
    return [...new Set(this.keys.map((key) => key.colour))];
  }

  destroy(): void {
    this.background.destroy();
    this.frame?.destroy();
  }
}

/**
 * A lever's art, which is its colour and its state: `laser_switch_RedOff`. The
 * capital is the art pack's, and this is the one place that spelling is turned
 * into a texture key.
 */
function switchTexture(colour: LaserColour, on: boolean): string {
  const name = colour.charAt(0).toUpperCase() + colour.slice(1);
  return textureKey(`laser_switch_${name}${on ? 'On' : 'Off'}`);
}

function unlockedGoalKey(hole: Hole): string {
  return textureKey(hole.large ? 'hole_large_end' : 'hole_small_end');
}

/** Area centroid of a simple polygon — Matter's `fromVertices` anchor point. */
function centroid(verts: { x: number; y: number }[]): { x: number; y: number } {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const a = verts[j]!;
    const b = verts[i]!;
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  area /= 2;
  if (Math.abs(area) < 1e-6) throw new Error('tilt-ball: degenerate block hull');
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/**
 * The board's frame, generated because there is no frame in the art pack: a
 * white rounded-rectangle stroke, drawn once per game and stretched by the
 * nine-slice. Insets are half the texture minus a pixel, so the whole corner
 * detail is preserved and only a 2px sliver is ever stretched.
 *
 * The stroke is drawn in the texture's OUTERMOST `thickness` band (the pen is
 * centred at `thickness / 2` from the edge), which is what lets the caller
 * oversize the nine-slice by exactly that much and keep the play area clear.
 */
const FRAME_TEXTURE = 'tb-frame';

/**
 * The cut corner: a black square with a quarter disc taken out of its inner
 * side, drawn as the top-left corner of a floor cell and turned for the other
 * three.
 *
 * Generated at four times the size it is drawn at, because the arc is the whole
 * point of it and a 20px one drawn at 20px is visibly a staircase.
 */
const CORNER_TEXTURE = 'tb-void-corner';
const CORNER_SUPERSAMPLE = 4;

function cornerTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(CORNER_TEXTURE)) return CORNER_TEXTURE;
  const size = VOID.cornerRadius * CORNER_SUPERSAMPLE;
  const graphics = scene.make.graphics({ x: 0, y: 0 }, false);
  graphics.fillStyle(0x000000, 1);
  graphics.beginPath();
  graphics.moveTo(0, 0);
  graphics.lineTo(size, 0);
  // The arc is centred on the cell's side of the corner, so it bulges towards
  // the corner and leaves black outside it — the floor keeps the disc.
  graphics.arc(size, size, size, -Math.PI / 2, Math.PI, true);
  graphics.lineTo(0, 0);
  graphics.closePath();
  graphics.fillPath();
  graphics.generateTexture(CORNER_TEXTURE, size, size);
  graphics.destroy();
  return CORNER_TEXTURE;
}

/** Which way to turn that texture for a corner in this quadrant. */
function cornerAngle(dx: -1 | 1, dy: -1 | 1): number {
  if (dx < 0 && dy < 0) return 0;
  if (dx > 0 && dy < 0) return Math.PI / 2;
  if (dx > 0 && dy > 0) return Math.PI;
  return -Math.PI / 2;
}

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
