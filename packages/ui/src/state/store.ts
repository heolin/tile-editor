import { create } from 'zustand'
import {
  AddObjectCommand, AddTilesCommand, AddTilesetCommand, DenseLayerData, History,
  ProjectLoader, PropertyTypeRegistry, RemoveObjectsCommand, RemoveTilesetCommand,
  SetTilesCommand, applyFix, captureRegion, clampRegion, cloneObject, fillRegion,
  applyInMap, applyInTileset, countInMap, countInTileset,
  indexProperties, objectsOrigin, paintStamp, serializeProjectJson, suggestEnums,
  addImagesToTileset, createFromTemplate, createTileMap, createTileset,
  findTilesetRef, lintMap, lintProject, lintUnusedTiles, mapTitle,
  nextFirstGid, normalizePath, relativeFrom, tileId, tilesetUsage, walkLayers,
  type DocumentFormat, type FormatHints, type LintFinding, type Layer, type MapObject,
  type LintFix, type ObjectLayer, type ProjectContents, type PropertyChange,
  type PropertyIndexEntry,
  type PropertyTypeDef, type Stamp, type TileLayer, type TileMap, type TileRegion,
  type Tileset, type TilesetRef, type TypeSuggestion,
} from '@tile-editor/core'
import { HttpProjectFS } from '../fs/http-fs'
import { DEFAULT_THEME, applyTheme, storedTheme } from '../theme'
import { INSTALL_MESSAGES, promptInstall } from '../pwa'
import { buildTileSourceIndex, type TileSourceIndex } from '../render/tile-source'
import { draftKey, dropDraft, listDrafts, putDraft, type Draft } from './drafts'
import { forgetThumb } from '../components/map-thumb'
import { dropThumbs, pruneThumbs, thumbKey } from './thumbs'

export type ToolId = 'brush' | 'eraser' | 'fill' | 'rect' | 'picker' | 'area' | 'select' | 'object'

export type { Stamp, TileRegion }
export type PanelId = 'project' | 'layers' | 'tilesets' | 'properties' | 'lint'

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
  /** The file's text as it was last read or written, for draft bookkeeping. */
  baseText: string
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

/** One file a project-wide change would rewrite, and how much of it. */
export interface ChangedFile {
  path: string
  kind: 'map' | 'tileset'
  count: number
}

export interface ChangePreview {
  files: ChangedFile[]
  properties: number
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
  /** Cells picked out on the map. While it is up, every tile tool writes only inside it. */
  tileSelection?: TileRegion
  /** Tiles held for pasting. Separate from the stamp, which the brush follows. */
  clipboard?: Stamp
  /** Objects held for pasting, with the corner they were lifted from. */
  objectClipboard?: { objects: MapObject[]; origin: { x: number; y: number } }
  activeTilesetPath?: string
  hoverTile?: { x: number; y: number }

  camera: Camera
  /** Bumped to ask the canvas to frame the whole map; it owns the viewport. */
  fitRequest: number
  showGrid: boolean
  showObjects: boolean
  /** Off by default: animating means redrawing continuously, which costs battery. */
  animate: boolean

  openPanel: PanelId | null
  /** Id of the active colour theme; see theme.ts for the list. */
  theme: string
  /** Modal dialogs live here so the command palette can open them too. */
  dialog: 'new-map' | 'add-tileset' | 'property-types' | 'palette' | 'theme' | 'drafts' | 'rename-property' | 'map-properties' | null
  propertyTarget: PropertyOwner
  lint: LintFinding[]
  lintRunning: boolean
  /** Property names the project already uses; drives the name suggestions. */
  propertyIndex: PropertyIndexEntry[]
  toast?: { text: string; tone: 'ok' | 'error' }
  /** Unsaved work found in browser storage when the project opened. */
  drafts: Draft[]

  init(): Promise<void>
  connectTo(base: string): Promise<void>
  /** Quiet retry: succeeds into the editor, fails without disturbing anything. */
  reconnect(): Promise<boolean>
  openMap(path: string): Promise<void>
  createMap(options: NewMapRequest): Promise<void>
  refreshProject(): Promise<void>
  save(): Promise<void>
  touch(): void
  markTilesetDirty(path: string): void
  rebuildSource(): void

  /** Custom types declared by the project, wrapped for lookup. */
  types(): PropertyTypeRegistry
  savePropertyTypes(types: PropertyTypeDef[]): Promise<void>
  suggestPropertyTypes(): Promise<TypeSuggestion[]>
  applyPropertyType(scope: 'map' | 'object', property: string, typeName: string): Promise<{ maps: number; properties: number }>
  /** What a project-wide property change would touch, without touching it. */
  previewPropertyChange(change: PropertyChange): Promise<ChangePreview>
  /** Carries it out, file by file. There is no undo across files. */
  applyPropertyChange(change: PropertyChange): Promise<{ files: number; properties: number }>

  attachTileset(tilesetPath: string): Promise<void>
  detachTileset(ref: TilesetRef): void
  createTilesetFile(options: { fileName: string; folder: string; name: string; tileSize: number }): Promise<void>
  addImagesToActiveTileset(tilesetPath: string, imagePaths: string[]): Promise<void>

  setTool(tool: ToolId): void
  setStamp(stamp: Stamp | undefined): void
  selectTiles(region: TileRegion | undefined): void
  selectAllTiles(): void
  /** Lifts the selection into the clipboard and onto the brush; `cut` also clears it. */
  copyTiles(cut?: boolean): void
  /** Drops the clipboard at a cell, or loads it onto the brush when there is no target. */
  pasteTiles(at?: { x: number; y: number }): void
  fillSelection(gid: number): void
  /** Lifts the selected objects into the object clipboard; `cut` removes them. */
  copyObjects(cut?: boolean): void
  /** Drops them at a map point, or one tile down and right of where they came from. */
  pasteObjects(at?: { x: number; y: number }): void
  duplicateObjects(): void
  setActiveLayer(id: number | undefined): void
  selectObjects(ids: number[]): void
  setCamera(camera: Partial<Camera>): void
  /** Frames the whole map. Used after a resize, when the new edges are off screen. */
  fitToMap(): void
  setPanel(panel: PanelId | null): void
  setDialog(dialog: 'new-map' | 'add-tileset' | 'property-types' | 'palette' | 'theme' | 'drafts' | 'rename-property' | 'map-properties' | null): void
  setTheme(id: string): void
  addToHomeScreen(): Promise<void>
  setPropertyTarget(target: PropertyOwner): void
  toggleGrid(): void
  toggleObjects(): void
  toggleAnimate(): void
  notify(text: string, tone?: 'ok' | 'error'): void

  /** Puts a found draft back into the editor, still unsaved. */
  restoreDraft(draft: Draft): Promise<void>
  discardDraft(draft: Draft): Promise<void>

  undo(): void
  redo(): void
  runLint(): Promise<void>
  indexProjectProperties(): Promise<void>
  applyLintFix(fix: LintFix): Promise<void>

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
  fitRequest: 0,
  showGrid: true,
  showObjects: true,
  animate: false,
  openPanel: null,
  dialog: null,
  theme: typeof window === 'undefined' ? DEFAULT_THEME : storedTheme(),
  propertyTarget: { kind: 'map' },
  lint: [],
  lintRunning: false,
  propertyIndex: [],
  drafts: [],

  async reconnect() {
    try {
      await fs.project()
    } catch {
      return false
    }
    await get().init()
    return get().status === 'ready'
  },

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
          stamps: data.stamps ?? {},
        },
      })
      // Anything left behind by a session that never got to save. Read before
      // the first map opens, so the offer is on screen from the start.
      set({ drafts: await listDrafts(data.root) })
      // Every save mints a thumbnail under a new key; the old ones would pile
      // up in browser storage forever if nobody swept them out.
      void pruneThumbs(
        data.root,
        new Set(data.maps.map((path) => thumbKey(data.root, path, data.stamps?.[path]))),
      )
      const first = data.maps[0]
      if (first) await get().openMap(first)
    } catch (error) {
      set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  },

  async openMap(path) {
    const loader = get().loader
    if (!loader) return
    // Switching maps has always dropped unsaved edits on the floor. Now they
    // land in a draft on the way out, and the editor says where they went.
    const leaving = get().doc
    if (leaving && get().dirty && leaving.path !== normalizePath(path)) {
      await flushDraft()
      set({ drafts: await listDrafts(get().root) })
      get().notify(`Niezapisane zmiany w ${mapTitle(leaving.path)} odłożone — odzyskasz je przez „Niezapisane zmiany…"`)
    }
    try {
      const loaded = await loader.loadMap(path)
      const source = buildTileSourceIndex(loaded.map, (p) => fs.assetUrl(p))
      const firstLayer = [...walkLayers(loaded.map.layers)][0]
      get().history.clear()
      set({
        doc: { path: loaded.path, map: loaded.map, hints: loaded.hints, format: loaded.format, source, baseText: loaded.text },
        activeLayerId: firstLayer?.id,
        selectedObjectIds: [],
        // The clipboard survives: pasting a block from one map into the next
        // is half the reason it exists. A selection rectangle does not.
        tileSelection: undefined,
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
        stamps: data.stamps ?? {},
      },
    })
  },

  async save() {
    const { doc, loader, history, dirtyTilesets } = get()
    if (!doc || !loader) return
    set({ saving: true })
    try {
      const text = await loader.saveMap(doc.map, doc.path, doc.hints)
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
      // The file and the document now agree, so the safety copy has nothing
      // left to protect.
      await dropDraft(draftKey(get().root, doc.path))
      set({ doc: { ...doc, baseText: text }, dirty: false, saving: false, dirtyTilesets: new Set() })
      // The file moved on, so its thumbnail and its timestamp both have to.
      forgetThumb(get().root, doc.path)
      void dropThumbs(get().root, doc.path)
      void get().refreshProject()
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
    scheduleDraft()
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

  types() {
    return new PropertyTypeRegistry(get().project?.config.propertyTypes ?? [])
  },

  /** Writes the project file, which is where Tiled keeps custom types. */
  async savePropertyTypes(types) {
    const { project, fs: files } = get()
    if (!project) return
    const path = project.configPath ?? '.tiled-project'
    const config = { ...project.config, propertyTypes: types }
    try {
      await files.writeText(path, serializeProjectJson(config))
      set({ project: { ...project, configPath: path, config } })
      get().touch()
      get().notify(`Zapisano typy do ${path}`)
    } catch (error) {
      get().notify(error instanceof Error ? error.message : String(error), 'error')
    }
  },

  async suggestPropertyTypes() {
    const { loader, project, doc } = get()
    if (!loader || !project) return []
    const targets: { path: string; map: TileMap }[] = []
    for (const path of project.maps) {
      try {
        targets.push({ path, map: doc && doc.path === path ? doc.map : (await loader.loadMap(path)).map })
      } catch {
        // A map that will not parse simply contributes nothing to the guess.
      }
    }
    return suggestEnums(targets)
  },

  /**
   * Stamps a custom type onto every property of that name across the project.
   * This rewrites files directly rather than going through the undo stack:
   * undo is per-document, and this touches the whole folder. Git is the safety
   * net, which the dialog says out loud before running it.
   */
  async applyPropertyType(scope, property, typeName) {
    const { loader, project, doc } = get()
    if (!loader || !project) return { maps: 0, properties: 0 }
    let maps = 0
    let properties = 0

    for (const path of project.maps) {
      let loaded
      try {
        loaded = doc && doc.path === path ? { map: doc.map, hints: doc.hints } : await loader.loadMap(path)
      } catch {
        continue
      }
      const lists =
        scope === 'map'
          ? [loaded.map.properties]
          : [...walkLayers(loaded.map.layers)]
              .filter((layer): layer is ObjectLayer => layer.kind === 'objectgroup')
              .flatMap((layer) => layer.objects.map((object) => object.properties))

      let touched = 0
      for (const list of lists) {
        for (const entry of list) {
          if (entry.name !== property || entry.propertytype === typeName) continue
          entry.propertytype = typeName
          touched++
        }
      }
      if (touched === 0) continue
      maps++
      properties += touched
      await loader.saveMap(loaded.map, path, loaded.hints)
    }

    if (doc) {
      // The open document may have been rewritten underneath the editor.
      get().rebuildSource()
      get().touch()
    }
    return { maps, properties }
  },

  async previewPropertyChange(change) {
    const { loader, project } = get()
    if (!loader || !project) return { files: [], properties: 0 }
    const files: ChangedFile[] = []
    let properties = 0

    if (change.scope === 'tile') {
      for (const path of project.tilesets) {
        const loaded = await loader.loadTileset(path).catch(() => undefined)
        if (!loaded) continue
        const count = countInTileset(loaded.tileset, change)
        if (count === 0) continue
        files.push({ path, kind: 'tileset', count })
        properties += count
      }
    } else {
      for (const path of project.maps) {
        const loaded = await loader.loadMap(path).catch(() => undefined)
        if (!loaded) continue
        const count = countInMap(loaded.map, change)
        if (count === 0) continue
        files.push({ path, kind: 'map', count })
        properties += count
      }
    }
    return { files, properties }
  },

  async applyPropertyChange(change) {
    const { loader, project, doc } = get()
    if (!loader || !project) return { files: 0, properties: 0 }
    let files = 0
    let properties = 0

    try {
      if (change.scope === 'tile') {
        for (const path of project.tilesets) {
          const loaded = await loader.loadTileset(path).catch(() => undefined)
          if (!loaded) continue
          const touched = applyInTileset(loaded.tileset, change)
          if (touched === 0) continue
          await loader.saveTileset(loaded.tileset, path, loaded.hints)
          files++
          properties += touched
        }
      } else {
        for (const path of project.maps) {
          const loaded = await loader.loadMap(path).catch(() => undefined)
          if (!loaded) continue
          const touched = applyInMap(loaded.map, change)
          if (touched === 0) continue
          await loader.saveMap(loaded.map, path, loaded.hints)
          files++
          properties += touched
        }
      }
    } catch (error) {
      get().notify(error instanceof Error ? error.message : String(error), 'error')
    }

    // Whatever is on screen was rewritten underneath it, so it gets re-read
    // rather than left showing the old names.
    await get().refreshProject()
    if (doc) await get().openMap(doc.path)
    await get().indexProjectProperties()
    return { files, properties }
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
  selectTiles: (tileSelection) => set({ tileSelection }),
  selectAllTiles: () => {
    const layer = get().activeTileLayer()
    if (!layer) return
    const { x, y, width, height } = layer.data.bounds
    set({ tileSelection: { x, y, width, height }, tool: 'area' })
  },
  copyTiles: (cut = false) => {
    const state = get()
    const layer = state.activeTileLayer()
    const region = state.tileSelection && layer ? clampRegion(state.tileSelection, layer) : undefined
    if (!layer || !region) {
      state.notify('Najpierw zaznacz obszar narzędziem zaznaczania (S).', 'error')
      return
    }
    const stamp = captureRegion(layer, region)
    set({ clipboard: stamp, stamp })
    if (cut) {
      const command = new SetTilesCommand('Wytnij', layer, nextStroke())
      fillRegion(command, region, 0)
      if (!command.empty) {
        state.history.run(command)
        state.touch()
      }
    }
    state.notify(`${cut ? 'Wycięto' : 'Skopiowano'} ${stamp.width}×${stamp.height} kafli`)
  },
  pasteTiles: (at) => {
    const state = get()
    const clipboard = state.clipboard
    const layer = state.activeTileLayer()
    if (!clipboard) {
      state.notify('Schowek jest pusty.', 'error')
      return
    }
    const target = at ?? (state.tileSelection ? { x: state.tileSelection.x, y: state.tileSelection.y } : undefined)
    if (!layer || !target) {
      // Nothing says where it should land, so hand it to the brush and let the
      // next tap decide - which is the only workable answer on a touchscreen.
      set({ stamp: clipboard, tool: 'brush' })
      state.notify('Schowek na pędzlu — kliknij, żeby wkleić.')
      return
    }
    const command = new SetTilesCommand('Wklej', layer, nextStroke())
    paintStamp(command, clipboard, target.x, target.y)
    // The selection follows the block even when the paste changed nothing,
    // so what is highlighted is always what was last put down.
    set({ tileSelection: { x: target.x, y: target.y, width: clipboard.width, height: clipboard.height } })
    if (command.empty) return
    state.history.run(command)
    state.touch()
  },
  copyObjects: (cut = false) => {
    const state = get()
    const layer = state.activeObjectLayer()
    const objects = state.selectedObjects()
    if (!layer || objects.length === 0) {
      state.notify('Najpierw zaznacz obiekty.', 'error')
      return
    }
    const origin = objectsOrigin(objects)
    set({
      objectClipboard: {
        origin,
        // Held relative to their own corner, so where they land later depends
        // only on where they are put down.
        objects: objects.map((obj, i) => {
          const copy = cloneObject(obj, i)
          copy.x -= origin.x
          copy.y -= origin.y
          return copy
        }),
      },
    })
    if (cut) {
      state.history.run(new RemoveObjectsCommand(layer, objects))
      state.selectObjects([])
      state.touch()
    }
    state.notify(`${cut ? 'Wycięto' : 'Skopiowano'} ${objects.length} ${objects.length === 1 ? 'obiekt' : 'obiektów'}`)
  },
  pasteObjects: (at) => {
    const state = get()
    const held = state.objectClipboard
    const layer = state.activeObjectLayer()
    const map = state.doc?.map
    if (!held || !map) {
      state.notify('Schowek obiektów jest pusty.', 'error')
      return
    }
    if (!layer) {
      state.notify('Wybierz warstwę obiektów.', 'error')
      return
    }
    const target = at
      ? {
          x: Math.floor(at.x / map.tilewidth) * map.tilewidth,
          y: Math.floor(at.y / map.tileheight) * map.tileheight,
        }
      : { x: held.origin.x + map.tilewidth, y: held.origin.y + map.tileheight }
    let id = map.nextobjectid
    const pasted = held.objects.map((obj) => {
      const copy = cloneObject(obj, id++)
      copy.x += target.x
      copy.y += target.y
      return copy
    })
    state.history.run(new AddObjectCommand(layer, pasted, map))
    state.selectObjects(pasted.map((o) => o.id))
    // Pasting again walks the block further, instead of stacking copies.
    set({ objectClipboard: { ...held, origin: target } })
    state.touch()
  },
  duplicateObjects: () => {
    const state = get()
    const layer = state.activeObjectLayer()
    const objects = state.selectedObjects()
    const map = state.doc?.map
    if (!layer || !map || objects.length === 0) return
    let id = map.nextobjectid
    const copies = objects.map((obj) => {
      const copy = cloneObject(obj, id++)
      copy.x += map.tilewidth
      copy.y += map.tileheight
      return copy
    })
    state.history.run(new AddObjectCommand(layer, copies, map))
    state.selectObjects(copies.map((o) => o.id))
    state.touch()
  },
  fillSelection: (gid) => {
    const state = get()
    const layer = state.activeTileLayer()
    const region = state.tileSelection && layer ? clampRegion(state.tileSelection, layer) : undefined
    if (!layer || !region) return
    const command = new SetTilesCommand(gid === 0 ? 'Wyczyść zaznaczenie' : 'Wypełnij zaznaczenie', layer, nextStroke())
    fillRegion(command, region, gid)
    if (command.empty) return
    state.history.run(command)
    state.touch()
  },
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
  fitToMap: () => set({ fitRequest: get().fitRequest + 1 }),
  setPanel: (openPanel) => set({ openPanel }),
  setDialog: (dialog) => set({ dialog }),
  /** Offers the browser's install prompt, or explains why there is not one. */
  async addToHomeScreen() {
    const outcome = await promptInstall()
    if (outcome === 'accepted') {
      get().notify('Dodano skrót do ekranu głównego')
      return
    }
    get().notify(INSTALL_MESSAGES[outcome], outcome === 'dismissed' ? 'ok' : 'error')
  },

  setTheme: (id) => {
    // The canvas reads its colours from the same tokens, so a repaint has to
    // follow the swap: bumping the revision is what triggers it.
    set({ theme: applyTheme(id), revision: get().revision + 1 })
  },
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

  async restoreDraft(draft) {
    const { loader } = get()
    if (!loader) return
    try {
      // Tilesets first: the map resolves its references against them.
      for (const entry of draft.tilesets) loader.adoptTileset(entry.path, entry.text)
      const loaded = await loader.adoptMap(draft.path, draft.text)
      const source = buildTileSourceIndex(loaded.map, (p) => fs.assetUrl(p))
      const firstLayer = [...walkLayers(loaded.map.layers)][0]
      get().history.clear()
      // Nothing was undone to get here, yet the document differs from the file.
      get().history.markUnsaved()
      set({
        doc: { ...loaded, source, baseText: draft.baseText },
        activeLayerId: firstLayer?.id,
        selectedObjectIds: [],
        tileSelection: undefined,
        propertyTarget: { kind: 'map' },
        revision: get().revision + 1,
        dirty: true,
        dirtyTilesets: new Set(draft.tilesets.map((entry) => entry.path)),
        sourceRevision: get().sourceRevision + 1,
        camera: { x: 0, y: 0, zoom: 1 },
        lint: [],
        drafts: get().drafts.filter((d) => d.key !== draft.key),
      })
      get().notify(`Przywrócono niezapisane zmiany w ${mapTitle(draft.path)} — zapisz, żeby je utrwalić`)
    } catch (error) {
      get().notify(`Nie udało się przywrócić szkicu: ${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  },
  async discardDraft(draft) {
    await dropDraft(draft.key)
    set({ drafts: get().drafts.filter((d) => d.key !== draft.key) })
  },

  undo() {
    get().history.undo()
    get().touch()
  },
  redo() {
    get().history.redo()
    get().touch()
  },

  /** Reads every map to learn which property names exist and with what type. */
  async indexProjectProperties() {
    const { loader, project, doc } = get()
    if (!loader || !project) return
    const targets: { path: string; map: TileMap }[] = []
    for (const path of project.maps) {
      try {
        targets.push({ path, map: doc && doc.path === path ? doc.map : (await loader.loadMap(path)).map })
      } catch {
        // A map that will not parse contributes nothing to the index.
      }
    }
    const tilesets = []
    for (const path of project.tilesets) {
      const loaded = await loader.loadTileset(path).catch(() => undefined)
      if (loaded) tilesets.push(loaded.tileset)
    }
    set({ propertyIndex: indexProperties(targets, tilesets) })
  },

  /**
   * Applies a lint repair across the project. Like the type assignment, this
   * writes files directly rather than through the undo stack: it spans the
   * whole folder, and undo is per-document.
   */
  async applyLintFix(fix) {
    const { loader, project, doc } = get()
    if (!loader || !project) return
    let maps = 0
    let changed = 0
    for (const path of project.maps) {
      let loaded
      try {
        loaded = doc && doc.path === path ? { map: doc.map, hints: doc.hints } : await loader.loadMap(path)
      } catch {
        continue
      }
      const touched = applyFix(loaded.map, fix)
      if (touched === 0) continue
      maps++
      changed += touched
      await loader.saveMap(loaded.map, path, loaded.hints)
    }
    if (doc) get().touch()
    get().notify(
      changed === 0
        ? 'Nie było czego naprawić.'
        : `Poprawiono ${changed} properties w ${maps} mapach na typ ${fix.to}`,
    )
    await get().runLint()
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
      const findings = [
        ...lintProject(targets, { registry: get().types() }),
        ...lintUnusedTiles(targets, tilesetsByRef),
      ]
      set({ lint: findings, lintRunning: false, propertyIndex: indexProperties(targets) })
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
/* Drafts                                                              */
/* ------------------------------------------------------------------ */

/** Long enough that a brush drag writes one draft, short enough to matter. */
const DRAFT_DELAY = 1500
let draftTimer: ReturnType<typeof setTimeout> | undefined

/** Writes the draft now, for the moments there may be no "later". */
export async function flushDraft(): Promise<void> {
  if (draftTimer !== undefined) {
    clearTimeout(draftTimer)
    draftTimer = undefined
  }
  await writeDraft()
}

function scheduleDraft(): void {
  if (draftTimer !== undefined) clearTimeout(draftTimer)
  draftTimer = setTimeout(() => {
    draftTimer = undefined
    void writeDraft()
  }, DRAFT_DELAY)
}

/** Mirrors the open document, as the text a save would write, into the browser. */
async function writeDraft(): Promise<void> {
  const state = useEditor.getState()
  const { doc, loader, root } = state
  if (!doc || !loader || !root) return
  const key = draftKey(root, doc.path)
  if (!state.dirty) {
    await dropDraft(key)
    return
  }
  const tilesets = [...state.dirtyTilesets].flatMap((path) => {
    const loaded = loader.tilesets.get(path)
    return loaded ? [{ path, text: loader.serializeTileset(loaded.tileset, path, loaded.hints) }] : []
  })
  await putDraft({
    key,
    root,
    path: doc.path,
    text: loader.serializeMap(doc.map, doc.path, doc.hints),
    baseText: doc.baseText,
    tilesets,
    savedAt: Date.now(),
  })
}

/* ------------------------------------------------------------------ */
/* Tile editing helpers                                                */
/* ------------------------------------------------------------------ */

let strokeCounter = 0

/**
 * One id per gesture. Edits sharing it collapse into a single undo step, which
 * is what makes dragging a brush across forty cells one Ctrl+Z, not forty.
 */
export function nextStroke(): string {
  strokeCounter += 1
  return String(strokeCounter)
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
