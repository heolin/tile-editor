import { promises as fs } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import type { FsEntry, ProjectFS } from '@tile-editor/core'
import { normalizePath } from '@tile-editor/core'

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.cache', '.vite', 'coverage'])

/** Reads and writes a project folder on the local filesystem. */
export class NodeProjectFS implements ProjectFS {
  constructor(readonly root: string) {}

  /** Rejects any path that would escape the project root. */
  absolute(path: string): string {
    const normalized = normalizePath(path)
    const abs = resolve(this.root, normalized)
    const rel = relative(this.root, abs)
    if (rel.startsWith('..' + sep) || rel === '..') {
      throw new Error(`Path escapes the project root: ${path}`)
    }
    return abs
  }

  async listAll(): Promise<FsEntry[]> {
    const out: FsEntry[] = []
    const walk = async (dir: string): Promise<void> => {
      let entries
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.tiled-project') continue
        const abs = join(dir, entry.name)
        const rel = relative(this.root, abs).split(sep).join('/')
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue
          out.push({ path: rel, kind: 'dir' })
          await walk(abs)
        } else if (entry.isFile()) {
          const stat = await fs.stat(abs).catch(() => undefined)
          out.push({ path: rel, kind: 'file', size: stat?.size, mtime: stat?.mtimeMs })
        }
      }
    }
    await walk(this.root)
    return out
  }

  async readText(path: string): Promise<string> {
    return fs.readFile(this.absolute(path), 'utf8')
  }

  async writeText(path: string, content: string): Promise<void> {
    const abs = this.absolute(path)
    // Write beside the target and rename, so an interrupted save cannot leave
    // a half-written map behind.
    const tmp = `${abs}.tmp-${process.pid}`
    await fs.writeFile(tmp, content, 'utf8')
    await fs.rename(tmp, abs)
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fs.access(this.absolute(path))
      return true
    } catch {
      return false
    }
  }

  assetUrl(path: string): string {
    return '/assets/' + normalizePath(path).split('/').map(encodeURIComponent).join('/')
  }
}
