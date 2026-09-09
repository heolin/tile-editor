import { createReadStream, promises as fs, watch as fsWatch } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join } from 'node:path'
import { scanProject } from '@tile-editor/core'
import { NodeProjectFS } from './node-fs.js'

export { NodeProjectFS }

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.woff2': 'font/woff2',
}

export interface ServerOptions {
  root: string
  port?: number
  host?: string
  /** Folder holding the built UI. Omitted during UI development. */
  uiDir?: string
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  })
  res.end(text)
}

function sendText(res: ServerResponse, status: number, text: string, type = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(text), 'cache-control': 'no-store' })
  res.end(text)
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

export async function startServer(options: ServerOptions) {
  const root = options.root
  const port = options.port ?? 4173
  const host = options.host ?? '127.0.0.1'
  const projectFs = new NodeProjectFS(root)

  /** Connected browsers, notified when a file changes underneath them. */
  const listeners = new Set<ServerResponse>()
  const broadcast = (event: string, data: unknown) => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const res of listeners) res.write(frame)
  }

  let watcher: ReturnType<typeof fsWatch> | undefined
  try {
    // Android's inotify limits make recursive watching unreliable, so a failure
    // here downgrades to no live reload rather than taking the server down.
    watcher = fsWatch(root, { recursive: true }, (_type, filename) => {
      if (!filename) return
      const path = filename.toString().split(/[\\/]/).join('/')
      if (path.includes('node_modules') || path.includes('/.') || path.endsWith('.tmp')) return
      broadcast('changed', { path })
    })
  } catch {
    watcher = undefined
  }

  const serveStatic = async (res: ServerResponse, dir: string, rel: string): Promise<boolean> => {
    const abs = join(dir, rel)
    if (!abs.startsWith(dir)) return false
    try {
      const stat = await fs.stat(abs)
      if (!stat.isFile()) return false
      res.writeHead(200, {
        'content-type': MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream',
        'content-length': stat.size,
      })
      createReadStream(abs).pipe(res)
      return true
    } catch {
      return false
    }
  }

  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
    })
  })

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const path = decodeURIComponent(url.pathname)

    if (path === '/api/project') {
      const contents = await scanProject(projectFs)
      sendJson(res, 200, { root, ...contents })
      return
    }

    if (path === '/api/file') {
      const target = url.searchParams.get('path')
      if (!target) return sendJson(res, 400, { error: 'missing path' })
      if (req.method === 'PUT' || req.method === 'POST') {
        const body = await readBody(req)
        await projectFs.writeText(target, body)
        broadcast('saved', { path: target })
        return sendJson(res, 200, { ok: true, path: target })
      }
      try {
        return sendText(res, 200, await projectFs.readText(target))
      } catch {
        return sendJson(res, 404, { error: `not found: ${target}` })
      }
    }

    if (path === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      res.write('event: ready\ndata: {}\n\n')
      listeners.add(res)
      req.on('close', () => listeners.delete(res))
      return
    }

    if (path.startsWith('/assets/')) {
      const rel = path.slice('/assets/'.length)
      try {
        if (await serveStatic(res, root, rel)) return
      } catch {
        // falls through to 404
      }
      return sendJson(res, 404, { error: `asset not found: ${rel}` })
    }

    if (options.uiDir) {
      const rel = path === '/' ? 'index.html' : path.replace(/^\//, '')
      if (await serveStatic(res, options.uiDir, rel)) return
      // Unknown paths fall back to the SPA shell.
      if (await serveStatic(res, options.uiDir, 'index.html')) return
    }

    sendJson(res, 404, { error: 'not found' })
  }

  await new Promise<void>((resolveListen) => server.listen(port, host, resolveListen))

  return {
    url: `http://${host}:${port}`,
    port,
    async close(): Promise<void> {
      watcher?.close()
      for (const res of listeners) res.end()
      await new Promise<void>((done) => server.close(() => done()))
    },
  }
}
