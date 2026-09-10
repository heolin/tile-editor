import { useEffect, useRef, useState } from 'react'
import {
  AddObjectCommand, RemoveObjectsCommand, SetTilesCommand, UpdateObjectsCommand,
  boxBounds, boundsIntersect, resizeBox, rotationTowards, tilesetForGid,
  type Anchor, type Box, type HandleId, type MapObject,
} from '@tile-editor/core'
import { ContextMenu, type MenuItem } from './context-menu'
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
  | {
      kind: 'pinch'
      startDist: number
      startZoom: number
      startMid: { x: number; y: number }
      startCam: { x: number; y: number }
      /** Used to tell a two-finger tap from the start of a pinch. */
      startedAt: number
      moved: number
    }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; mode: 'rect' | 'pick' }
  | { kind: 'moveObjects'; objects: MapObject[]; startX: number; startY: number; origin: { x: number; y: number }[] }
  | { kind: 'resizeObject'; object: MapObject; handle: Exclude<HandleId, 'rotate'>; anchor: Anchor; start: Box }
  | { kind: 'rotateObject'; object: MapObject; start: Box }
  | { kind: 'selectBox'; x0: number; y0: number; x1: number; y1: number; additive: boolean }

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
  const animate = useEditor((s) => s.animate)
  const activeLayerId = useEditor((s) => s.activeLayerId)
  const selectedObjectIds = useEditor((s) => s.selectedObjectIds)
  const [hover, setHover] = useState<{ x: number; y: number } | undefined>()
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | undefined>()
  const longPressRef = useRef<{ timer: number; x: number; y: number } | null>(null)
  const [marquee, setMarquee] = useState<Drag & { kind: 'marquee' } | undefined>()
  const [selectBox, setSelectBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | undefined>()

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
      // Diagnostic handle used by scripts/bench.mjs and scripts/smoke.mjs, to
      // measure the renderer and read editor state directly rather than
      // inferring either from the DOM.
      ;(window as unknown as { __tileEditor?: unknown }).__tileEditor =
        Object.assign(created, { state: () => useEditor.getState() })
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
      timeMs: state.animate ? performance.now() : undefined,
      // The tile cursor means nothing while picking objects, and sits on top of
      // the very handles the user is aiming at.
      hover: state.tool === 'select' ? undefined : hover,
      hoverStamp: state.tool === 'brush' || state.tool === 'object' ? state.stamp : undefined,
      selectedObjectIds: state.selectedObjectIds,
      showHandles: selectBox === undefined,
      selectionRect: selectBox,
      marquee: marquee ? { x0: marquee.x0, y0: marquee.y0, x1: marquee.x1, y1: marquee.y1 } : undefined,
    })
  }

  useEffect(redraw, [revision, camera, showGrid, showObjects, animate, hover, marquee, selectBox, selectedObjectIds, tool, stamp, mounted])

  // Animation is the one thing that needs a running clock. Everything else
  // draws on demand, so the loop exists only while the toggle is on.
  useEffect(() => {
    if (!animate || !mounted) return
    let frame = 0
    const tick = () => {
      redraw()
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [animate, mounted, revision])

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

  /** Builds the menu for whatever sits under the pointer. */
  function menuItemsAt(clientX: number, clientY: number): MenuItem[] {
    const state = useEditor.getState()
    const renderer = rendererRef.current
    const cell = tileAt(clientX, clientY)
    if (!renderer || !cell || !state.doc) return []

    const objectLayer = state.activeObjectLayer()
    if (objectLayer) {
      const world = renderer.toWorld(clientX, clientY)
      const hit = renderer.hitTestObject(objectLayer, world.x, world.y)
      if (hit) {
        return [
          {
            label: 'Właściwości',
            onSelect: () => {
              state.selectObjects([hit.id])
              state.setPropertyTarget({ kind: 'object', id: hit.id })
              state.setPanel('properties')
            },
          },
          {
            label: 'Duplikuj',
            onSelect: () => {
              const copy: MapObject = {
                ...hit,
                id: state.doc!.map.nextobjectid,
                x: hit.x + state.doc!.map.tilewidth,
                properties: hit.properties.map((p) => ({ ...p })),
              }
              state.history.run(new AddObjectCommand(objectLayer, copy, state.doc!.map))
              state.selectObjects([copy.id])
              state.touch()
            },
          },
          {
            label: 'Usuń obiekt',
            danger: true,
            hint: 'Del',
            onSelect: () => {
              state.history.run(new RemoveObjectsCommand(objectLayer, [hit]))
              state.selectObjects([])
              state.touch()
            },
          },
        ]
      }
      return state.stamp
        ? [{ label: 'Postaw obiekt tutaj', onSelect: () => placeObject(clientX, clientY) }]
        : []
    }

    const tileLayer = state.activeTileLayer()
    if (!tileLayer || !inBounds(cell)) return []
    const gid = tileLayer.data.get(cell.x, cell.y)
    const items: MenuItem[] = []
    if (gid !== 0) {
      items.push({
        label: 'Pobierz kafel',
        hint: 'I',
        onSelect: () => {
          state.setStamp({ width: 1, height: 1, gids: [gid] })
          state.setTool('brush')
        },
      })
      items.push({
        label: 'Wyczyść kafel',
        danger: true,
        onSelect: () => {
          strokeRef.current += 1
          const command = new SetTilesCommand('Wymaż', tileLayer, String(strokeRef.current))
          command.add(cell.x, cell.y, 0)
          if (!command.empty) {
            state.history.run(command)
            state.touch()
          }
        },
      })
    }
    items.push({
      label: 'Wypełnij tym kaflem',
      hint: 'F',
      onSelect: () => {
        strokeRef.current += 1
        const command = new SetTilesCommand('Wypełnij', tileLayer, String(strokeRef.current))
        floodFill(tileLayer, cell.x, cell.y, state.stamp?.gids[0] ?? 0, command)
        if (!command.empty) {
          state.history.run(command)
          state.touch()
        }
      },
    })
    return items
  }

  function openMenu(clientX: number, clientY: number): void {
    const items = menuItemsAt(clientX, clientY)
    if (items.length > 0) setMenu({ x: clientX, y: clientY, items })
  }

  function cancelLongPress(): void {
    if (longPressRef.current) {
      window.clearTimeout(longPressRef.current.timer)
      longPressRef.current = null
    }
  }

  /** A handle under the pointer, tested in screen space so it stays grabbable. */
  function handleAt(clientX: number, clientY: number): { id: HandleId; object: MapObject } | undefined {
    const state = useEditor.getState()
    const renderer = rendererRef.current
    if (!renderer || state.selectedObjectIds.length !== 1) return undefined
    const layer = state.activeObjectLayer()
    const object = layer?.objects.find((o) => o.id === state.selectedObjectIds[0])
    if (!object) return undefined

    const coarse = window.matchMedia('(pointer: coarse)').matches
    const tolerance = coarse ? 22 : 11
    for (const handle of renderer.handlesFor(object)) {
      const screen = renderer.toScreen(handle.point.x, handle.point.y)
      const host = hostRef.current!.getBoundingClientRect()
      if (Math.hypot(screen.x - (clientX - host.left), screen.y - (clientY - host.top)) <= tolerance) {
        return { id: handle.id, object }
      }
    }
    return undefined
  }

  function beginSelect(clientX: number, clientY: number): boolean {
    const state = useEditor.getState()
    const layer = state.activeObjectLayer()
    const renderer = rendererRef.current
    if (!layer || !renderer) return false

    // Handles win over everything: they sit on top of the object they belong to.
    const grabbed = handleAt(clientX, clientY)
    if (grabbed) {
      const start = renderer.boxOf(grabbed.object)
      dragRef.current =
        grabbed.id === 'rotate'
          ? { kind: 'rotateObject', object: grabbed.object, start }
          : {
              kind: 'resizeObject',
              object: grabbed.object,
              handle: grabbed.id,
              anchor: renderer.anchorOf(grabbed.object),
              start,
            }
      return true
    }

    const world = renderer.toWorld(clientX, clientY)
    const hit = renderer.hitTestObject(layer, world.x, world.y)
    if (!hit) {
      // Empty space starts a rubber band rather than clearing straight away, so
      // a stray tap does not lose the selection until the drag is over.
      dragRef.current = {
        kind: 'selectBox',
        x0: world.x,
        y0: world.y,
        x1: world.x,
        y1: world.y,
        additive: false,
      }
      setSelectBox({ x0: world.x, y0: world.y, x1: world.x, y1: world.y })
      return true
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
    try {
      host.setPointerCapture(event.pointerId)
    } catch {
      // Capture is an optimisation; losing it must not abort the gesture.
    }
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
        startedAt: performance.now(),
        moved: 0,
      }
      return
    }
    if (pointers.length > 2) return

    if (event.button === 2) {
      openMenu(event.clientX, event.clientY)
      return
    }

    // A press held in place opens the context menu, since a tablet has no
    // right button. Anything the press already started is rolled back first.
    if (event.pointerType === 'touch') {
      const { clientX, clientY } = event
      cancelLongPress()
      longPressRef.current = {
        x: clientX,
        y: clientY,
        timer: window.setTimeout(() => {
          longPressRef.current = null
          const state = useEditor.getState()
          if (dragRef.current.kind === 'paint') state.undo()
          cancelDrag()
          openMenu(clientX, clientY)
        }, 480),
      }
    }

    const panning = event.button === 1 || event.altKey || useEditor.getState().tool === 'select' && event.shiftKey
    if (panning) {
      dragRef.current = { kind: 'pan', lastX: event.clientX, lastY: event.clientY }
      return
    }

    const state = useEditor.getState()
    if (state.tool === 'object') {
      // A handle stays grabbable even with the placing tool active, so the
      // object just put down can be sized without switching tools.
      if (handleAt(event.clientX, event.clientY)) {
        beginSelect(event.clientX, event.clientY)
        return
      }
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

    const press = longPressRef.current
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) cancelLongPress()

    if (drag.kind === 'pinch') {
      drag.moved += Math.abs(event.movementX ?? 0) + Math.abs(event.movementY ?? 0)
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

    if (drag.kind === 'resizeObject') {
      const renderer = rendererRef.current!
      const map = state.doc!.map
      const pointer = renderer.toWorld(event.clientX, event.clientY)
      const next = resizeBox(drag.start, drag.anchor, drag.handle, pointer, {
        snap: event.altKey ? undefined : { x: map.tilewidth, y: map.tileheight },
        minimum: 1,
      })
      state.history.run(
        new UpdateObjectsCommand(
          'Zmień rozmiar obiektu',
          [drag.object],
          [{ x: next.x, y: next.y, width: next.width, height: next.height }],
          `resize:${drag.object.id}`,
        ),
      )
      state.touch()
      return
    }

    if (drag.kind === 'rotateObject') {
      const renderer = rendererRef.current!
      const pointer = renderer.toWorld(event.clientX, event.clientY)
      const rotation = rotationTowards(drag.start, pointer, event.altKey ? 0 : 15)
      state.history.run(
        new UpdateObjectsCommand('Obróć obiekt', [drag.object], [{ rotation }], `rotate:${drag.object.id}`),
      )
      state.touch()
      return
    }

    if (drag.kind === 'selectBox') {
      const renderer = rendererRef.current!
      const pointer = renderer.toWorld(event.clientX, event.clientY)
      drag.x1 = pointer.x
      drag.y1 = pointer.y
      setSelectBox({ x0: drag.x0, y0: drag.y0, x1: pointer.x, y1: pointer.y })
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
    setSelectBox(undefined)
  }

  function onPointerUp(event: React.PointerEvent): void {
    const state = useEditor.getState()
    const drag = dragRef.current
    pointersRef.current.delete(event.pointerId)
    cancelLongPress()

    // Two fingers down and straight back up is the undo gesture; the same two
    // fingers held and moved is a pan and zoom.
    if (drag.kind === 'pinch' && performance.now() - drag.startedAt < 260 && drag.moved < 16) {
      state.undo()
      dragRef.current = { kind: 'none' }
      pointersRef.current.clear()
      return
    }

    if (drag.kind === 'selectBox') {
      const renderer = rendererRef.current
      const layer = state.activeObjectLayer()
      const bounds = {
        left: Math.min(drag.x0, drag.x1),
        top: Math.min(drag.y0, drag.y1),
        right: Math.max(drag.x0, drag.x1),
        bottom: Math.max(drag.y0, drag.y1),
      }
      // A band barely dragged is a click on empty space: clear the selection.
      const tiny = bounds.right - bounds.left < 3 && bounds.bottom - bounds.top < 3
      if (layer && renderer && !tiny) {
        const caught = layer.objects.filter(
          (obj) => obj.visible && boundsIntersect(boxBounds(renderer.boxOf(obj), renderer.anchorOf(obj)), bounds),
        )
        state.selectObjects(caught.map((obj) => obj.id))
      } else {
        state.selectObjects([])
      }
      setSelectBox(undefined)
    }

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
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(undefined)} /> : null}
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
