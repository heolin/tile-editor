import type Phaser from 'phaser';
import { textureKey } from './level/tiled';
import type { CrateColour } from './level/types';
import type { Direction } from './board';

/**
 * This game's art, keyed `sk-*` so nothing can collide with the shared set in
 * the page-level texture manager — the rule every game here follows.
 *
 * Pulled in with a Vite glob rather than one import line per file: the art is
 * the Tiled tileset's contents plus the pieces the game derives, and that list
 * is already written down in `tools/sokoban-tiled/make_tiled.py`. Two
 * hand-maintained copies of it would drift.
 *
 * The key for a piece of art is `sk-` + its basename, the same derivation the
 * level loader applies to a tileset image path — that is the join between "what
 * Tiled placed" and "what texture to draw".
 */
const artUrls = import.meta.glob('./assets/art/**/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const thumbUrls = import.meta.glob('./assets/thumbs/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const stem = (path: string): string => (path.split('/').pop() ?? path).replace(/\.png$/i, '');

/** Queue every piece of this game's art. Idempotent per scene. */
export function loadSokobanImages(scene: Phaser.Scene): void {
  for (const [path, url] of Object.entries(artUrls)) {
    const key = textureKey(stem(path));
    if (!scene.textures.exists(key)) scene.load.image(key, url);
  }
}

/** Texture key of a level's picker thumbnail. */
export const thumbKey = (levelId: string): string => `sk-thumb-${levelId}`;

/**
 * Queue the baked level thumbnails (`tools/sokoban-thumbs`). Only the picker
 * needs these, and it is the one screen that must NOT load a level's worth of
 * textures just to show a picture of it.
 */
export function loadLevelThumbs(scene: Phaser.Scene): void {
  for (const [path, url] of Object.entries(thumbUrls)) {
    const key = thumbKey(stem(path));
    if (!scene.textures.exists(key)) scene.load.image(key, url);
  }
}

export function hasThumb(levelId: string): boolean {
  return Object.keys(thumbUrls).some((path) => stem(path) === levelId);
}

/**
 * The three faces of a crate. Only the loose one is placed in Tiled; the other
 * two are found by name, which is why they must keep these names.
 */
export const crateKey = (colour: CrateColour): string => textureKey(`crate_${colour}`);
export const crateDoneKey = (colour: CrateColour): string => textureKey(`crate_${colour}_done`);
export const crateSunkKey = (colour: CrateColour): string => textureKey(`crate_${colour}_sunk`);

/** The HUD's goal glyphs: one per goal, filled or not. */
export const hudKey = (colour: CrateColour, done: boolean): string =>
  textureKey(`hud_${colour}${done ? '_done' : ''}`);

/**
 * Walk frames. Frame 1 is standing; 2 and 3 are the steps, and the walk
 * alternates between them one per move rather than running a cycle — a step
 * takes a fixth of a second and a two-frame cycle inside it reads as a twitch.
 */
export const playerKey = (colour: PlayerColour, facing: Direction, frame: 1 | 2 | 3): string =>
  textureKey(`player_${colour}_${facing}_${frame}`);

/**
 * The seats' colours, in `PLAYER_COLORS` order so a player's character matches
 * the swatch the lobby gave them. Green ships with the pack; blue is generated
 * by `tools/recolor/sokoban.sh` and is never hand-edited.
 */
export const PLAYER_COLOURS = ['green', 'blue'] as const;
export type PlayerColour = (typeof PLAYER_COLOURS)[number];

export function playerColour(seat: number): PlayerColour {
  const colour = PLAYER_COLOURS[seat];
  // Two colours, and a co-op board takes exactly two players — a third seat
  // here would be a roster the game never agreed to.
  if (colour === undefined) throw new Error(`sokoban: no colour for seat ${seat}`);
  return colour;
}

export const COIN_KEY = textureKey('coin');
