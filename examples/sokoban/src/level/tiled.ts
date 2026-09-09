import { GRID } from '../constants';
import {
  CRATE_COLOURS,
  type Cell,
  type CrateColour,
  type Feature,
  type LevelMode,
  type LevelSpec,
  type TileDef,
  type TileKind,
} from './types';

/**
 * Tiled JSON → `LevelSpec`. Pure: no Phaser, no scene, so `tests/level.test.ts`
 * can parse the shipped levels and check them.
 *
 * Everything here fails loudly. An unknown kind, a gid with no tile, a crate
 * placed on the wall layer, a board with two players: each is a level that
 * would otherwise load with a piece missing and no message, which is the one
 * outcome worth crashing over — a goal that quietly is not there is a level
 * nobody can finish and nobody can see why.
 *
 * A level is FOUR TILE LAYERS, not objects. Every piece here occupies exactly
 * one cell, and a tile layer is the editor's own way of saying that.
 */

const KINDS: readonly TileKind[] = ['ground', 'wall', 'goal', 'hole', 'crate', 'start', 'coin'];

/** Which kinds a layer may hold. A piece on the wrong layer is an error. */
const LAYER_KINDS: Record<string, readonly TileKind[]> = {
  floor: ['ground'],
  goals: ['goal', 'hole'],
  walls: ['wall'],
  things: ['crate', 'start', 'coin'],
};

interface TiledProperty {
  name: string;
  value: string | number | boolean;
}

interface TsjTile {
  id: number;
  image: string;
  properties?: TiledProperty[];
}

interface Tmj {
  width: number;
  height: number;
  properties?: TiledProperty[];
  tilesets: { firstgid: number; source: string }[];
  layers: {
    type: string;
    name: string;
    data?: number[];
  }[];
}

export const textureKey = (name: string): string => `sk-${name}`;

function lookup(properties: TiledProperty[] | undefined, name: string): TiledProperty['value'] | undefined {
  return properties?.find((p) => p.name === name)?.value;
}

const MODES: readonly LevelMode[] = ['story', 'coop'];

/** How many players each mode's boards are drawn for. */
export const SEATS: Record<LevelMode, number> = { story: 1, coop: 2 };

function asColour(value: unknown, what: string): CrateColour {
  if (typeof value !== 'string' || !CRATE_COLOURS.includes(value as CrateColour)) {
    throw new Error(`sokoban: ${what} has colour '${String(value)}'`);
  }
  return value as CrateColour;
}

/** The tileset, keyed by the tile id a gid resolves to. */
export function parseTileset(raw: string): Map<number, TileDef> {
  const tsj = JSON.parse(raw) as { tiles?: TsjTile[] };
  if (!Array.isArray(tsj.tiles)) throw new Error('sokoban: tileset has no tiles');
  const tiles = new Map<number, TileDef>();
  for (const tile of tsj.tiles) {
    const name = (tile.image.split('/').pop() ?? tile.image).replace(/\.png$/i, '');
    const kind = lookup(tile.properties, 'kind');
    if (typeof kind !== 'string' || !KINDS.includes(kind as TileKind)) {
      throw new Error(`sokoban: tile '${name}' has kind '${String(kind)}'`);
    }
    const colour = lookup(tile.properties, 'colour');
    const seat = lookup(tile.properties, 'seat');
    if (kind === 'start' && typeof seat !== 'number') {
      throw new Error(`sokoban: start tile '${name}' has no seat`);
    }
    tiles.set(tile.id, {
      name,
      key: textureKey(name),
      kind: kind as TileKind,
      colour: colour === undefined ? undefined : asColour(colour, `tile '${name}'`),
      seat: typeof seat === 'number' ? seat : undefined,
    });
  }
  return tiles;
}

function layerData(tmj: Tmj, name: string, id: string): number[] {
  const layer = tmj.layers.find((l) => l.name === name);
  if (layer === undefined) throw new Error(`sokoban: ${id} has no '${name}' layer`);
  if (layer.type !== 'tilelayer' || layer.data === undefined) {
    throw new Error(`sokoban: ${id}'s '${name}' is not a tile layer`);
  }
  if (layer.data.length !== tmj.width * tmj.height) {
    throw new Error(`sokoban: ${id}'s '${name}' is ${layer.data.length} cells, not ${tmj.width * tmj.height}`);
  }
  return layer.data;
}

export function parseLevel(id: string, raw: string, tiles: Map<number, TileDef>): LevelSpec {
  const tmj = JSON.parse(raw) as Tmj;
  const { width, height } = tmj;
  if (width < 1 || height < 1 || width > GRID.width || height > GRID.height) {
    throw new Error(`sokoban: ${id} is ${width}x${height}, the board is ${GRID.width}x${GRID.height}`);
  }
  const firstgid = tmj.tilesets[0]?.firstgid;
  if (firstgid === undefined) throw new Error(`sokoban: ${id} has no tileset`);

  const title = lookup(tmj.properties, 'title');
  if (typeof title !== 'string' || title.trim() === '') {
    throw new Error(`sokoban: ${id} has no title`);
  }
  const parMoves = lookup(tmj.properties, 'parMoves');
  if (typeof parMoves !== 'number' || !Number.isFinite(parMoves) || parMoves < 1) {
    throw new Error(`sokoban: ${id} has parMoves '${String(parMoves)}'`);
  }
  const source = lookup(tmj.properties, 'source');
  const mode = lookup(tmj.properties, 'mode');
  if (typeof mode !== 'string' || !MODES.includes(mode as LevelMode)) {
    throw new Error(`sokoban: ${id} has mode '${String(mode)}'`);
  }
  const seats = SEATS[mode as LevelMode];

  /** The tile a cell of a layer holds, checked against what that layer may hold. */
  const tileAt = (data: number[], layer: string, index: number): TileDef | undefined => {
    const gid = data[index];
    if (gid === undefined || gid === 0) return undefined;
    const def = tiles.get(gid - firstgid);
    if (def === undefined) throw new Error(`sokoban: ${id} uses gid ${gid}, which is not in the tileset`);
    if (!LAYER_KINDS[layer]!.includes(def.kind)) {
      throw new Error(`sokoban: ${id} has a ${def.kind} ('${def.name}') on the '${layer}' layer`);
    }
    return def;
  };

  const floorData = layerData(tmj, 'floor', id);
  const goalData = layerData(tmj, 'goals', id);
  const wallData = layerData(tmj, 'walls', id);
  const thingData = layerData(tmj, 'things', id);

  const cells = width * height;
  const floor: (string | undefined)[] = new Array(cells).fill(undefined);
  const walls: (string | undefined)[] = new Array(cells).fill(undefined);
  const features: (Feature | undefined)[] = new Array(cells).fill(undefined);
  const crates: LevelSpec['crates'] = [];
  const coins: LevelSpec['coins'] = [];
  // By seat, so a board that places seat 2 and forgets seat 1 is an error
  // rather than a level whose second player is the first.
  const starts = new Map<number, Cell>();

  for (let index = 0; index < cells; index++) {
    const x = index % width;
    const y = Math.floor(index / width);

    floor[index] = tileAt(floorData, 'floor', index)?.key;
    walls[index] = tileAt(wallData, 'walls', index)?.key;

    const goal = tileAt(goalData, 'goals', index);
    if (goal !== undefined) {
      features[index] = { key: goal.key, pit: goal.kind === 'hole', colour: goal.colour };
    }

    const thing = tileAt(thingData, 'things', index);
    if (thing === undefined) continue;
    if (thing.kind === 'crate') {
      if (thing.colour === undefined) throw new Error(`sokoban: ${id} has a crate with no colour`);
      crates.push({ x, y, colour: thing.colour });
    } else if (thing.kind === 'coin') {
      coins.push({ x, y });
    } else {
      if (thing.seat === undefined) throw new Error(`sokoban: ${id} has a start with no seat`);
      if (starts.has(thing.seat)) {
        throw new Error(`sokoban: ${id} has two starts for player ${thing.seat + 1}`);
      }
      starts.set(thing.seat, { x, y });
    }
  }

  if (starts.size !== seats) {
    throw new Error(`sokoban: ${id} is a ${mode} board, so it needs ${seats} start(s), not ${starts.size}`);
  }
  const ordered: Cell[] = [];
  for (let seat = 0; seat < seats; seat++) {
    const cell = starts.get(seat);
    if (cell === undefined) throw new Error(`sokoban: ${id} has no start for player ${seat + 1}`);
    if (floor[cell.y * width + cell.x] === undefined) {
      throw new Error(`sokoban: ${id} starts player ${seat + 1} off the floor`);
    }
    ordered.push(cell);
  }
  if (crates.length === 0) throw new Error(`sokoban: ${id} has no crates`);

  // A goal with no crate of its colour is a level that cannot be finished, and
  // it is far cheaper to say so here than to let a player look for the crate.
  // The other way round is fine and is a mechanic: spare crates are what a
  // plain pit is for.
  for (const colour of CRATE_COLOURS) {
    const wanted = features.filter((f) => f?.colour === colour).length;
    const available = crates.filter((c) => c.colour === colour).length;
    if (available < wanted) {
      throw new Error(`sokoban: ${id} wants ${wanted} ${colour} crates and has ${available}`);
    }
  }

  return {
    id,
    title,
    mode: mode as LevelMode,
    source: typeof source === 'string' && source !== '' ? source : undefined,
    parMoves: Math.round(parMoves),
    width,
    height,
    floor,
    walls,
    features,
    crates,
    coins,
    starts: ordered,
  };
}
