# Tilt Ball art

Game-specific PNGs from **Kenney Rolling Ball Assets** (CC0, `art/License.txt`),
bundled by Vite. Shared UI art — buttons, panels, arrows, avatars — comes free
via `loadImages()`; don't copy any of it here.

Every key is `tb-` + the file's basename (`tb-block_square`, `tb-hole_start`),
so nothing can collide with the shared set in the same texture manager. That
derivation is also the join between Tiled and the game: the level loader turns a
tileset image path into a key the same way, so a tile placed in the editor finds
its texture with nothing in between.

**Loaded by glob**, not by one import line per file (`assets.ts`): the list of
art files is already written down in `tools/tilt-ball-tiled/make_tiled.py`,
which is the copy Tiled reads, and a second hand-maintained one would drift.

## `art/balls/`

`ball_<colour>_<size>.png` — 64 px small, 128 px large, four colours in
`PLAYER_COLORS` order (blue, red, green, orange) so a player's ball matches
their lobby swatch.

**Blue and red ship with the pack. Green and orange are GENERATED** by
`tools/recolor/tilt-ball.sh` from the blue ball — never hand-edit them; edit the
script's target hues and re-run.

## `art/blocks/`

26 wall pieces: plain, `_bouncy`, `_locked` (in yellow, `_orange` and `_pink`),
and the two `_rotate` ones. Sizes are 64/128/256 combinations, all multiples of
the 64 px grid.

The rectangular ones are drawn as a **nine-slice** whenever a level stretches
them, so their rounded corners, lit edge and rivets keep the size they were
drawn at. That makes the corner-most 32 px of each edge load-bearing: redraw a
block with its rivets further in and every stretched copy of it in every level
changes shape.

Their colliders are baked to `block-bodies.json` by `tools/ball-bodies/bake.py`
— one convex hull each, art-local, origin at the centre. **Generated: re-run the
tool and eyeball `tools/ball-bodies/bake-out/` rather than editing the JSON.**

## `art/holes/`

`hole` (96) and `hole_large` (160) kill; `hole_*_end` are goals and
`hole_*_end_locked` are goals that need the yellow key; `hole_start` is a spawn
ring. The visible pit is smaller than the plate — 36 px and 68 px radius, which
is where `HOLE_RADIUS` in `constants.ts` comes from.

## `art/key*.png`

Three key colours (the default art is **yellow**, not blue), plus `key_outline`
which is the HUD's "not found yet" glyph and is never placed on a board.

## `art/lasers/`

`laser_shooter_start` and `_end` are the two ends of a beam and point UP at
rotation 0. `laser_<colour>.png` is the beam itself — a uniform 18 px strip in a
70 px tile, every row the same, so it stretches to any length and is **never
placed by hand**: the game draws it between the two emitters of its colour.

`laser_switch_<Colour><On|Off>.png` are the levers, one pair per colour. Both
halves of a pair must exist: the runtime swaps between them when a ball throws
the lever, deriving the key from the colour and the state, so a missing file is
a texture that silently does not change.

The eight lever files came off the pack's sheet with a 1 px line of the
neighbouring tile along their top edge. It was cleared by hand in all eight —
if the set is ever re-cut, check row 0 before shipping it.

## `art/background_*.png`

128 px tiles for the floor, chosen per level by its `background` map property.

## `art/decorations/`

Pictures that lie on the floor and do nothing at all — no body, no rule, no
property. `arrow_sign` and `warning_sign` are 140 px tiles.

`darkgray.png` is one 64 px cell of flat #323232, meant to be stretched in Tiled
over a rectangle of floor. Unlike `void.png` it is only a picture: the ball rolls
over it and does not fall.

## `art/obstacles/`

`spikes` and the two saws kill on contact; what each kills with is measured off
the art and written down in `OBSTACLES` (`src/constants.ts`), never derived from
the tile's size — every one of them is smaller than its tile. **Those numbers are
in that art's own pixels**, so rescaling a picture here means re-measuring its
entry: `spikes` and both rails are 128 px (two cells), the saws are still 140.

The saws are **two frames each**: `chainsaw_half_1`/`_2` and
`chainsaw_full_1`/`_2`. Only frame 1 is a tile in the tileset; the runtime finds
the other by name, and throws at load if it is missing rather than drawing a
missing-texture square every other 90 ms.

`chainsaw_rail` and `chainsaw_rail_edge` are the track a saw rides, and their
geometry is a contract with `src/level/rails.ts`: **the track runs through the
centre of the tile and leaves through the middle of an edge** — straight left to
right, corner left to bottom. Redraw them off that centreline and every rail in
every level bends somewhere else.

## `art/void.png`

One black 64 px cell — the missing floor. **Generated** by
`tools/tilt-ball-tiled/make_tiled.py` (it is a flat fill, and there is nothing
like it in the pack), but it has to exist as a file because Tiled's tileset is a
collection of images and a tile with no image cannot be placed.

Placed in Tiled and stretched over whole cells; the rounded corners where it
meets the floor are drawn by the game from the grid, not by this art. See §4 of
`docs/tilt-ball-plan.md`.

## `assets/thumbs/`

One picture per level for the setup screen, **generated** by
`tools/tilt-ball-thumbs/bake.py`. Re-run it whenever a level changes.

---

Vite inlines assets under 4 KB as data URIs, so only the larger files show up in
`dist/assets` — that is expected, not a missing asset.
