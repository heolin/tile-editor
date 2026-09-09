import { create } from 'zustand'
import {
  DenseLayerData, History, ProjectLoader, SetTilesCommand,
  lintMap, lintProject, lintUnusedTiles, mapTitle, tileId, walkLayers,
  type FormatHints, type LintFinding, type Layer, type MapObject,
  type ObjectLayer, type ProjectContents, type TileLayer, type TileMap, type Tileset,
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
  source: TileSourceIndex
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
  dirty: boolean
  saving: boolean

  activeLayerId?: number
  selectedObjectIds: number[]
  tool: ToolId
  stamp?: Stamp
  activeTilesetPath?: string
  hoverTile?: { x: number; y: number }

  camera: Camera
  showGrid: boolean
  showObjects: boolean

  openPanel: PanelId | null
  propertyTarget: PropertyOwner
  lint: LintFinding[]
  lintRunning: boolean
  toast?: { text: string; tone: 'ok' | 'error' }

  init(): Promise<void>
  openMap(path: string): Promise<void>
  save(): Promise<void>
  touch(): void

  setTool(tool: ToolId): void
  setStamp(stamp: Stamp | undefined): void
  setActiveLayer(id: number | undefined): void
  selectObjects(ids: number[]): void
  setCamera(camera: Partial<Camera>): void
  setPanel(panel: PanelId | null): void
  setPropertyTarget(target: PropertyOwner): void
  toggleGrid(): void
  toggleObjects(): void
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
  dirty: false,
  saving: false,
  selectedObjectIds: [],
  tool: 'brush',
  camera: { x: 0, y: 0, zoom: 1 },
  showGrid: true,
  showObjects: true,
  openPanel: null,
  propertyTarget: { kind: 'map' },
  lint: [],
  lintRunning: false,

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
        doc: { path: loaded.path, map: loaded.map, hints: loaded.hints, source },
        activeLayerId: firstLayer?.id,
        selectedObjectIds: [],
        propertyTarget: { kind: 'map' },
        revision: get().revision + 1,
        dirty: false,
        camera: { x: 0, y: 0, zoom: 1 },
        lint: [],
      })
    } catch (error) {
      get().notify(error instanceof Error ? error.message : String(error), 'error')
    }
  },

  async save() {
    const { doc, loader, history } = get()
    if (!doc || !loader) return
    set({ saving: true })
    try {
      await loader.saveMap(doc.map, doc.path, doc.hints)
      history.markSaved()
      set({ dirty: false, saving: false })
      get().notify(`Zapisano ${mapTitle(doc.path)}`)
    } catch (error) {
      set({ saving: false })
      get().notify(error instanceof Error ? error.message : String(error), 'error')
    }
  },

  touch() {
    set({ revision: get().revision + 1, dirty: get().history.dirty })
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
  setPropertyTarget: (propertyTarget) => set({ propertyTarget }),
  toggleGrid: () => set({ showGrid: !get().showGrid }),
  toggleObjects: () => set({ showObjects: !get().showObjects }),
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
