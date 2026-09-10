import type Phaser from 'phaser';
import roadWalls from '../assets/road_walls.json';
import type { CollisionData, RacingLineData, TmjMap } from './types';

/** Per-tile wall atlas: tile basename → convex parts (tile-local coords). */
export interface RoadWalls {
  tileSize: number;
  tiles: Record<string, number[][][]>;
}

export function getRoadWalls(): RoadWalls {
  return roadWalls as RoadWalls;
}

/**
 * Runtime asset registry. Tile/object PNGs are pulled via Vite globs (keyed by
 * bare basename, e.g. `road_asphalt04`) so we don't hand-list 170+ files, and
 * the Tiled maps are imported as raw text (kept at the game root so Tiled can
 * still edit them against racing.tsj/objects.tsj).
 */

// eager URL maps: glob path → bundled url
const tileUrls = import.meta.glob('../assets/tiles/**/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const objectUrls = import.meta.glob('../assets/objects/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const carUrls = import.meta.glob('../assets/cars/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const particleUrls = import.meta.glob('../assets/particles/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/**
 * Powerup icons, in a folder of their own and deliberately NOT in
 * `assets/objects/`: that folder's basenames are sorted into Tiled gids
 * (`orderedObjectBasenames()`, gid = 133 + index), so dropping a file in there
 * shifts every gid after it alphabetically and silently breaks all five baked
 * track maps. `oil.png` stays where it is — it shipped in the object set and is
 * already part of that order.
 */
const powerupUrls = import.meta.glob('../assets/powerups/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const trackThumbUrls = import.meta.glob('../assets/tracks/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const mapRaw = import.meta.glob('../../track*.tmj', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const collisionData = import.meta.glob('../../track*.collision.json', {
  eager: true,
  import: 'default',
}) as Record<string, CollisionData>;

const pathData = import.meta.glob('../../track*.path.json', {
  eager: true,
  import: 'default',
}) as Record<string, RacingLineData>;

const basename = (path: string): string => path.split('/').pop()!.replace(/\.png$/, '');

/** Surface subfolder order MUST match make_tiled.py collect() → gid order. */
const SURFACE_ORDER = ['asphalt', 'grass', 'sand', 'dirt'] as const;

/** Ordered tile basenames (asphalt→grass→sand→dirt, sorted) — id = index. */
export function orderedTileBasenames(): string[] {
  const out: string[] = [];
  for (const surface of SURFACE_ORDER) {
    const names = Object.keys(tileUrls)
      .filter((p) => p.includes(`/tiles/${surface}/`))
      .map(basename)
      .sort();
    out.push(...names);
  }
  return out;
}

/** Ordered object basenames (sorted) — id = index, gid = 133 + id. */
export function orderedObjectBasenames(): string[] {
  return Object.keys(objectUrls).map(basename).sort();
}

/** Queue every tile + object + car texture into a scene loader (keys = basenames). */
export function preloadTextures(scene: Phaser.Scene): void {
  const all = { ...tileUrls, ...objectUrls, ...carUrls };
  for (const [path, url] of Object.entries(all)) {
    const key = basename(path);
    if (!scene.textures.exists(key)) scene.load.image(key, url);
  }

  // Particles are the one set keyed `rc-*` rather than bare. Tile, object and
  // car keys CANNOT be prefixed — the Tiled maps name them — but a particle key
  // is only ever written by hand in fx.ts, and names like `smoke` are generic
  // enough to collide with the shared set `loadImages()` puts in this same
  // texture manager. Globbed like the rest, so adding art is dropping a file in.
  for (const [path, url] of Object.entries(particleUrls)) {
    const key = `rc-${basename(path)}`;
    if (!scene.textures.exists(key)) scene.load.image(key, url);
  }

  // Powerup icons, keyed `rc-pu-<kind>` for the same reason: these are only ever
  // named by hand in powerups/defs.ts, so they get the prefix that tile, object
  // and car keys cannot have.
  for (const [path, url] of Object.entries(powerupUrls)) {
    const key = powerupIconKey(basename(path).replace(/^powerup_/, ''));
    if (!scene.textures.exists(key)) scene.load.image(key, url);
  }
}

/** Texture key for a powerup icon (`freeze` → `rc-pu-freeze`). */
export const powerupIconKey = (kind: string): string => `rc-pu-${kind}`;

/** Sorted car texture keys (car_1…car_4). */
export function carKeys(): string[] {
  return Object.keys(carUrls).map(basename).sort();
}

/** Car texture key for a player index (wraps if fewer sprites than players). */
export function carKey(playerIndex: number): string {
  const keys = carKeys();
  return keys[playerIndex % keys.length];
}

/** Parse and return a track's Tiled map (1-based track number). */
export function getTrackMap(trackNumber: number): TmjMap {
  const entry = Object.entries(mapRaw).find(([p]) => p.endsWith(`track${trackNumber}.tmj`));
  if (!entry) throw new Error(`racing: track${trackNumber}.tmj not found`);
  return JSON.parse(entry[1]) as TmjMap;
}

/** Baked collision walls for a track (1-based), or null if not yet baked. */
export function getTrackCollision(trackNumber: number): CollisionData | null {
  const entry = Object.entries(collisionData).find(([p]) =>
    p.endsWith(`track${trackNumber}.collision.json`),
  );
  return entry ? entry[1] : null;
}

/** Baked racing line for a track (1-based), or null if not yet baked. */
export function getTrackPath(trackNumber: number): RacingLineData | null {
  const entry = Object.entries(pathData).find(([p]) => p.endsWith(`track${trackNumber}.path.json`));
  return entry ? entry[1] : null;
}

/** Texture key for a track's menu thumbnail. */
export const trackThumbKey = (trackIndex: number): string => `track-thumb-${trackIndex + 1}`;

/** Queue the track thumbnail images (trackN.png → key track-thumb-N). */
export function preloadTrackThumbs(scene: Phaser.Scene): void {
  for (const [path, url] of Object.entries(trackThumbUrls)) {
    const n = basename(path).replace(/^track/, '');
    const key = `track-thumb-${n}`;
    if (!scene.textures.exists(key)) scene.load.image(key, url);
  }
}
