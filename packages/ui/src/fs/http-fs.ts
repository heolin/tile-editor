import type { FsEntry, ProjectFS } from '@tile-editor/core'
import { normalizePath } from '@tile-editor/core'

/**
 * Talks to the tile-editor server running in Termux. This is the primary
 * adapter; Capacitor and File System Access implementations slot in beside it
 * without anything above noticing (docs/PLAN.md section 4.1).
 */
export class HttpProjectFS implements ProjectFS {
  private cachedList: FsEntry[] | undefined

  constructor(private base = '') {}

  private url(path: string): string {
    return `${this.base}${path}`
  }

  async project(): Promise<{
    root: string
    configPath?: string
    config: unknown
    maps: string[]
    tilesets: string[]
    images: string[]
  }> {
    const res = await fetch(this.url('/api/project'))
    if (!res.ok) throw new Error(`Nie udało się wczytać projektu (${res.status})`)
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
