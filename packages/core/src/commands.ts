import { DenseLayerData } from './layer-data.js'
import type { Frame, Layer, MapObject, Property, Tile, TileLayer, TileMap, Tileset, TilesetRef } from './model.js'
import type { Stamp, TileRegion } from './tiles.js'
import { walkLayers } from './model.js'

/**
 * Undo is semantic, not a diff of application state: each edit knows what it
 * did and how to take it back. Strokes merge so that dragging a brush across
 * forty tiles is one undo step, not forty (docs/PLAN.md section 3).
 */
export interface EditCommand {
  readonly label: string
  /** Consecutive commands sharing a key collapse into one history entry. */
  readonly mergeKey?: string
  apply(): void
  revert(): void
  /** Absorbs a following command with the same mergeKey. Returns false to refuse. */
  absorb?(next: EditCommand): boolean
}

export class History {
  private past: EditCommand[] = []
  private future: EditCommand[] = []
  private listeners = new Set<() => void>()
  private savedDepth = 0

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  get dirty(): boolean {
    return this.past.length !== this.savedDepth
  }

  get undoLabel(): string | undefined {
    return this.past[this.past.length - 1]?.label
  }

  get redoLabel(): string | undefined {
    return this.future[this.future.length - 1]?.label
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private notify(): void {
    for (const fn of this.listeners) fn()
  }

  run(command: EditCommand): void {
    command.apply()
    const last = this.past[this.past.length - 1]
    if (last && command.mergeKey && last.mergeKey === command.mergeKey && last.absorb?.(command)) {
      this.future = []
      this.notify()
      return
    }
    this.past.push(command)
    this.future = []
    this.notify()
  }

  undo(): void {
    const command = this.past.pop()
    if (!command) return
    command.revert()
    this.future.push(command)
    this.notify()
  }

  redo(): void {
    const command = this.future.pop()
    if (!command) return
    command.apply()
    this.past.push(command)
    this.notify()
  }

  markSaved(): void {
    this.savedDepth = this.past.length
    this.notify()
  }

  /**
   * Declares the document out of step with the file without any command having
   * run - the case when a restored draft replaces what is on disk.
   */
  markUnsaved(): void {
    this.savedDepth = -1
    this.notify()
  }

  clear(): void {
    this.past = []
    this.future = []
    this.savedDepth = 0
    this.notify()
  }
}

/* ------------------------------------------------------------------ */
/* Concrete edits                                                      */
/* ------------------------------------------------------------------ */

interface CellEdit {
  x: number
  y: number
  before: number
  after: number
}

/** Paints tiles, remembering only the cells that actually changed. */
export class SetTilesCommand implements EditCommand {
  readonly mergeKey: string
  private edits: CellEdit[] = []
  private index = new Set<string>()

  /**
   * `mask` is the user's tile selection: while one is up, every tool writes
   * inside it and nowhere else, so a stray drag cannot spill over the edge.
   */
  constructor(
    readonly label: string,
    private layer: TileLayer,
    strokeId: string,
    private mask?: TileRegion,
  ) {
    this.mergeKey = `tiles:${layer.id}:${strokeId}`
  }

  /** Records an intended change; call before apply(). */
  add(x: number, y: number, gid: number): void {
    if (!this.writable(x, y)) return
    const key = `${x},${y}`
    if (this.index.has(key)) return
    const before = this.layer.data.get(x, y)
    if (before === gid) return
    this.index.add(key)
    this.edits.push({ x, y, before, after: gid })
  }

  /**
   * Cells the layer does not cover would be dropped on apply() anyway, so
   * recording them would only make an all-miss stroke look like a real edit.
   */
  private writable(x: number, y: number): boolean {
    const m = this.mask
    if (m && (x < m.x || y < m.y || x >= m.x + m.width || y >= m.y + m.height)) return false
    const b = this.layer.data.bounds
    return x >= b.x && y >= b.y && x < b.x + b.width && y < b.y + b.height
  }

  get empty(): boolean {
    return this.edits.length === 0
  }

  apply(): void {
    for (const e of this.edits) this.layer.data.set(e.x, e.y, e.after)
  }

  revert(): void {
    for (let i = this.edits.length - 1; i >= 0; i--) {
      const e = this.edits[i]!
      this.layer.data.set(e.x, e.y, e.before)
    }
  }

  absorb(next: EditCommand): boolean {
    if (!(next instanceof SetTilesCommand) || next.layer !== this.layer) return false
    for (const e of next.edits) {
      const key = `${e.x},${e.y}`
      if (this.index.has(key)) {
        const existing = this.edits.find((c) => c.x === e.x && c.y === e.y)!
        existing.after = e.after
      } else {
        this.index.add(key)
        this.edits.push(e)
      }
    }
    return true
  }
}

/**
 * A block of tiles picked up and put down somewhere else. Unlike a paint
 * stroke this is one gesture with a changing answer, so the command is built
 * once and re-aimed with `setDelta` while the drag is in flight; only the
 * position it is let go at reaches the history.
 */
export class MoveTilesCommand implements EditCommand {
  readonly label: string
  readonly mergeKey: string | undefined
  private touched: { x: number; y: number; before: number }[] = []
  private dx = 0
  private dy = 0
  private live = false

  constructor(
    private layer: TileLayer,
    private region: TileRegion,
    private stamp: Stamp,
    private copy = false,
    mergeKey?: string,
  ) {
    this.label = copy ? 'Skopiuj blok' : 'Przesuń blok'
    this.mergeKey = mergeKey
  }

  get delta(): { x: number; y: number } {
    return { x: this.dx, y: this.dy }
  }

  get moved(): boolean {
    return this.dx !== 0 || this.dy !== 0
  }

  /** Where the block sits now, for drawing the selection that follows it. */
  get target(): TileRegion {
    return { ...this.region, x: this.region.x + this.dx, y: this.region.y + this.dy }
  }

  /** Re-aims a move already on screen; safe to call on every pointer move. */
  setDelta(dx: number, dy: number): void {
    if (this.live) this.revert()
    this.dx = dx
    this.dy = dy
    this.apply()
  }

  apply(): void {
    this.touched = []
    const bounds = this.layer.data.bounds
    const write = (x: number, y: number, gid: number) => {
      if (x < bounds.x || y < bounds.y || x >= bounds.x + bounds.width || y >= bounds.y + bounds.height) return
      this.touched.push({ x, y, before: this.layer.data.get(x, y) })
      this.layer.data.set(x, y, gid)
    }
    // Source first: where it overlaps the destination the write below wins, and
    // reverting walks backwards so the original value is still the one restored.
    if (!this.copy) {
      for (let y = 0; y < this.region.height; y++) {
        for (let x = 0; x < this.region.width; x++) write(this.region.x + x, this.region.y + y, 0)
      }
    }
    for (let y = 0; y < this.stamp.height; y++) {
      for (let x = 0; x < this.stamp.width; x++) {
        write(this.region.x + this.dx + x, this.region.y + this.dy + y, this.stamp.gids[y * this.stamp.width + x] ?? 0)
      }
    }
    this.live = true
  }

  revert(): void {
    for (let i = this.touched.length - 1; i >= 0; i--) {
      const cell = this.touched[i]!
      this.layer.data.set(cell.x, cell.y, cell.before)
    }
    this.live = false
  }
}

export class AddObjectCommand implements EditCommand {
  readonly label: string
  private nextObjectId: number

  constructor(
    private layer: { objects: MapObject[] },
    private objects: MapObject | MapObject[],
    private map: TileMap,
  ) {
    this.label = Array.isArray(objects) && objects.length > 1 ? `Dodaj ${objects.length} obiektów` : 'Dodaj obiekt'
    this.nextObjectId = map.nextobjectid
  }

  private get added(): MapObject[] {
    return Array.isArray(this.objects) ? this.objects : [this.objects]
  }

  apply(): void {
    for (const object of this.added) {
      this.layer.objects.push(object)
      this.map.nextobjectid = Math.max(this.map.nextobjectid, object.id + 1)
    }
  }

  revert(): void {
    for (const object of this.added) {
      const i = this.layer.objects.indexOf(object)
      if (i >= 0) this.layer.objects.splice(i, 1)
    }
    // Undoing has to put the counter back too, or the map saves with a
    // `nextobjectid` that no longer matches anything in it.
    this.map.nextobjectid = this.nextObjectId
  }
}

export class RemoveObjectsCommand implements EditCommand {
  readonly label: string
  private removed: { object: MapObject; index: number }[] = []

  constructor(private layer: { objects: MapObject[] }, private objects: MapObject[]) {
    this.label = objects.length === 1 ? 'Usuń obiekt' : `Usuń ${objects.length} obiektów`
  }

  apply(): void {
    this.removed = []
    for (const obj of this.objects) {
      const index = this.layer.objects.indexOf(obj)
      if (index >= 0) {
        this.removed.push({ object: obj, index })
        this.layer.objects.splice(index, 1)
      }
    }
  }

  revert(): void {
    for (let i = this.removed.length - 1; i >= 0; i--) {
      const { object, index } = this.removed[i]!
      this.layer.objects.splice(index, 0, object)
    }
  }
}

type ObjectPatch = Partial<Pick<MapObject, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'gid' | 'name' | 'className' | 'visible'>>

/** Moves, resizes, rotates or renames objects; drags merge into one step. */
export class UpdateObjectsCommand implements EditCommand {
  readonly mergeKey: string | undefined
  private before: ObjectPatch[]

  constructor(
    readonly label: string,
    private objects: MapObject[],
    private after: ObjectPatch[],
    mergeKey?: string,
  ) {
    this.mergeKey = mergeKey
    this.before = objects.map((obj, i) => {
      const patch: ObjectPatch = {}
      for (const key of Object.keys(after[i] ?? {}) as (keyof ObjectPatch)[]) {
        ;(patch as Record<string, unknown>)[key] = obj[key]
      }
      return patch
    })
  }

  apply(): void {
    this.objects.forEach((obj, i) => Object.assign(obj, this.after[i] ?? {}))
  }

  revert(): void {
    this.objects.forEach((obj, i) => Object.assign(obj, this.before[i] ?? {}))
  }

  absorb(next: EditCommand): boolean {
    if (!(next instanceof UpdateObjectsCommand)) return false
    if (next.objects.length !== this.objects.length) return false
    if (next.objects.some((o, i) => o !== this.objects[i])) return false
    this.after = next.after
    return true
  }
}

/** Adds, removes or replaces a property on any node that carries properties. */
export class SetPropertyCommand implements EditCommand {
  readonly label: string
  readonly mergeKey: string | undefined
  private before: Property[]

  constructor(
    private owner: { properties: Property[] },
    private next: Property[],
    label = 'Zmień properties',
    mergeKey?: string,
  ) {
    this.label = label
    this.mergeKey = mergeKey
    this.before = owner.properties.map((p) => ({ ...p }))
  }

  apply(): void {
    this.owner.properties = this.next.map((p) => ({ ...p }))
  }

  revert(): void {
    this.owner.properties = this.before.map((p) => ({ ...p }))
  }

  absorb(next: EditCommand): boolean {
    if (!(next instanceof SetPropertyCommand) || next.owner !== this.owner) return false
    this.next = next.next
    return true
  }
}

/**
 * The same property change across many nodes, as one undo step. Editing a
 * property on forty selected objects is a single act, not forty of them.
 */
export class SetPropertiesCommand implements EditCommand {
  readonly label: string
  readonly mergeKey: string | undefined
  private before: Property[][]

  constructor(
    private owners: { properties: Property[] }[],
    private next: Property[][],
    label = 'Zmień properties',
    mergeKey?: string,
  ) {
    this.label = label
    this.mergeKey = mergeKey
    this.before = owners.map((owner) => owner.properties.map((p) => ({ ...p })))
  }

  apply(): void {
    this.owners.forEach((owner, i) => {
      owner.properties = (this.next[i] ?? []).map((p) => ({ ...p }))
    })
  }

  revert(): void {
    this.owners.forEach((owner, i) => {
      owner.properties = (this.before[i] ?? []).map((p) => ({ ...p }))
    })
  }

  absorb(next: EditCommand): boolean {
    if (!(next instanceof SetPropertiesCommand)) return false
    if (next.owners.length !== this.owners.length) return false
    if (next.owners.some((owner, i) => owner !== this.owners[i])) return false
    this.next = next.next
    return true
  }
}

export class AddLayerCommand implements EditCommand {
  readonly label = 'Dodaj warstwę'
  constructor(private map: TileMap, private layer: Layer, private at: number) {}

  apply(): void {
    this.map.layers.splice(this.at, 0, this.layer)
    this.map.nextlayerid = Math.max(this.map.nextlayerid, this.layer.id + 1)
  }

  revert(): void {
    const i = this.map.layers.indexOf(this.layer)
    if (i >= 0) this.map.layers.splice(i, 1)
  }
}

export class RemoveLayerCommand implements EditCommand {
  readonly label = 'Usuń warstwę'
  private at = -1
  constructor(private map: TileMap, private layer: Layer) {}

  apply(): void {
    this.at = this.map.layers.indexOf(this.layer)
    if (this.at >= 0) this.map.layers.splice(this.at, 1)
  }

  revert(): void {
    if (this.at >= 0) this.map.layers.splice(this.at, 0, this.layer)
  }
}

export class MoveLayerCommand implements EditCommand {
  readonly label = 'Zmień kolejność warstw'
  constructor(private map: TileMap, private from: number, private to: number) {}

  private move(from: number, to: number): void {
    const [layer] = this.map.layers.splice(from, 1)
    if (layer) this.map.layers.splice(to, 0, layer)
  }

  apply(): void {
    this.move(this.from, this.to)
  }

  revert(): void {
    this.move(this.to, this.from)
  }
}

/** Toggles visibility, opacity, name or lock on a layer. */
export class UpdateLayerCommand implements EditCommand {
  private before: Partial<Layer>

  constructor(readonly label: string, private layer: Layer, private patch: Partial<Layer>) {
    this.before = {} as Partial<Layer>
    for (const key of Object.keys(patch) as (keyof Layer)[]) {
      ;(this.before as Record<string, unknown>)[key] = layer[key]
    }
  }

  apply(): void {
    Object.assign(this.layer, this.patch)
  }

  revert(): void {
    Object.assign(this.layer, this.before)
  }
}

/** Resizes every tile layer in the map, anchoring content at the origin. */
export class ResizeMapCommand implements EditCommand {
  readonly label = 'Zmień rozmiar mapy'
  private before: { layer: TileLayer; data: DenseLayerData; width: number; height: number }[] = []
  private prevSize: { width: number; height: number }

  constructor(private map: TileMap, private width: number, private height: number) {
    this.prevSize = { width: map.width, height: map.height }
  }

  apply(): void {
    this.before = []
    for (const layer of walkLayers(this.map.layers)) {
      if (layer.kind !== 'tilelayer') continue
      const data = layer.data as DenseLayerData
      this.before.push({ layer, data, width: layer.width, height: layer.height })
      layer.data = data.resized(this.width, this.height)
      layer.width = this.width
      layer.height = this.height
    }
    this.map.width = this.width
    this.map.height = this.height
  }

  revert(): void {
    for (const entry of this.before) {
      entry.layer.data = entry.data
      entry.layer.width = entry.width
      entry.layer.height = entry.height
    }
    this.map.width = this.prevSize.width
    this.map.height = this.prevSize.height
  }
}

/* ------------------------------------------------------------------ */
/* Tileset edits                                                       */
/* ------------------------------------------------------------------ */

export class AddTilesetCommand implements EditCommand {
  readonly label = 'Dodaj tileset'
  constructor(private map: TileMap, private ref: TilesetRef) {}

  apply(): void {
    if (!this.map.tilesets.includes(this.ref)) this.map.tilesets.push(this.ref)
  }

  revert(): void {
    const i = this.map.tilesets.indexOf(this.ref)
    if (i >= 0) this.map.tilesets.splice(i, 1)
  }
}

export class RemoveTilesetCommand implements EditCommand {
  readonly label = 'Odłącz tileset'
  private at = -1
  constructor(private map: TileMap, private ref: TilesetRef) {}

  apply(): void {
    this.at = this.map.tilesets.indexOf(this.ref)
    if (this.at >= 0) this.map.tilesets.splice(this.at, 1)
  }

  revert(): void {
    if (this.at >= 0) this.map.tilesets.splice(this.at, 0, this.ref)
  }
}

/** Appends tiles to a tileset; the tiles themselves are built by the caller. */
export class AddTilesCommand implements EditCommand {
  readonly label: string
  private previousCount: number

  constructor(private tileset: Tileset, private tiles: Tile[]) {
    this.label = tiles.length === 1 ? 'Dodaj kafel' : `Dodaj ${tiles.length} kafli`
    this.previousCount = tileset.tilecount
  }

  apply(): void {
    for (const tile of this.tiles) {
      if (!this.tileset.tiles.includes(tile)) this.tileset.tiles.push(tile)
    }
    this.tileset.tilecount = this.tileset.tiles.reduce((max, tile) => Math.max(max, tile.id + 1), 0)
  }

  revert(): void {
    for (const tile of this.tiles) {
      const i = this.tileset.tiles.indexOf(tile)
      if (i >= 0) this.tileset.tiles.splice(i, 1)
    }
    this.tileset.tilecount = this.previousCount
  }
}

export class RemoveTileCommand implements EditCommand {
  readonly label = 'Usuń kafel z tilesetu'
  private at = -1
  constructor(private tileset: Tileset, private tile: Tile) {}

  apply(): void {
    this.at = this.tileset.tiles.indexOf(this.tile)
    if (this.at >= 0) this.tileset.tiles.splice(this.at, 1)
  }

  revert(): void {
    if (this.at >= 0) this.tileset.tiles.splice(this.at, 0, this.tile)
  }
}

/** Replaces a tile's animation frames. */
export class SetAnimationCommand implements EditCommand {
  readonly label = 'Zmień animację kafla'
  private before: Frame[] | undefined

  constructor(private tile: Tile, private frames: Frame[] | undefined) {
    this.before = tile.animation?.map((f) => ({ ...f }))
  }

  apply(): void {
    this.tile.animation = this.frames && this.frames.length > 0 ? this.frames.map((f) => ({ ...f })) : undefined
  }

  revert(): void {
    this.tile.animation = this.before?.map((f) => ({ ...f }))
  }
}
