import { parseMapJson, serializeMapJson } from './json/map-codec.js'
import { parseProjectJson } from './json/project-codec.js'
import { parseTilesetJson, serializeTilesetJson } from './json/tileset-codec.js'
import { DEFAULT_HINTS, type FormatHints } from './json/common.js'
import { parseMapXml, serializeMapXml } from './xml/map-codec.js'
import { parseTilesetXml, serializeTilesetXml } from './xml/tileset-codec.js'
import type { TileMap, TiledProject, Tileset } from './model.js'
import { basename, dirname, extname, normalizePath, resolveFrom } from './paths.js'

/**
 * Everything above this interface is unaware of where files come from: a Node
 * server over HTTP in Termux, the Android SAF through Capacitor, or the File
 * System Access API on desktop. See docs/PLAN.md section 4.1.
 */
export interface FsEntry {
  /** Project-relative POSIX path. */
  path: string
  kind: 'file' | 'dir'
  size?: number
  mtime?: number
}

export interface ProjectFS {
  /** Every file under the project root, already filtered of noise. */
  listAll(): Promise<FsEntry[]>
  readText(path: string): Promise<string>
  writeText(path: string, content: string): Promise<void>
  exists(path: string): Promise<boolean>
  /** A URL the browser can load an image from. */
  assetUrl(path: string): string
}

export const MAP_EXTENSIONS = ['.tmj', '.tmx', '.json']
export const TILESET_EXTENSIONS = ['.tsj', '.tsx']
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']

export interface ProjectContents {
  /** Path of the .tiled-project file, when the project has one. */
  configPath?: string
  config: TiledProject
  maps: string[]
  tilesets: string[]
  images: string[]
}

function hasExt(path: string, exts: readonly string[]): boolean {
  return exts.includes(extname(path).toLowerCase())
}

/** Reads a folder and works out what kind of project it is. */
export async function scanProject(fs: ProjectFS): Promise<ProjectContents> {
  const entries = await fs.listAll()
  const files = entries.filter((e) => e.kind === 'file').map((e) => e.path)

  const configPath = files.find((f) => f.endsWith('.tiled-project'))
  let config: TiledProject = { folders: ['.'] }
  if (configPath) {
    try {
      config = parseProjectJson(await fs.readText(configPath))
    } catch {
      // A malformed project file should not stop the folder from opening.
    }
  }

  // Tiled's own JSON maps and tilesets share the .json extension in some
  // exports, so sniff the `type` field rather than trusting the name alone.
  const maps: string[] = []
  const tilesets: string[] = []
  for (const file of files) {
    if (hasExt(file, ['.tmj', '.tmx'])) maps.push(file)
    else if (hasExt(file, TILESET_EXTENSIONS)) tilesets.push(file)
  }

  return {
    configPath,
    config,
    maps: maps.sort(),
    tilesets: tilesets.sort(),
    images: files.filter((f) => hasExt(f, IMAGE_EXTENSIONS)).sort(),
  }
}

/** Which serialisation a document came from, so a save goes back the same way. */
export type DocumentFormat = 'json' | 'xml'

export function formatOf(path: string): DocumentFormat {
  return ['.tmx', '.tsx', '.tx'].includes(extname(path).toLowerCase()) ? 'xml' : 'json'
}

export interface LoadedMap {
  path: string
  map: TileMap
  format: DocumentFormat
  /** Only meaningful for the JSON format; XML has a single dialect. */
  hints: FormatHints
}

export interface LoadedTileset {
  path: string
  tileset: Tileset
  format: DocumentFormat
  hints: FormatHints
}

/**
 * Loads a map and every tileset it points at, caching tilesets across maps
 * because a project's maps normally share them (docs/PLAN.md section 6).
 */
export class ProjectLoader {
  private tilesetCache = new Map<string, LoadedTileset>()

  constructor(private fs: ProjectFS) {}

  get tilesets(): ReadonlyMap<string, LoadedTileset> {
    return this.tilesetCache
  }

  async loadTileset(path: string): Promise<LoadedTileset> {
    const key = normalizePath(path)
    const cached = this.tilesetCache.get(key)
    if (cached) return cached
    const text = await this.fs.readText(key)
    const format = formatOf(key)
    const loaded: LoadedTileset =
      format === 'xml'
        ? { ...parseTilesetXml(text, key), path: key, format, hints: DEFAULT_HINTS }
        : { ...parseTilesetJson(text, key), path: key, format }
    this.tilesetCache.set(key, loaded)
    return loaded
  }

  async loadMap(path: string): Promise<LoadedMap> {
    const key = normalizePath(path)
    const text = await this.fs.readText(key)
    const format = formatOf(key)
    const parsed =
      format === 'xml'
        ? { map: parseMapXml(text).map, hints: DEFAULT_HINTS }
        : parseMapJson(text)
    for (const ref of parsed.map.tilesets) {
      // A TMX map may embed its tileset outright, in which case it is already
      // attached and there is nothing to resolve.
      if (!ref.source) continue
      try {
        const loaded = await this.loadTileset(resolveFrom(key, ref.source))
        ref.tileset = loaded.tileset
      } catch {
        // A missing tileset is a lint finding, not a load failure: the map
        // still opens, just without art for those tiles.
      }
    }
    return { ...parsed, path: key, format }
  }

  async saveMap(map: TileMap, path: string, hints: FormatHints): Promise<void> {
    const key = normalizePath(path)
    const text = formatOf(key) === 'xml' ? serializeMapXml(map) : serializeMapJson(map, hints)
    await this.fs.writeText(key, text)
  }

  async saveTileset(tileset: Tileset, path: string, hints: FormatHints): Promise<void> {
    const key = normalizePath(path)
    const text = formatOf(key) === 'xml' ? serializeTilesetXml(tileset) : serializeTilesetJson(tileset, hints)
    await this.fs.writeText(key, text)
  }

  invalidate(path?: string): void {
    if (path) this.tilesetCache.delete(normalizePath(path))
    else this.tilesetCache.clear()
  }
}

/**
 * Resolves a tile's image path relative to the tileset that declares it, which
 * is how image-collection tilesets address their files.
 */
export function tileImagePath(tilesetPath: string, image: string): string {
  return resolveFrom(tilesetPath, image)
}

/** A display name for a map, without its folder or extension. */
export function mapTitle(path: string): string {
  const base = basename(path)
  const ext = extname(base)
  return ext ? base.slice(0, -ext.length) : base
}

export function mapFolder(path: string): string {
  return dirname(path) || '.'
}
