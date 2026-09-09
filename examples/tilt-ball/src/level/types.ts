/**
 * What a level is, once the Tiled JSON has been parsed. Nothing downstream of
 * the loader ever sees a gid, a tileset or a property list.
 */

/** The three key colours. The default art (`key.png`) is yellow. */
export type LockColour = 'yellow' | 'orange' | 'pink';

export const LOCK_COLOURS: readonly LockColour[] = ['yellow', 'orange', 'pink'] as const;

/**
 * The four laser colours, which are also the four lasers: a board has at most
 * one beam of each, because the colour is what pairs an emitter with its far
 * end and with the levers that switch it.
 */
export type LaserColour = 'red' | 'green' | 'blue' | 'yellow';

export const LASER_COLOURS: readonly LaserColour[] = ['red', 'green', 'blue', 'yellow'] as const;

export type ElementKind =
  | 'block'
  | 'hole'
  | 'goal'
  | 'start'
  | 'key'
  /** The emitter that fires; its rotation is the direction. */
  | 'laser-start'
  /** The one it fires at. Placed anywhere on that line; the loader pairs them. */
  | 'laser-end'
  /** A rectangle of missing floor. Grid-aligned; a ball over it falls. */
  | 'void'
  /** A lever: the ball hits it, and one colour of laser goes on or off. */
  | 'switch'
  /** Scenery on the floor. No body, no rule, no effect on anything. */
  | 'decor'
  /** Spikes and saws: no body either, but touching one is death. */
  | 'obstacle'
  /** One piece of the track a saw rides. Not solid, and not deadly. */
  | 'rail';

/** Which way a saw travels along its rail to begin with. */
export type RailDirection = 'forward' | 'backward';

export type BallSize = 'small' | 'large';

export type LevelMode = 'story' | 'versus';

/**
 * What the board's boundary is.
 *
 * `wall` is the white picture frame: the ball bounces off it and the board is a
 * closed box. `open` has no frame and no colliders there — the floor simply
 * stops, and a ball that rolls off falls exactly as it does into a void tile or
 * a wrong hole. Which means an open board's outside is void, and the corner
 * rounding that void tiles get applies to the board's own corners too.
 */
export type BoardEdges = 'wall' | 'open';

/** One entry of the tileset: what a piece of art IS, independent of where it sits. */
export interface TileDef {
  /** Art basename, e.g. `block_locked_square_pink`. */
  name: string;
  /** Texture key in the game's texture manager, `tb-` + name. */
  key: string;
  width: number;
  height: number;
  kind: ElementKind;
  /** Walls only: the ball bounces off instead of stopping. */
  bouncy: boolean;
  /** Blocks and goals: which key opens it. Keys: which colour this key is. */
  lock?: LockColour;
  /** Holes and goals: only the large ball fits. Ignored elsewhere. */
  large: boolean;
  /** Blocks: turns 90° on a timer. */
  rotates: boolean;
  /**
   * Lasers and levers: which of the four beams this piece belongs to. The
   * emitter art is grey and carries a default the author overrides per object;
   * a lever's colour is its art, so the tile is the only place it can come from.
   */
  laserColour?: LaserColour;
  /**
   * Levers only: the state the art shows, which IS the beam's state at the
   * start of the level. There is no separate property for it — what you place
   * in the editor is what the board does.
   */
  switchOn?: boolean;
  /**
   * Instance setting the TILESET carries a default for, so the field is already
   * there when a rotating block is placed in Tiled and an object only has to
   * override it. Seconds.
   */
  defaultRotatePeriodS?: number;
  /**
   * The same arrangement for the rails. Rail pieces default to track 1, because
   * most boards have one; saws deliberately have NO default — a saw without a
   * `railId` is a saw that stands still, and that has to be sayable by leaving
   * the field alone.
   */
  defaultRailId?: number;
  defaultSpeedPxS?: number;
  defaultDirection?: RailDirection;
}

/** One thing placed on a board. */
export interface PlacedElement {
  def: TileDef;
  /** Centre, in world px. */
  x: number;
  y: number;
  /** Drawn size — Tiled may scale an object away from its source size. */
  width: number;
  height: number;
  rotationDeg: number;
  flipH: boolean;
  flipV: boolean;
  /** Rotating blocks: seconds between 90° turns. */
  rotatePeriodS: number;
  /** Lasers and levers: resolved from the object, else from the tile. */
  laserColour?: LaserColour;
  /**
   * Rails, and saws that ride them: which track this belongs to. A saw with no
   * `railId` stands where it was placed and only spins.
   */
  railId?: number;
  /** Saws on a rail: px per second, and which way round the track. */
  speedPxS?: number;
  direction?: RailDirection;
}

export interface LevelSpec {
  /** File stem — `story-01`, `versus-02`. Also the thumbnail's key. */
  id: string;
  title: string;
  mode: LevelMode;
  edges: BoardEdges;
  widthPx: number;
  heightPx: number;
  /** Texture key of the tiled backdrop. */
  backgroundKey: string;
  ballSize: BallSize;
  elements: PlacedElement[];
}
