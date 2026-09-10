import { create } from 'zustand'
import {
  AddTilesCommand, AddTilesetCommand, DenseLayerData, History, ProjectLoader,
  RemoveTilesetCommand, SetTilesCommand,
  addImagesToTileset, createFromTemplate, createTileMap, createTileset,
  findTilesetRef, lintMap, lintProject, lintUnusedTiles, mapTitle,
  nextFirstGid, normalizePath, relativeFrom, tileId, tilesetUsage, walkLayers,
  type DocumentFormat, type FormatHints, type LintFinding, type Layer, type MapObject,
  type ObjectLayer, type ProjectContents, type TileLayer, type TileMap, type Tileset,
  type TilesetRef,
} from '@tile-editor/core'
import { HttpProjectFS } from '../fs/http-fs'
import { buildTileSourceIndex, type TileSourceIndex } from '../render/tile-source'

export type ToolId = 'brush' | 'eraser' | 'fill' | 'rect' | 'picker' | 'select' | 'object'
export type PanelId = 'project' | 'layers' | 'tilesets' | 'properties' | 'lint'

/** A rectangular block of tiles picked up from a tileset or the map. */
export interface Stamp {
  width: number
  height: number
  gids: number[]
}

export interface Camera {
  x: number
  y: number
  zoom: number
}

export interface OpenDocument {
  path: string
  map: TileMap
  hints: FormatHints
  /** Which serialisation this map came from, shown in the properties panel. */
  format: DocumentFormat
  source: TileSourceIndex
}

export interface NewMapRequest {
  /** File name without a folder, extension included. */
  fileName: string
  folder: string
  width: number
  height: number
  tilewidth: number
  tileheight: number
  /** Path of a map to copy the structure from, or undefined for a blank map. */
  templatePath?: string
  keepContent: boolean
}

export type PropertyOwner =
  | { kind: 'map' }
  | { kind: 'layer'; id: number }
  | { kind: 'object'; id: number }
  | { kind: 'tile'; tilesetPath: string; tileId: number }

interface EditorState {
  fs: HttpProjectFS
  loader?: ProjectLoader
  history: History

  status: 'loading' | 'ready' | 'error'
  error?: string
  root: string
  project?: ProjectContents

  doc?: OpenDocument
  /** Bumped by every mutation so React re-renders and the canvas repaints. */
  revision: number
  /** Bumped when the tile palette changes, forcing a texture reload. */
  sourceRevision: number
  dirty: boolean
  saving: boolean

  activeLayerId?: number
  selectedObjectIds: number[]
  /** Tilesets edited through the properties panel, saved with the map. */
  dirtyTilesets: Set<string>
  tool: ToolId
  stamp?: Stamp
  activeTilesetPath?: string
  hoverTile?: { x: number; y: number }

  camera: Camera
  showGrid: boolean
  showObjects: boolean
  /** Off by default: animating means redrawing continuously, which costs battery. */
  animate: boolean

  openPanel: PanelId | null
  /** Modal dialogs live here so the command palette can open them too. */
  dialog: 'new-map' | 'add-tileset' | 'palette' | null
  propertyTarget: PropertyOwner
  lint: LintFinding[]
  lintRunning: boolean
  toast?: { text: string; tone: 'ok' | 'error' }

  init(): Promise<void>
  connectTo(base: string): Promise<void>
  openMap(path: string): Promise<void>
  createMap(options: NewMapRequest): Promise<void>
  refreshProject(): Promise<void>
  save(): Promise<void>
  touch(): void
  markTilesetDirty(path: string): void
  rebuildSource(): void

  attachTileset(tilesetPath: string): Promise<void>
  detachTileset(ref: TilesetRef): void
  createTilesetFile(options: { fileName: string; folder: string; name: string; tileSize: number }): Promise<void>
  addImagesToActiveTileset(tilesetPath: string, imagePaths: string[]): Promise<void>

  setTool(tool: ToolId): void
  setStamp(stamp: Stamp | undefined): void
  setActiveLayer(id: number | undefined): void
  selectObjects(ids: number[]): void
  setCamera(camera: Partial<Camera>): void
  setPanel(panel: PanelId | null): void
  setDialog(dialog: 'new-map' | 'add-tileset' | 'palette' | null): void
  setPropertyTarget(target: PropertyOwner): void
  toggleGrid(): void
  toggleObjects(): void
  toggleAnimate(): void
  notify(text: string, tone?: 'ok' | 'error'): void

  undo(): void
  redo(): void
  runLint(): Promise<void>

  activeLayer(): Layer | undefined
  activeTileLayer(): TileLayer | undefined
  activeObjectLayer(): ObjectLayer | undefined
  selectedObjects(): MapObject[]
  tilesets(): { path: string; tileset: Tileset }[]
}

const fs = new HttpProjectFS()

export const useEditor = create<EditorState>((set, get) => ({
  fs,
  history: new History(),
  status: 'loading',
  root: '',
  revision: 0,
  sourceRevision: 0,
  dirty: false,
  saving: false,
  selectedObjectIds: [],
  dirtyTilesets: new Set<string>(),
  tool: 'brush',
  camera: { x: 0, y: 0, zoom: 1 },
  showGrid: true,
  showObjects: true,
  animate: false,
  openPanel: null,
  dialog: null,
  propertyTarget: { kind: 'map' },
  lint: [],
  lintRunning: false,

  async connectTo(base) {
    fs.setBase(base)
    set({ status: 'loading', error: undefined })
    await get().init()
  },

  async init() {
    try {
      const data = await fs.project()
      const loader = new ProjectLoader(fs)
      set({
        status: 'ready',
        root: data.root,
        loader,
        project: {
          configPath: data.configPath,
          config: data.config as ProjectContents['config'],
          maps: data.maps,
          tilesets: data.tilesets,
          images: data.images,
        },
      })
      const first = data.maps[0]
      if (first) await get().openMap(first)
    } catch (error) {
      set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  },

  async openMap(path) {
    const loader = get().loader
    if (!loader) return
    try {
      const loaded = await loader.loadMap(path)
      const source = buildTileSourceIndex(loaded.map, (p) => fs.assetUrl(p))
      const firstLayer = [...walkLayers(loaded.map.layers)][0]
      get().history.clear()
      set({
        doc: { path: loaded.path, map: loaded.map, hints: loaded.hints, format: loaded.format, source },
        activeLayerId: firstLayer?.id,
        selectedObjectIds: [],
        propertyTarget: { kind: 'map' },
        revision: get().revision + 1,
        dirty: false,
        dirtyTilesets: new Set(),
        camera: { x: 0, y: 0, zoom: 1 },
        lint: [],
      })
    } catch (error) {
      get().notify(error instanceof Error ? error.message : String(error), 'error')
    }
  },

  async createMap(options) {
    const { loader, project, fs: files } = get()
    if (!loader || !project) return
    const folder = normalizePath(options.folder)
    const path = normalizePath(folder ? `${folder}/${options.fileName}` : options.fileName)

    if (await files.exists(path)) {
      get().notify(`Plik ${path} już istnieje.`, 'error')
      return
    }

    try {
      let map
      if (options.templatePath) {
        const template = await loader.loadMap(options.templatePath)
        map = createFromTemplate(template.map, {
          path,
          templatePath: template.path,
          width: options.width,
          height: options.height,
          keepContent: options.keepContent,
        })
      } else {
        // A blank map still needs something to paint with, so it picks up the
        // project's tilesets rather than opening with an empty palette.
        const tilesets = []
        for (const tilesetPath of project.tilesets) {
          const loaded = await loader.loadTileset(tilesetPath).catch(() => undefined)
          if (loaded) tilesets.push({ path: tilesetPath, tilecount: Math.max(1, loaded.tileset.tilecount) })
        }
        map = createTileMap({
          path,
          width: options.width,
          height: options.height,
          tilewidth: options.tilewidth,
          tileheight: options.tileheight,
          tilesets,
          layers: [{ name: 'kafle', kind: 'tilelayer' }, { name: 'obiekty', kind: 'objectgroup' }],
        })
      }
      await loader.saveMap(map, path, { dialect: 'tiled', rootBraceInline: true, trailingNewline: false })
      await get().refreshProject()
      await get().openMap(path)
      get().notify(`Utworzono ${mapTitle(path)}`)
    } catch (error) {
      get().notify(error instanceof Error ? error.message : String(error), 'error')
    }
  },

  async refreshProject() {
    const files = get().fs
    files.invalidate()
    const data = await files.project()
    set({
      root: data.root,
      project: {
        configPath: data.configPath,
        config: data.config as ProjectContents['config'],
        maps: data.maps,
        tilesets: data.tilesets,
        images: data.images,
      },
    })
  },

  async save() {
    const { doc, loader, history, dirtyTilesets } = get()
    if (!doc || !loader) return
    set({ saving: true })
    try {
      await loader.saveMap(doc.map, doc.path, doc.hints)
      // Tile properties drive the games in this corpus, so an edit to one has
      // to reach the .tsj alongside the map that prompted it.
      const savedTilesets: string[] = []
      for (const path of dirtyTilesets) {
        const loaded = loader.tilesets.get(path)
        if (!loaded) continue
        await loader.saveTileset(loaded.tileset, path, loaded.hints)
        savedTilesets.push(path)
      }
      history.markSaved()
      set({ dirty: false, saving: false, dirtyTilesets: new Set() })
      get().notify(
        savedTilesets.length > 0
          ? `Zapisano ${mapTitle(doc.path)} i ${savedTilesets.length} tileset${savedTilesets.length === 1 ? '' : 'y'}`
          : `Zapisano ${mapTitle(doc.path)}`,
      )
    } catch (error) {
      set({ saving: false })
      get().notify(error instanceof Error ? error.message : String(error), 'error')
    }
  },

  touch() {
    set({ revision: get().revision + 1, dirty: get().history.dirty || get().dirtyTilesets.size > 0 })
  },

  markTilesetDirty(path) {
    const next = new Set(get().dirtyTilesets)
    next.add(path)
    set({ dirtyTilesets: next })
  },

  /** Rebuilds the gid to image mapping after the tile palette changed. */
  rebuildSource() {
    const doc = get().doc
    if (!doc) return
    const source = buildTileSourceIndex(doc.map, (p) => fs.assetUrl(p))
    set({ doc: { ...doc, source }, sourceRevision: get().sourceRevision + 1 })
  },

  async attachTileset(tilesetPath) {
    const { doc, loader } = get()
    if (!doc || !loader) return
    const path = normalizePath(tilesetPath)
    if (findTilesetRef(doc.map, doc.path, path)) {
      get().notify('Ta mapa już używa tego tilesetu.', 'error')
      return
    }
    try {
      const loaded = await loader.loadTileset(path)
      const ref: TilesetRef = {
        firstgid: nextFirstGid(doc.map),
        source: relativeFrom(doc.path, path),
        tileset: loaded.tileset,
      }
      get().history.run(new AddTilesetCommand(doc.map, ref))
      get().rebuildSource()
      get().touch()
      get().notify(`Podłączono ${loaded.tileset.name || path}`)
    } catch (error) {
      get().notify(error instanceof Error ? error.message : String(error), 'error')
    }
  },

  detachTileset(ref) {
    const doc = get().doc
    if (!doc) return
    const used = tilesetUsage(doc.map, ref)
    if (used > 0) {
      // Removing a tileset shifts nothing, but every gid pointing into it would
      // stop resolving, so the map has to be cleared of it first.
      get().notify(`Nie można odłączyć: ${used} kafli i obiektów wciąż go używa.`, 'error')
      return
    }
    get().history.run(new RemoveTilesetCommand(doc.map, ref))
    get().rebuildSource()
    get().touch()
  },

  async createTilesetFile(options) {
    const { loader, doc } = get()
    if (!loader) return
    const folder = normalizePath(options.folder)
    const fileName = options.fileName.endsWith('.tsj') ? options.fileName : `${options.fileName}.tsj`
    const path = normalizePath(folder ? `${folder}/${fileName}` : fileName)
    if (await fs.exists(path)) {
      get().notify(`Plik ${path} już istnieje.`, 'error')
      return
    }
    try {
      const tileset = createTileset({
        name: options.name || mapTitle(path),
        tilewidth: options.tileSize,
        tileheight: options.tileSize,
      })
      await loader.saveTileset(tileset, path, { dialect: 'tiled', rootBraceInline: true, trailingNewline: false })
      loader.invalidate(path)
      await get().refreshProject()
      if (doc) await get().attachTileset(path)
      get().notify(`Utworzono ${path}`)
    } catch (error) {
      get().notify(error instanceof Error ? error.message : String(error), 'error')
    }
  },

  async addImagesToActiveTileset(tilesetPath, imagePaths) {
    const { loader, doc } = get()
    if (!loader || !doc) return
    const loaded = loader.tilesets.get(normalizePath(tilesetPath))
    if (!loaded) {
      get().notify('Tileset nie jest wczytany.', 'error')
      return
    }
    // Each tile records its own pixel size, so the images have to be measured
    // before they can be added. The browser is the only thing here that knows.
    const sizes = new Map<string, { width: number; height: number }>()
    await Promise.all(
      imagePaths.map(
        (path) =>
          new Promise<void>((resolveImage) => {
            const image = new Image()
            image.onload = () => {
              sizes.set(path, { width: image.naturalWidth, height: image.naturalHeight })
              resolveImage()
            }
            image.onerror = () => resolveImage()
            image.src = fs.assetUrl(path)
          }),
      ),
    )

    const tiles = addImagesToTileset(loaded.tileset, loaded.path, imagePaths, (p) => sizes.get(p))
    if (tiles.length === 0) {
      get().notify('Wszystkie wybrane obrazki są już w tym tilesecie.', 'error')
      return
    }
    // addImagesToTileset already mutated the tileset; the command exists so the
    // change can be undone, so undo the mutation before handing it over.
    for (const tile of tiles) {
      const i = loaded.tileset.tiles.indexOf(tile)
      if (i >= 0) loaded.tileset.tiles.splice(i, 1)
    }
    get().history.run(new AddTilesCommand(loaded.tileset, tiles))
    get().markTilesetDirty(loaded.path)
    get().rebuildSource()
    get().touch()
    get().notify(`Dodano ${tiles.length} kafli do ${loaded.tileset.name}`)
  },

  setTool: (tool) =>
    set({ tool, selectedObjectIds: tool === 'select' || tool === 'object' ? get().selectedObjectIds : [] }),
  setStamp: (stamp) => set({ stamp }),
  setActiveLayer: (id) => {
    const layer = id === undefined ? undefined : [...walkLayers(get().doc?.map.layers ?? [])].find((l) => l.id === id)
    set({
      activeLayerId: id,
      selectedObjectIds: [],
      propertyTarget: id === undefined ? { kind: 'map' } : { kind: 'layer', id },
      // Painting tiles onto an object layer is meaningless, and object tools
      // are equally useless on a tile layer, so the tool follows the layer.
      tool:
        layer?.kind === 'objectgroup'
          ? get().tool === 'object' ? 'object' : 'select'
          : get().tool === 'select' || get().tool === 'object' ? 'brush' : get().tool,
    })
  },
  selectObjects: (ids) =>
    set({
      selectedObjectIds: ids,
      propertyTarget: ids.length === 1 ? { kind: 'object', id: ids[0]! } : get().propertyTarget,
    }),
  setCamera: (camera) => set({ camera: { ...get().camera, ...camera } }),
  setPanel: (openPanel) => set({ openPanel }),
  setDialog: (dialog) => set({ dialog }),
  setPropertyTarget: (propertyTarget) => set({ propertyTarget }),
  toggleGrid: () => set({ showGrid: !get().showGrid }),
  toggleObjects: () => set({ showObjects: !get().showObjects }),
  toggleAnimate: () => set({ animate: !get().animate }),
  notify: (text, tone = 'ok') => {
    set({ toast: { text, tone } })
    setTimeout(() => {
      if (get().toast?.text === text) set({ toast: undefined })
    }, 2600)
  },

  undo() {
    get().history.undo()
    get().touch()
  },
  redo() {
    get().history.redo()
    get().touch()
  },

  async runLint() {
    const { loader, project, doc } = get()
    if (!loader || !project) return
    set({ lintRunning: true, openPanel: 'lint' })
    try {
      const targets: { path: string; map: TileMap }[] = []
      for (const path of project.maps) {
        // The open document is authoritative; the rest come from disk.
        if (doc && path === doc.path) targets.push({ path, map: doc.map })
        else targets.push({ path, map: (await loader.loadMap(path)).map })
      }
      const tilesetsByRef = new Map<string, Tileset>()
      for (const target of targets) {
        for (const ref of target.map.tilesets) {
          if (ref.source && ref.tileset) tilesetsByRef.set(ref.source, ref.tileset)
        }
      }
      const findings = [...lintProject(targets), ...lintUnusedTiles(targets, tilesetsByRef)]
      set({ lint: findings, lintRunning: false })
    } catch (error) {
      set({ lintRunning: false })
      get().notify(error instanceof Error ? error.message : String(error), 'error')
    }
  },

  activeLayer() {
    const { doc, activeLayerId } = get()
    if (!doc || activeLayerId === undefined) return undefined
    return [...walkLayers(doc.map.layers)].find((l) => l.id === activeLayerId)
  },
  activeTileLayer() {
    const layer = get().activeLayer()
    return layer?.kind === 'tilelayer' ? layer : undefined
  },
  activeObjectLayer() {
    const layer = get().activeLayer()
    return layer?.kind === 'objectgroup' ? layer : undefined
  },
  selectedObjects() {
    const layer = get().activeObjectLayer()
    if (!layer) return []
    const ids = new Set(get().selectedObjectIds)
    return layer.objects.filter((o) => ids.has(o.id))
  },
  tilesets() {
    const doc = get().doc
    if (!doc) return []
    const out: { path: string; tileset: Tileset }[] = []
    for (const ref of doc.map.tilesets) {
      if (ref.tileset) out.push({ path: ref.tileset.sourcePath ?? ref.source ?? '', tileset: ref.tileset })
    }
    return out
  },
}))

/* ------------------------------------------------------------------ */
/* Tile editing helpers                                                */
/* ------------------------------------------------------------------ */

/** Applies a stamp at a map position, respecting its footprint. */
export function paintStamp(command: SetTilesCommand, stamp: Stamp, x: number, y: number): void {
  for (let dy = 0; dy < stamp.height; dy++) {
    for (let dx = 0; dx < stamp.width; dx++) {
      command.add(x + dx, y + dy, stamp.gids[dy * stamp.width + dx] ?? 0)
    }
  }
}

/** Four-way flood fill bounded by the layer. */
export function floodFill(layer: TileLayer, x: number, y: number, gid: number, command: SetTilesCommand): void {
  const target = layer.data.get(x, y)
  if (target === gid) return
  const { width, height } = layer.data.bounds
  const seen = new Uint8Array(width * height)
  const queue: number[] = [y * width + x]
  seen[y * width + x] = 1
  while (queue.length > 0) {
    const index = queue.pop()!
    const cx = index % width
    const cy = Math.floor(index / width)
    if (layer.data.get(cx, cy) !== target) continue
    command.add(cx, cy, gid)
    const neighbours = [
      [cx - 1, cy],
      [cx + 1, cy],
      [cx, cy - 1],
      [cx, cy + 1],
    ] as const
    for (const [nx, ny] of neighbours) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const ni = ny * width + nx
      if (seen[ni]) continue
      seen[ni] = 1
      queue.push(ni)
    }
  }
}

/** Reads a rectangle out of a tile layer as a reusable stamp. */
export function captureStamp(layer: TileLayer, x0: number, y0: number, x1: number, y1: number): Stamp {
  const left = Math.min(x0, x1)
  const top = Math.min(y0, y1)
  const width = Math.abs(x1 - x0) + 1
  const height = Math.abs(y1 - y0) + 1
  const gids: number[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) gids.push(layer.data.get(left + x, top + y))
  }
  return { width, height, gids }
}

export function newLayerId(map: TileMap): number {
  return map.nextlayerid
}

/**
 * Builds a tile object covering one grid cell. The anchor decides where
 * (x, y) sits inside that box, which is why this cannot just be the cell's
 * top-left corner (docs/PLAN.md section 5.1).
 */
export function makeTileObject(
  map: TileMap,
  gid: number,
  cellX: number,
  cellY: number,
  anchor: { ax: number; ay: number },
  size: { width: number; height: number },
): MapObject {
  const left = cellX * map.tilewidth
  const top = cellY * map.tileheight
  return {
    id: map.nextobjectid,
    name: '',
    className: '',
    x: left + anchor.ax * size.width,
    y: top + anchor.ay * size.height,
    width: size.width,
    height: size.height,
    rotation: 0,
    visible: true,
    shape: 'tile',
    gid,
    properties: [],
  }
}

export function makeTileLayer(map: TileMap, name: string): TileLayer {
  return {
    kind: 'tilelayer',
    id: map.nextlayerid,
    name,
    opacity: 1,
    visible: true,
    offsetx: 0,
    offsety: 0,
    parallaxx: 1,
    parallaxy: 1,
    properties: [],
    width: map.width,
    height: map.height,
    x: 0,
    y: 0,
    data: new DenseLayerData(map.width, map.height),
    encoding: 'csv',
  }
}

export function makeObjectLayer(map: TileMap, name: string): ObjectLayer {
  return {
    kind: 'objectgroup',
    id: map.nextlayerid,
    name,
    opacity: 1,
    visible: true,
    offsetx: 0,
    offsety: 0,
    parallaxx: 1,
    parallaxy: 1,
    properties: [],
    draworder: 'topdown',
    objects: [],
  }
}

export { tileId, lintMap }
