# Racing art

Game-specific PNGs. Shared UI art (buttons, panels, characters) comes free via
`loadImages()` — don't copy those here.

Unlike the other games, most of this folder is **not** hand-listed: `track-assets.ts`
pulls tiles, objects, cars, particles, powerups and track thumbnails through Vite
globs, so adding art is dropping a file in the right folder. Which folder decides
both the texture key and, for two of them, a good deal more.

## Layout

| folder | count | size | texture key | notes |
|---|---|---|---|---|
| `tiles/asphalt` | 90 | 128×128 | bare basename | **order is load-bearing** — see below |
| `tiles/grass` | 14 | 128×128 | bare basename | " |
| `tiles/sand` | 14 | 128×128 | bare basename | " |
| `tiles/dirt` | 14 | 128×128 | bare basename | " |
| `objects/` | 39 | various | bare basename | **order is load-bearing** — see below |
| `cars/` | 4 | 39×65 | bare basename | normalised to `CAR.DISPLAY_LENGTH` at runtime |
| `particles/` | 1 | — | `rc-<basename>` | |
| `powerups/` | 4 | 160×160 | `rc-pu-<kind>` | `powerup_` is stripped from the filename |
| `tracks/` | 5 | — | `track-thumb-N` | menu thumbnails |
| `audio/` | 13 | — | `rc-*` | see `../sounds.ts` and `docs/sounds.md` |

`road_walls.json` is **generated** by `tools/track-mesh/` — do not hand-edit it.
Re-run the tool and eyeball its overlays.

## The two folders where filenames are a contract

`tiles/` and `objects/` are indexed into **Tiled gids** by sort order, in
`orderedTileBasenames()` and `orderedObjectBasenames()`: tile id = index across
`asphalt → grass → sand → dirt`, each sorted; object gid = `133 + index` into the
sorted object list. The five baked `trackN.tmj` maps refer to those numbers.

So **adding or renaming a file in either folder renumbers everything after it
alphabetically and silently breaks every track.** A file that merely needs to be
*drawn* — a powerup icon, a particle — belongs in a folder of its own, which is
why `powerups/` exists rather than being four more entries in `objects/`.

Tile and object keys also cannot take the `rc-` prefix the rest of this game's
art uses, because the Tiled maps name them. Everything hand-named in code does
take it, so a generic name like `smoke` can't collide with the shared set in the
same texture manager.

`TALL_PREFIXES` in `constants.ts` (`tree`, `tent`, `tribune`, `light`) decides
which objects draw *above* the cars. Object art is matched by name prefix, so a
new tall prop has to be named to match or it will render under the traffic.

## Powerups

Four 160×160 RGBA icons, one per kind, keyed `rc-pu-freeze`, `rc-pu-oil`,
`rc-pu-replace`, `rc-pu-speed` (`powerup_` stripped, see `powerupIconKey`). They
are drawn at `POWERUP.ICON_PX` and sit at `DEPTH.objLow`, under the cars, because
a pickup is something you drive *over*. `docs/powerups.md` covers the rest.

The oil slicks reuse `objects/oil.png` rather than carrying their own art — it
was already in the object set, and moving it out would renumber every gid after
it.

**Keep these as RGBA.** They were originally 8-bit palette PNGs with per-entry
`tRNS` alpha, which decodes fine but opens in GIMP as an *Indexed* image, where
every edit re-quantises into a 256-entry palette that is nearly half
semi-transparent edge colours. Converting to RGBA costs a few KB at these sizes
and Phaser uploads them as RGBA either way.

## Licensing

Tiles, objects and cars are Kenney's *Racing Pack* (from
`Kenney Game Assets All-in-1 3.6.0`), **CC0** — free for commercial use, credit
appreciated but not required. See `docs/racing-track-collision.md` for how the
tiles became walls.

> **The powerup icons have no recorded source.** Every other game with copied
> third-party art keeps a `License.txt` beside it (`games/hop-up/src/assets/`,
> `games/merge-zoo/src/assets/animals/`). If these four came from a pack, add one
> here naming it; if they were drawn for this project, say that instead. Until
> one of those is true this folder is the only art in the repo whose licence
> nobody can check.

Every sound file in this folder is a **synthesised placeholder** from
`tools/sfx/generate.py`. The keys are the contract, the files are not.
