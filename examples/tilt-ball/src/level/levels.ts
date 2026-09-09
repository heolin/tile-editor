import { parseLevel, parseTileset } from './tiled';
import type { LevelMode, LevelSpec, TileDef } from './types';

/**
 * The level registry: every `.tmj` in `levels/`, parsed once and kept.
 *
 * Levels live at the game root next to `tiltball.tsj` (rather than under
 * `src/assets/`) because Tiled has to open them against that tileset with a
 * relative path — the same arrangement racing uses for its tracks.
 *
 * Parsing is eager and total. Every level is validated the first time anything
 * asks for one, so a level with a broken laser or a stale gid fails on the
 * setup screen instead of two taps later, in front of four players.
 */

const levelRaw = import.meta.glob('../../levels/*.tmj', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const tilesetRaw = import.meta.glob('../../tiltball.tsj', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

let cache: LevelSpec[] | null = null;

function tileset(): Map<number, TileDef> {
  const raw = Object.values(tilesetRaw)[0];
  if (raw === undefined) throw new Error('tilt-ball: tiltball.tsj not found');
  return parseTileset(raw);
}

function all(): LevelSpec[] {
  if (cache !== null) return cache;
  const tiles = tileset();
  const parsed: LevelSpec[] = [];
  for (const [path, raw] of Object.entries(levelRaw)) {
    const id = (path.split('/').pop() ?? path).replace(/\.tmj$/i, '');
    // The blank map the tool emits for authors to copy. It has no start and no
    // goal, so it is not a level — but it must keep living next to the levels,
    // because Tiled opens it against the tileset by relative path.
    if (id === 'template') continue;
    parsed.push(parseLevel(id, raw, tiles));
  }
  // Alphabetical on the id, which is why the files are numbered `story-01`:
  // the file name IS the story order, and the unlock ladder counts along it.
  parsed.sort((a, b) => a.id.localeCompare(b.id));
  cache = parsed;
  return parsed;
}

export function levelsFor(mode: LevelMode): LevelSpec[] {
  return all().filter((level) => level.mode === mode);
}

export function levelById(id: string): LevelSpec {
  const found = all().find((level) => level.id === id);
  if (found === undefined) throw new Error(`tilt-ball: no level '${id}'`);
  return found;
}

/**
 * `count` versus boards, drawn without replacement, in the order drawn.
 *
 * Versus used to play the first `count` boards in id order, so every series
 * after the first was the series before it. The draw lives here rather than in
 * the setup screen because this is the module that knows how many boards there
 * are — and it refuses a `count` that does not fit rather than returning a
 * short queue, which would show up as a series that ends early.
 */
export function randomVersusQueue(count: number): string[] {
  const pool = levelsFor('versus').map((level) => level.id);
  if (count < 1 || count > pool.length) {
    throw new Error(`tilt-ball: asked for ${count} versus boards, there are ${pool.length}`);
  }
  // Fisher-Yates, over the copy `map` already made.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = swap;
  }
  return pool.slice(0, count);
}

/** Every level, in id order. For the thumbnail baker's tests and for counting. */
export function allLevels(): LevelSpec[] {
  return all();
}
