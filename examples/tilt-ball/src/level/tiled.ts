import { ROTATOR } from '../constants';
import {
  LASER_COLOURS,
  type BallSize,
  type BoardEdges,
  type ElementKind,
  type LaserColour,
  type LevelMode,
  type LevelSpec,
  type LockColour,
  type PlacedElement,
  type RailDirection,
  type TileDef,
} from './types';

/**
 * Tiled JSON → `LevelSpec`. Pure: no Phaser, no scene, so `tests/level.test.ts`
 * can parse the shipped levels and check them.
 *
 * Everything here fails loudly. An unknown `kind`, a gid with no tile, a laser
 * with no beam length: each is a level that would otherwise load with a piece
 * missing and no message, which is the one outcome worth crashing over — a hole
 * that quietly is not there is a level nobody can finish.
 */

// Tiled packs three flip flags into a gid's high bits.
const FLIP_H = 0x80000000;
const FLIP_V = 0x40000000;
const FLIP_D = 0x20000000;
const GID_MASK = 0x1fffffff;

interface TiledProperty {
  name: string;
  value: string | number | boolean;
}

interface TsjTile {
  id: number;
  image: string;
  imagewidth: number;
  imageheight: number;
  properties?: TiledProperty[];
}

interface Tsj {
  tiles: TsjTile[];
}

interface TmjObject {
  gid?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  visible?: boolean;
  properties?: TiledProperty[];
}

interface TmjLayer {
  type: string;
  name: string;
  objects?: TmjObject[];
}

interface Tmj {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  properties?: TiledProperty[];
  tilesets: { firstgid: number; source: string }[];
  layers: TmjLayer[];
}

const KINDS: readonly ElementKind[] = [
  'block',
  'hole',
  'goal',
  'start',
  'key',
  'laser-start',
  'laser-end',
  'void',
  'switch',
  'decor',
  'obstacle',
  'rail',
];
const LOCKS: readonly LockColour[] = ['yellow', 'orange', 'pink'];

function lookup(properties: TiledProperty[] | undefined, name: string): TiledProperty['value'] | undefined {
  return properties?.find((p) => p.name === name)?.value;
}

function asString(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`tilt-ball: ${what} must be a string, got ${String(value)}`);
  return value;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * A number that may arrive as text.
 *
 * A property added by hand on an object in Tiled gets whatever type the editor
 * was in, so a `railId` typed as a string is common and is still a railId.
 * Reading it as "no value" is the worst outcome available: the saw would simply
 * stand still, with nothing said. Anything that is not a number at all throws.
 */
function numberProperty(value: unknown, what: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  throw new Error(`tilt-ball: ${what} is '${String(value)}', which is not a number`);
}

/** Art basename without the extension — the tileset's identity for a tile. */
function stem(imagePath: string): string {
  const file = imagePath.split('/').pop() ?? imagePath;
  return file.replace(/\.png$/i, '');
}

export function textureKey(name: string): string {
  return `tb-${name}`;
}

/** Parse `tiltball.tsj` into tile definitions, indexed by local tile id. */
export function parseTileset(raw: string): Map<number, TileDef> {
  const tsj = JSON.parse(raw) as Tsj;
  const defs = new Map<number, TileDef>();
  for (const tile of tsj.tiles) {
    const kind = asString(lookup(tile.properties, 'kind'), `tile ${tile.image} kind`);
    if (!KINDS.includes(kind as ElementKind)) {
      throw new Error(`tilt-ball: tile ${tile.image} has unknown kind '${kind}'`);
    }
    const lockRaw = lookup(tile.properties, 'lock');
    if (lockRaw !== undefined && !LOCKS.includes(lockRaw as LockColour)) {
      throw new Error(`tilt-ball: tile ${tile.image} has unknown lock colour '${String(lockRaw)}'`);
    }
    const name = stem(tile.image);
    const laserColour = asLaserColour(lookup(tile.properties, 'laserColour'), `tile ${tile.image}`);
    defs.set(tile.id, {
      name,
      key: textureKey(name),
      width: tile.imagewidth,
      height: tile.imageheight,
      kind: kind as ElementKind,
      bouncy: lookup(tile.properties, 'bouncy') === true,
      lock: lockRaw as LockColour | undefined,
      large: lookup(tile.properties, 'large') === true,
      rotates: lookup(tile.properties, 'rotates') === true,
      laserColour,
      defaultRailId: numberOrUndefined(lookup(tile.properties, 'railId')),
      defaultSpeedPxS: numberOrUndefined(lookup(tile.properties, 'speed')),
      defaultDirection: asDirection(lookup(tile.properties, 'direction'), `tile ${tile.image}`),
      switchOn: kind === 'switch' ? lookup(tile.properties, 'on') === true : undefined,
      defaultRotatePeriodS: numberOrUndefined(lookup(tile.properties, 'rotatePeriod')),
    });
  }
  return defs;
}

/** Which way along a rail, or undefined when unsaid. Anything else throws. */
function asDirection(value: unknown, what: string): RailDirection | undefined {
  if (value === undefined) return undefined;
  if (value !== 'forward' && value !== 'backward') {
    throw new Error(`tilt-ball: ${what} has direction '${String(value)}' — 'forward' or 'backward'`);
  }
  return value;
}

/** A laser colour, or undefined when there is none. Anything else throws. */
function asLaserColour(value: unknown, what: string): LaserColour | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !LASER_COLOURS.includes(value as LaserColour)) {
    throw new Error(
      `tilt-ball: ${what} has unknown laserColour '${String(value)}' — one of ${LASER_COLOURS.join(', ')}`,
    );
  }
  return value as LaserColour;
}

const BACKGROUNDS: Record<string, string> = {
  brown: textureKey('background_brown'),
  blue: textureKey('background_blue'),
  green: textureKey('background_green'),
};

/**
 * Parse one `.tmj` against the tileset.
 *
 * `id` is the file stem, passed in because the map itself does not know its
 * filename and the level's identity (unlock order, thumbnail, best times) is
 * exactly that name.
 */
export function parseLevel(id: string, raw: string, tiles: Map<number, TileDef>): LevelSpec {
  const tmj = JSON.parse(raw) as Tmj;

  const firstgid = tmj.tilesets[0]?.firstgid;
  if (firstgid === undefined) throw new Error(`tilt-ball: level ${id} references no tileset`);

  const title = asString(lookup(tmj.properties, 'title'), `level ${id} title`);
  const mode = asString(lookup(tmj.properties, 'mode'), `level ${id} mode`);
  if (mode !== 'story' && mode !== 'versus') {
    throw new Error(`tilt-ball: level ${id} has unknown mode '${mode}'`);
  }

  // Cosmetic and geometric defaults, matching the template map: a level that
  // says nothing gets the brown board and the small ball, which is what every
  // level authored so far uses. Anything the game cannot guess (title, mode)
  // throws above instead.
  const backgroundName = (lookup(tmj.properties, 'background') as string | undefined) ?? 'brown';
  const backgroundKey = BACKGROUNDS[backgroundName];
  if (backgroundKey === undefined) {
    throw new Error(`tilt-ball: level ${id} has unknown background '${backgroundName}'`);
  }
  const ballSize = ((lookup(tmj.properties, 'ballSize') as string | undefined) ?? 'small') as BallSize;
  if (ballSize !== 'small' && ballSize !== 'large') {
    throw new Error(`tilt-ball: level ${id} has unknown ballSize '${String(ballSize)}'`);
  }
  // A map saved before open boards existed has no `edges`, and every one of them
  // is a framed board — so the default is the old behaviour, not a guess.
  const edges = ((lookup(tmj.properties, 'edges') as string | undefined) ?? 'wall') as BoardEdges;
  if (edges !== 'wall' && edges !== 'open') {
    throw new Error(`tilt-ball: level ${id} has unknown edges '${String(edges)}'`);
  }

  const elements: PlacedElement[] = [];
  for (const layer of tmj.layers) {
    if (layer.type !== 'objectgroup') continue;
    for (const object of layer.objects ?? []) {
      if (object.visible === false) continue;
      if (object.gid === undefined) {
        throw new Error(`tilt-ball: level ${id} has a shape object in '${layer.name}' — only tile objects are supported`);
      }
      elements.push(placeObject(id, object, firstgid, tiles));
    }
  }

  return {
    id,
    title,
    mode: mode as LevelMode,
    edges,
    widthPx: tmj.width * tmj.tilewidth,
    heightPx: tmj.height * tmj.tileheight,
    backgroundKey,
    ballSize,
    elements,
  };
}

function placeObject(
  levelId: string,
  object: TmjObject,
  firstgid: number,
  tiles: Map<number, TileDef>,
): PlacedElement {
  const gid = object.gid as number;
  if ((gid & FLIP_D) !== 0) {
    // Diagonal flip is Tiled's 90° tile rotation for TILE layers. An object
    // layer has a real rotation field, so this can only come from a map painted
    // the wrong way — and the runtime would place the art unrotated.
    throw new Error(`tilt-ball: level ${levelId} uses a diagonally flipped object; rotate it instead`);
  }
  const def = tiles.get((gid & GID_MASK) - firstgid);
  if (def === undefined) {
    throw new Error(`tilt-ball: level ${levelId} references gid ${gid & GID_MASK}, which is not in the tileset`);
  }

  // Tiled writes a property on an object only when it OVERRIDES the tile's, so
  // both are read: the object first, then the tile's default. A rotating block
  // left exactly as placed therefore turns at the tileset's period.
  const objectProps = object.properties;
  const rotatePeriodS = def.rotates
    ? numberOrUndefined(lookup(objectProps, 'rotatePeriod')) ??
      def.defaultRotatePeriodS ??
      ROTATOR.defaultPeriodS
    : 0;

  // Same two-level read for the laser's colour: the emitter art is grey and
  // says nothing, so its tile carries a default and the author picks the beam
  // this one belongs to on the object. A lever's colour is its art, so its tile
  // is the only thing that can say — and an object may not override it.
  const objectColour = asLaserColour(
    lookup(objectProps, 'laserColour'),
    `level ${levelId}, ${def.kind} at (${object.x}, ${object.y})`,
  );
  if (objectColour !== undefined && def.kind === 'switch') {
    throw new Error(
      `tilt-ball: level ${levelId} sets laserColour on a switch at (${object.x}, ${object.y}) — ` +
        'a lever wears its colour, place the art of the colour you want',
    );
  }

  // Rails and the saws that ride them. `railId` is on the object because it is
  // wiring between two pieces of a level, not a property of the art; a saw
  // without one is a saw that stands still.
  const where = `level ${levelId}, ${def.kind} at (${object.x}, ${object.y})`;
  const railId = numberProperty(lookup(objectProps, 'railId'), `${where} railId`) ?? def.defaultRailId;
  const direction = asDirection(lookup(objectProps, 'direction'), where) ?? def.defaultDirection;

  return {
    def,
    x: object.x,
    y: object.y,
    width: object.width,
    height: object.height,
    rotationDeg: object.rotation ?? 0,
    flipH: (gid & FLIP_H) !== 0,
    flipV: (gid & FLIP_V) !== 0,
    rotatePeriodS,
    laserColour: objectColour ?? def.laserColour,
    railId,
    speedPxS: numberProperty(lookup(objectProps, 'speed'), `${where} speed`) ?? def.defaultSpeedPxS,
    direction,
  };
}
