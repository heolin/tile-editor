import { TALL_PREFIXES } from '../constants';
import { orderedObjectBasenames, orderedTileBasenames } from './track-assets';

/** Tiled gid flip flags packed into the high bits. */
const FLIP_H = 0x80000000;
const FLIP_V = 0x40000000;
const FLIP_D = 0x20000000;
const GID_MASK = 0x1fffffff;

const TILES_FIRSTGID = 1;
const OBJECTS_FIRSTGID = 133;

/** Objects whose name contains one of these are decals (no collision body). */
const DECAL_HINTS = ['arrow', 'oil', 'skidmark', 'light'];

export interface ResolvedTile {
  key: string; // texture key (basename)
  isObject: boolean;
  solid: boolean; // only meaningful for objects
  tall: boolean; // render above cars?
  flipH: boolean;
  flipV: boolean;
  flipD: boolean;
}

let tileNames: string[] | null = null;
let objectNames: string[] | null = null;

function tables(): { tiles: string[]; objects: string[] } {
  if (!tileNames) {
    tileNames = orderedTileBasenames();
    objectNames = orderedObjectBasenames();
    if (tileNames.length !== 132) {
      console.warn(`racing: expected 132 tiles, got ${tileNames.length} — gids may be off`);
    }
    if (objectNames.length !== 39) {
      console.warn(`racing: expected 39 objects, got ${objectNames.length} — gids may be off`);
    }
  }
  return { tiles: tileNames, objects: objectNames! };
}

const isDecal = (name: string): boolean => DECAL_HINTS.some((h) => name.includes(h));
const isTall = (name: string): boolean => TALL_PREFIXES.some((p) => name.startsWith(p));

/** Resolve a raw Tiled gid (with flip bits) to its texture + metadata. */
export function resolveGid(rawGid: number): ResolvedTile | null {
  if (rawGid === 0) return null;
  const flipH = (rawGid & FLIP_H) !== 0;
  const flipV = (rawGid & FLIP_V) !== 0;
  const flipD = (rawGid & FLIP_D) !== 0;
  const gid = rawGid & GID_MASK;
  const { tiles, objects } = tables();

  if (gid >= OBJECTS_FIRSTGID) {
    const key = objects[gid - OBJECTS_FIRSTGID];
    if (!key) return null;
    return { key, isObject: true, solid: !isDecal(key), tall: isTall(key), flipH, flipV, flipD };
  }
  const key = tiles[gid - TILES_FIRSTGID];
  if (!key) return null;
  return { key, isObject: false, solid: false, tall: false, flipH, flipV, flipD };
}

/** Basename for a track-layer gid (asphalt tile), for collision lookup. */
export function trackTileName(rawGid: number): string | null {
  const r = resolveGid(rawGid);
  return r && !r.isObject ? r.key : null;
}
