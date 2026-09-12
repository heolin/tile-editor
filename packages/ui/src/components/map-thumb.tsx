import { useEffect, useRef, useState } from 'react'
import { buildTileSourceIndex } from '../render/tile-source'
import { renderThumbnail } from '../render/thumbnail'
import { readThumb, thumbKey, writeThumb } from '../state/thumbs'
import { useEditor } from '../state/store'

/**
 * Drawing a thumbnail means fetching and parsing a map, so this does it for one
 * map at a time and only once it is actually on screen. A project of 115 levels
 * would otherwise open by downloading all of them at once.
 */
const memory = new Map<string, string>()
let queue: Promise<unknown> = Promise.resolve()

/** Drops a map's thumbnails from the in-memory cache, whatever stamp they carry. */
export function forgetThumb(root: string, path: string): void {
  const prefix = `${root}::${path}::`
  for (const key of [...memory.keys()]) if (key.startsWith(prefix)) memory.delete(key)
}

async function build(path: string, key: string): Promise<string | undefined> {
  const cached = memory.get(key) ?? (await readThumb(key))?.dataUrl
  if (cached) {
    memory.set(key, cached)
    return cached
  }
  const state = useEditor.getState()
  const loader = state.loader
  if (!loader) return undefined
  const loaded = await loader.loadMap(path)
  const source = buildTileSourceIndex(loaded.map, (p) => state.fs.assetUrl(p))
  const dataUrl = await renderThumbnail(loaded.map, source, { size: 200 })
  if (!dataUrl) return undefined
  memory.set(key, dataUrl)
  void writeThumb({ key, root: state.root, path, dataUrl, madeAt: Date.now() })
  return dataUrl
}

export function MapThumb({ path, className }: { path: string; className?: string }) {
  const root = useEditor((s) => s.root)
  const stamp = useEditor((s) => s.project?.stamps[path])
  const key = thumbKey(root, path, stamp)
  const [src, setSrc] = useState(() => memory.get(key))
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const held = memory.get(key)
    if (held) {
      setSrc(held)
      return
    }
    setSrc(undefined)
    const node = ref.current
    if (!node) return
    let cancelled = false
    let running = false
    let attempts = 0
    let retry: ReturnType<typeof setTimeout> | undefined

    const observer = new IntersectionObserver((entries) => {
      if (running || !entries.some((entry) => entry.isIntersecting)) return
      running = true
      attempts++
      // One at a time: the queue is what keeps scrolling smooth and the server
      // from being asked for a hundred maps in the same breath.
      queue = queue
        .then(() => (cancelled ? undefined : build(path, key)))
        .then((dataUrl) => {
          if (cancelled) return
          if (dataUrl) {
            observer.disconnect()
            setSrc(dataUrl)
            return
          }
          // Nothing came back. Re-observing asks again as soon as the cell is
          // still on screen, rather than leaving a permanent hole in the grid.
          running = false
          if (attempts < 3) {
            retry = setTimeout(() => {
              if (cancelled) return
              observer.unobserve(node)
              observer.observe(node)
            }, 400)
          }
        })
        .catch(() => {
          running = false
        })
    }, {
      // A generous margin: a fast scroll can otherwise carry a cell past the
      // viewport before the observer's first callback lands, and a cell that
      // never reports as visible never gets drawn.
      rootMargin: '400px 0px',
    })
    observer.observe(node)
    return () => {
      cancelled = true
      if (retry !== undefined) clearTimeout(retry)
      observer.disconnect()
    }
  }, [key, path])

  return (
    <div ref={ref} className={className}>
      {src ? (
        <img src={src} alt="" loading="lazy" className="h-full w-full object-contain [image-rendering:pixelated]" />
      ) : null}
    </div>
  )
}
