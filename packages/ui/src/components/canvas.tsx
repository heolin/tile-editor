import { useEffect, useRef, useState } from 'react'
import {
  AddObjectCommand, RemoveObjectsCommand, SetTilesCommand, UpdateObjectsCommand,
  tilesetForGid, type MapObject,
} from '@tile-editor/core'
import { floodFill, makeTileObject, paintStamp, useEditor, type Stamp } from '../state/store'
import { tileObjectAnchor } from '../render/tile-source'
import { createRenderer, type PixiTileRenderer } from '../render/pixi-renderer'

interface PointerRecord {
  id: number
  type: string
  clientX: number
  clientY: number
}

type Drag =
  | { kind: 'none' }
  | { kind: 'paint'; command: SetTilesCommand }
  | { kind: 'pan'; lastX: number; lastY: number }
  | { kind: 'pinch'; startDist: number; startZoom: number; startMid: { x: number; y: number }; startCam: { x: number; y: number } }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; mode: 'rect' | 'pick' }
  | { kind: 'moveObjects'; objects: MapObject[]; startX: number; startY: number; origin: { x: number; y: number }[] }

/**
 * The map canvas. Owns all pointer input, because the tablet needs gestures the
 * DOM will not give us for free: two fingers pan and zoom at once, one finger
 * runs the active tool, and a stylus behaves like a precise mouse with hover.
 */
export function MapCanvas() {
  const hostRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<PixiTileRenderer>(null)
  const dragRef = useRef<Drag>({ kind: 'none' })
  const pointersRef = useRef(new Map<number, PointerRecord>())
  const strokeRef = useRef(0)
  const [mounted, setMounted] = useState(false)

  const doc = useEditor((s) => s.doc)
  const revision = useEditor((s) => s.revision)
  const sourceRevision = useEditor((s) => s.sourceRevision)
  const camera = useEditor((s) => s.camera)
  const tool = useEditor((s) => s.tool)
  const stamp = useEditor((s) => s.stamp)
  const showGrid = useEditor((s) => s.showGrid)
  const showObjects = useEditor((s) => s.showObjects)
  const activeLayerId = useEditor((s) => s.activeLayerId)
  const selectedObjectIds = useEditor((s) => s.selectedObjectIds)
  const [hover, setHover] = useState<{ x: number; y: number } | undefined>()
  const [marquee, setMarquee] = useState<Drag & { kind: 'marquee' } | undefined>()

  /* ---------------- renderer lifecycle ---------------- */

  useEffect(() => {
    let disposed = false
    let renderer: PixiTileRenderer | undefined
    void createRenderer().then((created) => {
      if (disposed) {
        created.destroy()
        return
      }
      renderer = created
      rendererRef.current = created
      // Diagnostic handle used by scripts/bench.mjs to time draws directly
      // rather than inferring cost from frame scheduling.
      ;(window as unknown as { __tileEditor?: unknown }).__tileEditor = created
      if (hostRef.current) created.mount(hostRef.current)
      setMounted(true)
    })
    return () => {
      disposed = true
      renderer?.destroy()
      rendererRef.current = null
    }
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const observer = new ResizeObserver(() => {
      rendererRef.current?.resize()
      redraw()
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [mounted])

  // Load textures whenever a different map is opened.
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer || !doc) return
    let cancelled = false
    const first = renderer.documentPath !== doc.path
    void renderer.setDocument(doc.map, doc.source).then(() => {
      if (cancelled) return
      // Only re-frame when a different map opened; adding tiles should not
      // yank the view away from what the user was working on.
      if (first) fitToView()
      else redraw()
    })
    return () => {
      cancelled = true
    }
  }, [doc?.path, sourceRevision, mounted])

  function redraw(): void {
    const renderer = rendererRef.current
    const state = useEditor.getState()
    if (!renderer || !state.doc) return
    renderer.draw({
      camera: state.camera,
      revision: state.revision,
      showGrid: state.showGrid,
      showObjects: state.showObjects,
      activeLayerId: state.activeLayerId,
      hover,
      hoverStamp: state.tool === 'brush' || state.tool === 'object' ? state.stamp : undefined,
      selectedObjectIds: state.selectedObjectIds,
      marquee: marquee ? { x0: marquee.x0, y0: marquee.y0, x1: marquee.x1, y1: marquee.y1 } : undefined,
    })
  }

  useEffect(redraw, [revision, camera, showGrid, showObjects, hover, marquee, selectedObjectIds, tool, stamp, mounted])

  function fitToView(): void {
    const host = hostRef.current
    const state = useEditor.getState()
    if (!host || !state.doc) return
    const rect = host.getBoundingClientRect()
    const map = state.doc.map
    const worldW = map.width * map.tilewidth
    const worldH = map.height * map.tileheight
    const padding = 32
    const zoom = Math.min(
      (rect.width - padding * 2) / Math.max(1, worldW),
      (rect.height - padding * 2) / Math.max(1, worldH),
    )
    const clamped = Math.max(0.02, Math.min(zoom, 4))
    state.setCamera({
      zoom: clamped,
      x: (rect.width - worldW * clamped) / 2,
      y: (rect.height - worldH * clamped) / 2,
    })
  }

  /* ---------------- coordinate helpers ---------------- */

  function tileAt(clientX: number, clientY: number): { x: number; y: number } | undefined {
    const renderer = rendererRef.current
    const map = useEditor.getState().doc?.map
    if (!renderer || !map) return undefined
    const world = renderer.toWorld(clientX, clientY)
    return {
      x: Math.floor(world.x / map.tilewidth),
      y: Math.floor(world.y / map.tileheight),
    }
  }

  function inBounds(p: { x: number; y: number }): boolean {
    const map = useEditor.getState().doc?.map
    if (!map) return false
    return p.x >= 0 && p.y >= 0 && p.x < map.width && p.y < map.height
  }

  /* ---------------- tools ---------------- */

  function beginPaint(clientX: number, clientY: number): void {
    const state = useEditor.getState()
    const layer = state.activeTileLayer()
    const cell = tileAt(clientX, clientY)
    if (!layer || !cell || !inBounds(cell)) return

    if (state.tool === 'picker') {
      const gid = layer.data.get(cell.x, cell.y)
      state.setStamp({ width: 1, height: 1, gids: [gid] })
      state.setTool('brush')
      return
    }

    strokeRef.current += 1
    const stroke = String(strokeRef.current)

    if (state.tool === 'fill') {
      const command = new SetTilesCommand('Wypełnij', layer, stroke)
      floodFill(layer, cell.x, cell.y, state.stamp?.gids[0] ?? 0, command)
      if (!command.empty) {
        state.history.run(command)
        state.touch()
      }
      return
    }

    if (state.tool === 'rect') {
      setMarquee({ kind: 'marquee', x0: cell.x, y0: cell.y, x1: cell.x, y1: cell.y, mode: 'rect' })
      dragRef.current = { kind: 'marquee', x0: cell.x, y0: cell.y, x1: cell.x, y1: cell.y, mode: 'rect' }
      return
    }

    const command = new SetTilesCommand(state.tool === 'eraser' ? 'Wymaż' : 'Maluj', layer, stroke)
    applyBrush(command, cell)
    dragRef.current = { kind: 'paint', command }
    state.history.run(command)
    state.touch()
  }

  function applyBrush(command: SetTilesCommand, cell: { x: number; y: number }): void {
    const state = useEditor.getState()
    if (state.tool === 'eraser') command.add(cell.x, cell.y, 0)
    else if (state.stamp) paintStamp(command, state.stamp, cell.x, cell.y)
  }

  /** Places a tile object covering the clicked cell, using the current stamp. */
  function placeObject(clientX: number, clientY: number): void {
    const state = useEditor.getState()
    const layer = state.activeObjectLayer()
    const cell = tileAt(clientX, clientY)
    const gid = state.stamp?.gids[0]
    const map = state.doc?.map
    if (!layer || !cell || !map) return
    if (!gid) {
      state.notify('Wybierz najpierw kafel w panelu tilesetów.', 'error')
      return
    }
    const ref = tilesetForGid(map, gid)
    const tileset = ref?.tileset
    const frame = state.doc!.source.frame(gid)
    const object = makeTileObject(map, gid, cell.x, cell.y, tileObjectAnchor(tileset), {
      width: frame?.sw ?? map.tilewidth,
      height: frame?.sh ?? map.tileheight,
    })
    state.history.run(new AddObjectCommand(layer, object, map))
    state.selectObjects([object.id])
    state.touch()
  }

  function beginSelect(clientX: number, clientY: number): boolean {
    const state = useEditor.getState()
    const layer = state.activeObjectLayer()
    const renderer = rendererRef.current
    if (!layer || !renderer) return false
    const world = renderer.toWorld(clientX, clientY)
    const hit = renderer.hitTestObject(layer, world.x, world.y)
    if (!hit) {
      state.selectObjects([])
      return false
    }
    const already = state.selectedObjectIds.includes(hit.id)
    const objects = already ? state.selectedObjects() : [hit]
    if (!already) state.selectObjects([hit.id])
    dragRef.current = {
      kind: 'moveObjects',
      objects,
      startX: world.x,
      startY: world.y,
      origin: objects.map((o) => ({ x: o.x, y: o.y })),
    }
    return true
  }

  /* ---------------- pointer plumbing ---------------- */

  function midpoint(a: PointerRecord, b: PointerRecord) {
    return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }
  }

  function distance(a: PointerRecord, b: PointerRecord) {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
  }

  function onPointerDown(event: React.PointerEvent): void {
    const host = hostRef.current
    if (!host) return
    host.setPointerCapture(event.pointerId)
    pointersRef.current.set(event.pointerId, {
      id: event.pointerId,
      type: event.pointerType,
      clientX: event.clientX,
      clientY: event.clientY,
    })

    const pointers = [...pointersRef.current.values()]
    if (pointers.length === 2) {
      // A second finger cancels whatever the first one started and becomes a
      // combined pan and zoom, which is how every map app on a phone behaves.
      cancelDrag()
      const [a, b] = pointers as [PointerRecord, PointerRecord]
      const state = useEditor.getState()
      dragRef.current = {
        kind: 'pinch',
        startDist: Math.max(1, distance(a, b)),
        startZoom: state.camera.zoom,
        startMid: midpoint(a, b),
        startCam: { x: state.camera.x, y: state.camera.y },
      }
      return
    }
    if (pointers.length > 2) return

    const panning = event.button === 1 || event.altKey || useEditor.getState().tool === 'select' && event.shiftKey
    if (panning) {
      dragRef.current = { kind: 'pan', lastX: event.clientX, lastY: event.clientY }
      return
    }

    const state = useEditor.getState()
    if (state.tool === 'object') {
      placeObject(event.clientX, event.clientY)
      return
    }
    if (state.tool === 'select') {
      if (!beginSelect(event.clientX, event.clientY)) {
        dragRef.current = { kind: 'pan', lastX: event.clientX, lastY: event.clientY }
      }
      return
    }
    beginPaint(event.clientX, event.clientY)
  }

  function onPointerMove(event: React.PointerEvent): void {
    const record = pointersRef.current.get(event.pointerId)
    if (record) {
      record.clientX = event.clientX
      record.clientY = event.clientY
    }

    const state = useEditor.getState()
    const drag = dragRef.current

    if (drag.kind === 'pinch') {
      const pointers = [...pointersRef.current.values()]
      if (pointers.length < 2) return
      const [a, b] = pointers as [PointerRecord, PointerRecord]
      const ratio = Math.max(1, distance(a, b)) / drag.startDist
      const zoom = Math.max(0.05, Math.min(8, drag.startZoom * ratio))
      const mid = midpoint(a, b)
      const host = hostRef.current!.getBoundingClientRect()
      // Keep the point between the fingers pinned while the scale changes.
      const anchorX = drag.startMid.x - host.left
      const anchorY = drag.startMid.y - host.top
      const worldX = (anchorX - drag.startCam.x) / drag.startZoom
      const worldY = (anchorY - drag.startCam.y) / drag.startZoom
      state.setCamera({
        zoom,
        x: mid.x - host.left - worldX * zoom,
        y: mid.y - host.top - worldY * zoom,
      })
      return
    }

    if (drag.kind === 'pan') {
      state.setCamera({
        x: state.camera.x + (event.clientX - drag.lastX),
        y: state.camera.y + (event.clientY - drag.lastY),
      })
      drag.lastX = event.clientX
      drag.lastY = event.clientY
      return
    }

    const cell = tileAt(event.clientX, event.clientY)
    if (cell && (!hover || hover.x !== cell.x || hover.y !== cell.y)) setHover(cell)

    if (drag.kind === 'paint' && cell && inBounds(cell)) {
      applyBrush(drag.command, cell)
      drag.command.apply()
      state.touch()
      return
    }

    if (drag.kind === 'marquee' && cell) {
      const next = { ...drag, x1: cell.x, y1: cell.y }
      dragRef.current = next
      setMarquee(next)
      return
    }

    if (drag.kind === 'moveObjects') {
      const renderer = rendererRef.current!
      const world = renderer.toWorld(event.clientX, event.clientY)
      const dx = world.x - drag.startX
      const dy = world.y - drag.startY
      const map = state.doc!.map
      // Hold nothing for free movement; snapping to the grid is the default
      // because that is what almost every placed object wants.
      const snap = !event.altKey
      const patches = drag.objects.map((_obj, i) => {
        const origin = drag.origin[i]!
        const nx = origin.x + dx
        const ny = origin.y + dy
        return snap
          ? { x: Math.round(nx / map.tilewidth) * map.tilewidth, y: Math.round(ny / map.tileheight) * map.tileheight }
          : { x: nx, y: ny }
      })
      state.history.run(
        new UpdateObjectsCommand('Przesuń obiekt', drag.objects, patches, `move:${drag.objects.map((o) => o.id).join(',')}`),
      )
      state.touch()
    }
  }

  function cancelDrag(): void {
    dragRef.current = { kind: 'none' }
    setMarquee(undefined)
  }

  function onPointerUp(event: React.PointerEvent): void {
    const state = useEditor.getState()
    const drag = dragRef.current
    pointersRef.current.delete(event.pointerId)

    if (drag.kind === 'marquee') {
      const layer = state.activeTileLayer()
      if (layer) {
        strokeRef.current += 1
        const command = new SetTilesCommand('Prostokąt', layer, String(strokeRef.current))
        const left = Math.min(drag.x0, drag.x1)
        const right = Math.max(drag.x0, drag.x1)
        const top = Math.min(drag.y0, drag.y1)
        const bottom = Math.max(drag.y0, drag.y1)
        const gid = state.stamp?.gids[0] ?? 0
        for (let y = top; y <= bottom; y++) {
          for (let x = left; x <= right; x++) command.add(x, y, gid)
        }
        if (!command.empty) {
          state.history.run(command)
          state.touch()
        }
      }
    }

    if (pointersRef.current.size === 0) cancelDrag()
    else if (drag.kind === 'pinch') dragRef.current = { kind: 'none' }
  }

  function onWheel(event: React.WheelEvent): void {
    const host = hostRef.current
    const state = useEditor.getState()
    if (!host) return
    const rect = host.getBoundingClientRect()
    const anchorX = event.clientX - rect.left
    const anchorY = event.clientY - rect.top
    const factor = Math.exp(-event.deltaY * 0.0015)
    const zoom = Math.max(0.05, Math.min(8, state.camera.zoom * factor))
    const worldX = (anchorX - state.camera.x) / state.camera.zoom
    const worldY = (anchorY - state.camera.y) / state.camera.zoom
    state.setCamera({ zoom, x: anchorX - worldX * zoom, y: anchorY - worldY * zoom })
  }

  return (
    <div
      ref={hostRef}
      className="relative h-full w-full touch-none overflow-hidden bg-ground"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHover(undefined)}
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      {!doc ? (
        <div className="flex h-full items-center justify-center text-[13px] text-ink-faint">
          Wybierz mapę z panelu projektu.
        </div>
      ) : null}
      <CanvasHud hover={hover} onFit={fitToView} />
    </div>
  )
}

function CanvasHud({ hover, onFit }: { hover?: { x: number; y: number }; onFit: () => void }) {
  const zoom = useEditor((s) => s.camera.zoom)
  const doc = useEditor((s) => s.doc)
  if (!doc) return null
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-2 rounded-md bg-surface/85 px-2 py-1 text-[11px] text-ink-faint backdrop-blur">
      <span className="num">{doc.map.width}×{doc.map.height}</span>
      <span className="text-line-strong">·</span>
      <span className="num">{hover ? `${hover.x}, ${hover.y}` : '—'}</span>
      <span className="text-line-strong">·</span>
      <button type="button" className="pointer-events-auto num hover:text-ink" onClick={onFit}>
        {Math.round(zoom * 100)}%
      </button>
    </div>
  )
}

export { type Stamp }
