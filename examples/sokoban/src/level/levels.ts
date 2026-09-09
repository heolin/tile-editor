import { parseLevel, parseTileset } from './tiled';
import type { LevelMode, LevelSpec, TileDef } from './types';

/**
 * The level registry: every `.tmj` in `levels/`, parsed once and kept.
 *
 * Levels live at the game root next to `sokoban.tsj` (rather than under
 * `src/assets/`) because Tiled has to open them against that tileset by
 * relative path — the same arrangement Tilt Ball and racing use.
 *
 * Parsing is eager and total. Every level is validated the first time anything
 * asks for one, so a board with a goal nobody can fill fails on the picker
 * instead of two taps later.
 */

const levelRaw = import.meta.glob('../../levels/*.tmj', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const tilesetRaw = import.meta.glob('../../sokoban.tsj', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

let cache: LevelSpec[] | null = null;

function tileset(): Map<number, TileDef> {
  const raw = Object.values(tilesetRaw)[0];
  if (raw === undefined) throw new Error('sokoban: sokoban.tsj not found');
  return parseTileset(raw);
}

function all(): LevelSpec[] {
  if (cache !== null) return cache;
  const tiles = tileset();
  const parsed: LevelSpec[] = [];
  for (const [path, raw] of Object.entries(levelRaw)) {
    const id = (path.split('/').pop() ?? path).replace(/\.tmj$/i, '');
    // The blank board the tool emits for authors to copy. It has no start and
    // no crates, so it is not a level — but it must keep living next to the
    // levels, because Tiled opens it against the tileset by relative path.
    if (id === 'template') continue;
    parsed.push(parseLevel(id, raw, tiles));
  }
  // Alphabetical on the id, which is why the files are named `07_story`: the
  // file name IS the order, and the unlock ladder counts along it. Each ladder
  // is numbered from 1 on its own, and `levelsFor` filters by mode before
  // anything counts, so the two 07s never meet.
  parsed.sort((a, b) => a.id.localeCompare(b.id));
  if (parsed.length === 0) throw new Error('sokoban: no levels');
  cache = parsed;
  return parsed;
}

export function allLevels(): LevelSpec[] {
  return all();
}

/**
 * The boards of one mode, in order. The two ladders are separate lists and
 * separate progress, so board 3 of story and board 3 of co-op are two boards.
 */
export function levelsFor(mode: LevelMode): LevelSpec[] {
  return all().filter((level) => level.mode === mode);
}

export function levelAt(mode: LevelMode, index: number): LevelSpec {
  const level = levelsFor(mode)[index];
  if (level === undefined) throw new Error(`sokoban: no ${mode} level at ${index}`);
  return level;
}

export function levelById(id: string): LevelSpec {
  const found = all().find((level) => level.id === id);
  if (found === undefined) throw new Error(`sokoban: no level '${id}'`);
  return found;
}
