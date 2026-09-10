import type { FsEntry, ProjectFS } from '@tile-editor/core'
import { normalizePath } from '@tile-editor/core'

/**
 * Talks to the tile-editor server running in Termux. This is the primary
 * adapter; Capacitor and File System Access implementations slot in beside it
 * without anything above noticing (docs/PLAN.md section 4.1).
 */
/**
 * Where the editor's server lives. Empty means "same origin", which is the case
 * when the page was served by that server. A packaged app has no server of its
 * own, so it points at one running elsewhere - typically Termux on the same
 * device, over localhost.
 */
const BASE_KEY = 'tile-editor:server'

export function storedServerBase(): string {
  try {
    return window.localStorage.getItem(BASE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function storeServerBase(base: string): void {
  try {
    if (base) window.localStorage.setItem(BASE_KEY, base)
    else window.localStorage.removeItem(BASE_KEY)
  } catch {
    // Private browsing: the address simply will not be remembered.
  }
}

/** True when the page was not served over http, so there is no same origin. */
export function needsExplicitServer(): boolean {
  return typeof location !== 'undefined' && !location.protocol.startsWith('http')
}

export class HttpProjectFS implements ProjectFS {
  private cachedList: FsEntry[] | undefined
  private base: string

  constructor(base?: string) {
    this.base = base ?? storedServerBase()
  }

  /** Points this adapter at a different server and forgets what it cached. */
  setBase(base: string): void {
    this.base = base.replace(/\/$/, '')
    this.cachedList = undefined
    storeServerBase(this.base)
  }

  get serverBase(): string {
    return this.base
  }

  private url(path: string): string {
    return `${this.base}${path}`
  }

  /** The address the API is reached at, for error messages and diagnostics. */
  get origin(): string {
    return this.base || (typeof location === 'undefined' ? '' : location.origin)
  }

  async project(): Promise<{
    root: string
    configPath?: string
    config: unknown
    maps: string[]
    tilesets: string[]
    images: string[]
  }> {
    let res: Response
    try {
      res = await fetch(this.url('/api/project'))
    } catch {
      // A failed fetch says "Failed to fetch" and nothing else. Naming the
      // address turns that into something a person can act on.
      throw new Error(`Brak odpowiedzi z ${this.origin}`)
    }
    if (!res.ok) throw new Error(`Serwer odpowiedział ${res.status} na ${this.origin}/api/project`)
    return res.json()
  }

  async listAll(): Promise<FsEntry[]> {
    if (this.cachedList) return this.cachedList
    const data = await this.project()
    this.cachedList = [
      ...data.maps.map((path): FsEntry => ({ path, kind: 'file' })),
      ...data.tilesets.map((path): FsEntry => ({ path, kind: 'file' })),
      ...data.images.map((path): FsEntry => ({ path, kind: 'file' })),
    ]
    return this.cachedList
  }

  async readText(path: string): Promise<string> {
    const res = await fetch(this.url(`/api/file?path=${encodeURIComponent(normalizePath(path))}`))
    if (!res.ok) throw new Error(`Nie znaleziono pliku: ${path}`)
    return res.text()
  }

  async writeText(path: string, content: string): Promise<void> {
    const res = await fetch(this.url(`/api/file?path=${encodeURIComponent(normalizePath(path))}`), {
      method: 'PUT',
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: content,
    })
    if (!res.ok) throw new Error(`Zapis nie powiódł się: ${path}`)
  }

  async exists(path: string): Promise<boolean> {
    const list = await this.listAll()
    const key = normalizePath(path)
    return list.some((e) => e.path === key)
  }

  /** Drops the cached listing so a newly written file becomes visible. */
  invalidate(): void {
    this.cachedList = undefined
  }

  assetUrl(path: string): string {
    return this.url('/assets/' + normalizePath(path).split('/').map(encodeURIComponent).join('/'))
  }

  /** Live notifications from the server when files change on disk. */
  watch(onChange: (path: string) => void): () => void {
    const source = new EventSource(this.url('/api/events'))
    const handler = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as { path?: string }
        if (data.path) onChange(data.path)
      } catch {
        // Ignore malformed frames rather than tearing down the stream.
      }
    }
    source.addEventListener('changed', handler as EventListener)
    return () => source.close()
  }
}
