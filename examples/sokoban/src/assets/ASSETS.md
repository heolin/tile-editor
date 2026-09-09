# Box Depot art

Game-specific PNGs from **Kenney Sokoban Pack** (CC0, `art/License.txt`),
bundled by Vite. Shared UI art — buttons, panels, arrows, avatars — comes free
via `loadImages()`; don't copy any of it here.

Every key is `sk-` + the file's basename (`sk-crate_red`, `sk-wall_grey_brick`),
so nothing can collide with the shared set in the same texture manager. That
derivation is also the join between Tiled and the game: the level loader turns a
tileset image path into a key the same way, so a tile placed in the editor finds
its texture with nothing in between.

Every file here is **128x128**. A cell, though, is **128x96** — and that 32 px
difference is the whole look of the board, so it is worth reading before
redrawing anything here.

The board is a ground plane seen at an angle, with things standing on it:

- **Ground** — `ground/`, `goals/` — is squashed into the 128x96 cell. It tiles,
  so it must not be cut, and a squashed goal marker reads as one lying on a
  foreshortened floor.
- **Standing** — `walls/`, `crates/`, `player/`, `items/` — keeps its full
  128 px and is anchored to the BOTTOM of its cell, so it rises 32 px into the
  row behind it. Drawn in row order, a vertical run of walls shows one front
  face, at the bottom, and a player standing behind a wall is half hidden by it.

Nothing is clipped and nothing was redrawn for this. The 32 px is also why the
bottom band of a wall or a crate is load-bearing: that is the face that stays
visible, and a piece redrawn with a taller or shorter front will not line up
with the rest.

**The level files know nothing about any of this.** A `.tmj` is a square 128 px
grid, which is what a Sokoban board is — cells, four directions, one step each
— and Tiled shows it square. The projection is applied when the board is drawn,
by the game and by the thumbnail baker, and by nothing else.

The board is then scaled to the screen as a whole, to 90% of its width.

The files were **renamed on the way in** — the pack names everything
`crate_07.png`, which says nothing about what it is. The table under each
heading is the mapping back to the pack, so a piece can be re-cut from the
original if it is ever redrawn.

## The five colours

`brown`, `red`, `blue`, `green`, `grey`, in that order everywhere: the HUD row,
the tileset, and the loader's colour list. A level's crates and goals are keyed
by colour and nothing else — a crate satisfies any goal of its own colour.

## `art/crates/`

Three pictures per colour, one placed and two derived:

| file | pack | drawn when |
| --- | --- | --- |
| `crate_<colour>.png` | `crate_02..06` | the crate is loose |
| `crate_<colour>_done.png` | `crate_12..16` | it is standing on a goal of its colour |
| `crate_<colour>_sunk.png` | `crate_37..41` | it has been pushed into a pit |

Only the first is in the Tiled tileset. The other two are found by name at
runtime, so a missing one is a load-time error rather than a crate that quietly
never changes.

## `art/goals/`

| file | pack | what it is |
| --- | --- | --- |
| `goal_<colour>.png` | `crate_27..31` | the crate outline: where a crate of that colour goes |
| `spot_<colour>.png` | `environment_02, 05, 08, 10, 14` | the same rule drawn small, for a board with no room |
| `hole_<colour>.png` | `environment_01, 04, 07, 09, 13` | a pit that is also a goal: it wants that colour |
| `hole.png` | `environment_15` | a plain pit. Not a goal — terrain a crate is lost in, and a bridge once one is |

`goal_*` and `spot_*` are two pictures of one rule; place whichever reads better
on the board.

## `art/walls/`

Four of the pack's eight:

| file | pack |
| --- | --- |
| `wall_red.png` | `block_01` |
| `wall_brick.png` | `block_02` |
| `wall_concrete.png` | `block_03` |
| `wall_brown.png` | `block_04` |

All four behave identically; which one a board uses is a look, not a rule. The
other four (`block_05..08`) are variants of the same four colours and are
deliberately not copied.

## `art/ground/`

`ground_green`, `ground_grey`, `ground_brown` — `ground_03, 04, 05`. Placed per
cell rather than tiled behind the board, because a Sokoban board is a shape
rather than a rectangle: **a cell with no floor tile is as solid as a wall.**

The imported boards nonetheless carry ground on **every** cell, walls included.
The wall art has rounded corners that would otherwise show the page through
them, and a puzzle whose shape does not fill its bounding box would sit in a
black hole. A hand-drawn board can still leave the floor out where it wants an
edge with nothing beyond it.

## `art/player/`

`player_<down|up|right|left>_<1|2|3>.png` — `player_03..05`, `06..08`,
`15..17`, `18..20`.

Frame 1 is the standing pose and is what the tileset places as the start cell;
2 and 3 are the two steps, alternating one per move. If that reading of the
pack is wrong the walk will look off — it is three files per direction and
nothing else depends on the order.

## `art/hud/`

`hud_<colour>.png` and `hud_<colour>_done.png` — `crate_42..45` and `crate_01`
for the loose glyph, `crate_07..11` for the done glyph. One glyph per goal on
the board, in rows of five, so the player can see how many are left without
counting crates.

These are never placed on a board and are deliberately absent from the tileset.

## `art/items/coin.png`

`environment_12`. Walking over one collects it; the ten gold it is worth is
paid when the level is finished, not when it is picked up, so a coin taken on a
board that is then reset was never taken. `environment_11` is the same coin at
another angle and is not copied — a second frame is one line here and one in
`fx.ts` if the coin should ever spin.

---

## Levels

`games/sokoban/levels/*.tmj`, edited in Tiled against `sokoban.tsj`. The
tileset, the project file and `template.tmj` are **generated** by
`tools/sokoban-tiled/make_tiled.py` — re-run it rather than editing them, and
read the warning in its docstring about tile order before adding art.

`micro-*.tmj` are **generated too**, by `tools/sokoban-tiled/import_microban.py`
from **Microban, by David W. Skinner** — 155 puzzles, taken from the level sets
in David Joffe's Still Yet Another Sokoban (`github.com/davidjoffe/sokoban`).

Skinner's terms are *"These sets may be freely distributed provided they remain
properly credited"*, so **the credit is a condition of shipping them**. Each
level still carries a `source` property naming the set, the author and the
puzzle number — but **nothing in the game displays it any more**. The line was
on the HUD and then on the picker, and both were removed as clutter once the
plan became to draw our own boards.

So these boards are development scaffolding and **must not ship as they are**.
Either they go before release, or the credit comes back somewhere a player can
see it. That is written down in `TODO.md` as well as here.

The original 1982 Thinking Rabbit set is deliberately NOT used. It is the set
most Sokoban ports carry, some of them calling it public domain, but that claim
comes from the ports rather than from the rights holder — and its puzzles are
10 to 34 crates on boards half of which do not fit a phone.

Re-running the importer deletes and rewrites every `micro-*.tmj`, so a board
worth keeping has to be saved under another name.

---

Vite inlines assets under 4 KB as data URIs, so only the larger files show up in
`dist/assets` — that is expected, not a missing asset.
