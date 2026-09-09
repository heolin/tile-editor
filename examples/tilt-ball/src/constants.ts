/**
 * Every number the game reads that is not a difficulty dial (see difficulty.ts)
 * or a level's own geometry. Design: `docs/tilt-ball-plan.md`.
 */

/** Tiled grid, and the size every piece of the art is a multiple of. */
export const CELL = 64;

/** The board every shipped level is authored at, in cells. Levels declare their
 *  own size and the loader honours it; this is only what the thumbnail baker
 *  and the template map assume. */
export const BOARD_CELLS = { w: 16, h: 20 } as const;

export const BALL = {
  /** Source art is 64 px across for the small ball, 128 for the large. */
  smallRadius: 32,
  largeRadius: 64,
  /**
   * Bounce off a plain wall. Low on purpose: springiness is what a *bouncy*
   * block is for, and a ball that bounces off everything cannot be parked.
   * This is Matter's own restitution, which only adds to the game's mirror —
   * cut with it when the board turned out too lively on a phone.
   */
  restitution: 0.07,
  /** Matter friction between ball and wall — a rolling ball should not stick. */
  friction: 0,
  /** Tilt below this is treated as rest, so a capsule at rest does not creep. */
  deadzone: 0.08,
} as const;

/**
 * Stretching a block in Tiled.
 *
 * A plain image drawn at a different size stretches everything in it, and these
 * blocks have rounded corners, a lit edge and rivets — all of which smear. So a
 * block drawn at anything other than its art's own size is a **nine-slice**:
 * corners kept, edges stretched along one axis, middle along both.
 *
 * The inset is a quarter of the art, capped here. Measured off the pictures:
 * the corner curve is done by 16 px and the rivets end by 27, so 32 keeps both
 * intact on the 128 px arts — and a quarter is what keeps the 64 px ones from
 * having no middle left to stretch.
 */
export const BLOCK_SLICE = { maxInsetPx: 32 } as const;

export const WALL = {
  /** The wall's half of the same pair as `BALL.restitution`, cut with it. */
  restitution: 0.07,
  friction: 0,
  /**
   * A plain wall — and the board's frame — mirrors the ball instead of
   * swallowing it: the speed it arrived with, back along the surface normal,
   * and **nothing added**. That is the difference from a bouncy block, which
   * has a floor speed of its own (`BOUNCE.timesTopSpeed`).
   *
   * 1 is an exact reversal, which is where this started and what made the game
   * unplayable on a phone: every wall sent the ball back at the speed it came
   * in, so a board with walls on both sides was a rally. 0.7 takes a third out
   * of every bounce, and the ball still comes back.
   */
  bounceKeep: 0.7,
} as const;

/**
 * The bouncy blocks kick ACTIVELY: the game reflects the ball itself on contact
 * and gives it at least `minPxS`, rather than leaving it to a high `restitution`
 * on the wall.
 *
 * Matter's restitution is only applied above the resolver's resting threshold,
 * which counts displacement per STEP — and the engine here runs at 120 Hz, so
 * every speed reads as half of what it would at 60. A ball rolling at any
 * ordinary pace fell under that threshold and stopped dead against the block,
 * which is exactly what a bouncy block must never do.
 *
 * `minPxS` is deliberately absolute rather than a share of the difficulty's top
 * speed: a block is a fixed thing on the board, and it should throw the ball the
 * same distance for everyone. Two thirds of the easy setting's top speed.
 */
export const BOUNCE = {
  /**
   * How hard a block kicks, as a MULTIPLE of what the tilt can ask for at this
   * difficulty (`topPxS`). Above 1 by a clear margin on purpose: the kick and
   * the steering are added together, so a player holding the stick into a block
   * must still be thrown off it. At 1.6 the ball leaves at 0.6 × top speed even
   * with the tilt fully against it.
   *
   * A multiple rather than an absolute number because the thing it has to beat
   * — the steering — is itself per difficulty.
   *
   * Cut from 1.6 with everything else when the board turned out too lively to
   * play on a phone. At 1.12 a block still out-pushes a tilt held straight into
   * it, but only just: this is the first number to raise if the bouncy blocks
   * start reading as ordinary walls.
   */
  timesTopSpeed: 1.12,
  /**
   * What is left of a kick after one 60 fps frame. 0.98 leaves 30% of it after
   * a second, which is long enough for the ball to clearly travel on the block's
   * terms before the tilt takes over again.
   *
   * Scaled by the real frame time so a slow frame does not extend the kick.
   */
  decayPerFrame: 0.98,
  /** Below this the kick is spent, and is dropped rather than crawling to zero. */
  spentPxS: 6,
  /** The block's own recoil: how far it swells, and for how long each way. */
  popScale: 1.08,
  popMs: 110,
} as const;

/**
 * The black tiles that say "there is no floor here", and the board's own edge
 * when a level declares `edges: "open"` — the two are one thing, because the
 * outside of an open board IS void.
 *
 * A void tile is placed in Tiled on the 64 grid and may be scaled to any
 * whole number of cells. That constraint is what makes the rounded corners
 * below answerable at all: a corner is cut when the two cells that meet at it
 * are both void, and a cell only has neighbours if the board is a grid.
 */
export const VOID = {
  /**
   * How far a convex corner of the floor is cut back where two void cells meet
   * it. Just under a third of a cell: clearly a rounded corner, and small
   * enough that the cell is still mostly floor.
   */
  cornerRadius: 20,
  /**
   * Each void rectangle is drawn this much oversize on every side. Two black
   * quads sharing an edge can show a hairline of floor between them once the
   * camera zoom lands the seam between two device pixels; overlapping them
   * hides it. Black over black, so the only cost is that the picture leads the
   * rule by a pixel at a void's edge.
   */
  bleedPx: 1,
} as const;

/**
 * What each obstacle actually kills with, in the ART's own pixels, measured off
 * the pictures and relative to their centre. Every one of them is smaller than
 * its tile, which is the point: a spike strip is deadly along its teeth, not
 * across the whole cell it was drawn in.
 *
 * Scaled and turned with the object like every other shape here, so a spike
 * strip rotated 90° in Tiled kills along the wall it now hangs on.
 *
 * Keyed by art name without the frame number. An obstacle with no entry throws
 * at load rather than being placed with nothing to hit.
 */
export type ObstacleShape =
  | { kind: 'rect'; cx: number; cy: number; halfW: number; halfH: number }
  | { kind: 'disc'; cx: number; cy: number; radius: number };

export const OBSTACLES: Record<string, ObstacleShape> = {
  // Three teeth hanging from the top edge of a 128px tile, 56px deep. The gaps
  // between them are counted as deadly: a ball that fits between two teeth is
  // still on the strip.
  spikes: { kind: 'rect', cx: 0, cy: -36, halfW: 64, halfH: 28 },
  // A dome standing on the bottom edge — so a disc centred THERE, not a box
  // around the lower half, which would kill in two empty corners.
  chainsaw_half: { kind: 'disc', cx: 0, cy: 70, radius: 70 },
  // The teeth reach 70; 64 lets the very tip of one pass a ball.
  chainsaw_full: { kind: 'disc', cx: 0, cy: 0, radius: 64 },
};

export const OBSTACLE = {
  /** How much of the ball has to be in it to die — same rule as a beam. */
  ballFraction: 0.5,
  /** Both saws are two frames; this is how long each is held. */
  frameMs: 90,
} as const;

/**
 * The rail a saw rides. Both pieces are 140px tiles whose track runs through
 * the tile's CENTRE and leaves through the middle of an edge — straight joins
 * left to right, the corner joins left to bottom. Rotating and flipping the
 * object in Tiled covers every other orientation, so those two local shapes are
 * the whole geometry.
 */
export const RAIL = {
  /**
   * How far apart two ends may be and still be one joint.
   *
   * The rail art is 128 px — two cells — so pieces snapped to neighbouring
   * cells now meet exactly and this is slack rather than a requirement. It
   * stays generous because it did not use to be: the art was 140 px on a 64 px
   * grid, whose ends overshoot by 12, and levels saved with that size are still
   * around. Under half a cell, so two pieces a cell apart are still two pieces.
   */
  jointTolerancePx: 28,
  /** How far off its rail a saw may be placed before that is an error. */
  mountTolerancePx: 40,
  defaultSpeedPxS: 160,
} as const;

export const PHYSICS = {
  /**
   * The engine runs at a FIXED 120 Hz, twice the frame rate.
   *
   * Two reasons, and the second is the one that decided it: a ball at the hard
   * setting's 1100 px/s covers 18 px per frame at 60 Hz, which is over half its
   * own radius; and a rotating block sweeping 90° in 0.35 s moves its far
   * corner fast enough to reach through a ball between two steps. Both are
   * tunnelling, and both get quieter with a shorter step.
   */
  stepHz: 120,
  /** Matter solver passes. Above the defaults (6 / 4 / 2) for the same reason. */
  positionIterations: 12,
  velocityIterations: 10,
  constraintIterations: 4,
} as const;

export const ROTATOR = {
  /** How long one 90° turn takes. The wait between turns is the level's own
   *  `rotatePeriod`, measured turn-start to turn-start. */
  sweepMs: 350,
  /** Used when a level places a rotating block without saying how often. */
  defaultPeriodS: 4,
} as const;

/**
 * A hole grabs a ball when the ball's CENTRE comes within this fraction of the
 * hole's visible radius. Never above 1: a hole that took a ball whose centre is
 * outside the rim would be reaching past its own picture.
 *
 * It started at 0.55, which left a 40 px window on a 36 px pit and made the
 * goal genuinely hard to hit — at the hard setting's top speed a ball crosses
 * that in a frame and a half. 0.8 is still inside the drawn pit, so a ball can
 * skim the rim and live, but the goal is now a target rather than a needle.
 */
export const CAPTURE_FRACTION = 0.8;

/** Visible radii of the hole art, in source px (the plate around them is wider). */
export const HOLE_RADIUS = { small: 36, large: 68 } as const;

/**
 * A key is taken when the ball TOUCHES it: the reach is the key art's own half
 * size plus the ball's radius, and this is the slack on top.
 *
 * It used to be a flat 44 px from centre to centre, which on a 73 × 68 key and a
 * 64 px ball meant the two had to overlap by a third before anything happened —
 * a key you could visibly run into and not collect.
 */
export const KEY_GRAB_PAD = 6;

/**
 * The beam art is a uniform strip down the middle of a square tile — every row
 * identical, no caps — so a beam is a plain stretched image at any length,
 * rather than the nine-slice the old capped art needed.
 *
 * The two art numbers are here because the strip is NARROWER than its tile, and
 * drawing the tile at the width you want the beam gives you a beam a third of
 * that. The first version did exactly this and drew a 4.6 px thread.
 */
export const LASER = {
  /** Source art: a 70 px tile carrying an 18 px strip. */
  artTilePx: 70,
  artStripPx: 18,
  /** How wide the beam should LOOK. Half of it is the reach of the hit test. */
  widthPx: 36,
  /** How much of the ball has to be in the beam to die: a graze should not. */
  ballFraction: 0.5,
  /**
   * Two emitters facing each other are 70 px apart before their beam has any
   * length at all, so this is a check for a pair placed on top of each other,
   * not the art limit the capped beam used to have.
   */
  minBeamPx: 16,
} as const;

/**
 * The lever that turns one colour of laser on and off.
 *
 * The collider is the PLATE only, measured off the art: the handle sticks out
 * of the tile diagonally and is not something a ball can hit. Everything is in
 * art px, scaled and turned with the object like every other piece.
 */
export const SWITCH = {
  plateWidth: 62,
  plateHeight: 34,
  /** The plate sits low in the tile; this is its centre, from the tile's. */
  plateOffsetY: 17.5,
  /**
   * A ball leaning on a lever reports a contact every step. One hit is one
   * throw of the switch, and this is how long the lever ignores the next one.
   */
  retriggerMs: 260,
  /**
   * How much of the arriving speed a lever gives back, against `WALL.bounceKeep`
   * of 1 for a plain wall. A lever is a thing you go and press: throwing the
   * ball back across the board every time you touched one made hitting it feel
   * like a punishment. It is still solid, so the ball never sinks into it.
   */
  bounceKeep: 0.28,
} as const;

/** How long the falling-in animation runs, for both a death and a goal. */
export const CAPTURE_MS = 380;

/** Ball is back on the start this long after a versus death. */
export const RESPAWN_MS = 450;

/**
 * Once the first ball is home, everyone else has this long to finish. Without
 * it one player hunting for the route holds up the other three.
 */
export const FINISH_WINDOW_MS = 15_000;

/**
 * Coins per point of placing (5 for a win, 3 / 2 / 1 behind it). The game's own
 * number is a time, and a time means nothing without the board it was set on —
 * so the placing is what gets paid, at one coin a point.
 */
export const GOLD_RULES = { scorePerCoin: 1 } as const;

/**
 * Reference-px height of the HUD band along the top. The play scene reserves
 * it and the HUD scene draws into it — two scenes, one number, because the
 * board's camera viewport starts where the HUD ends.
 */
export const HUD_ROW = 200;

/** Draw order inside the play scene. */
export const DEPTH = {
  background: 0,
  /** The missing floor: over the background tiling, under everything placed. */
  void: 2,
  /** Scenery, and the rail a saw rides: both lie ON the floor, under the game. */
  decor: 3,
  rail: 4,
  frame: 5,
  hole: 10,
  key: 20,
  block: 30,
  ball: 40,
  /** Over the ball, because a saw passing above one is what is happening. */
  obstacle: 45,
  laser: 50,
  overlay: 100,
} as const;

/** The white board frame, generated rather than drawn (there is no art for it). */
export const FRAME = {
  /** Wall thickness in world px — also the collider thickness. */
  thickness: 24,
  cornerRadius: 28,
  color: 0xf4f6fb,
  /** Source size of the generated nine-slice texture. */
  textureSize: 128,
} as const;
