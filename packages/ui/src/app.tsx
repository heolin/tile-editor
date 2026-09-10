import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Command, FolderTree, Layers, Palette, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { RemoveObjectsCommand, mapTitle } from '@tile-editor/core'
import { MapCanvas } from './components/canvas'
import { LayersPanel } from './components/layers-panel'
import { LintPanel } from './components/lint-panel'
import { ProjectPanel } from './components/project-panel'
import { PropertiesPanel } from './components/properties-panel'
import { TilesetPanel } from './components/tileset-panel'
import { HistoryControls, ToolBar, ViewControls } from './components/toolbar'
import { CommandPalette } from './components/command-palette'
import { ConnectScreen } from './components/connect-screen'
import { NewMapDialog } from './components/new-map-dialog'
import { AddTilesetDialog } from './components/tileset-dialogs'
import { Button, Sheet, Toast } from './components/ui'
import { useEditor, type PanelId } from './state/store'

const PANELS: { id: PanelId; label: string; icon: typeof Layers }[] = [
  { id: 'project', label: 'Projekt', icon: FolderTree },
  { id: 'layers', label: 'Warstwy', icon: Layers },
  { id: 'tilesets', label: 'Tilesety', icon: Palette },
  { id: 'properties', label: 'Properties', icon: SlidersHorizontal },
  { id: 'lint', label: 'Lint', icon: ShieldCheck },
]

function PanelBody({ id }: { id: PanelId }) {
  switch (id) {
    case 'project': return <ProjectPanel />
    case 'layers': return <LayersPanel />
    case 'tilesets': return <TilesetPanel />
    case 'properties': return <PropertiesPanel />
    case 'lint': return <LintPanel />
  }
}

/**
 * Which layout tier the viewport is in. The panels exist once in the DOM: the
 * docked column and the bottom sheet are alternatives, not a CSS-hidden pair,
 * so nothing is subscribed to the store twice or loading images twice.
 */
function useCompactLayout(): boolean {
  const [compact, setCompact] = useState(() =>
    typeof window === 'undefined' ? false : !window.matchMedia('(min-width: 768px)').matches,
  )
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)')
    const update = () => setCompact(!query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return compact
}

export function App() {
  const status = useEditor((s) => s.status)
  const error = useEditor((s) => s.error)
  const doc = useEditor((s) => s.doc)
  const dirty = useEditor((s) => s.dirty)
  const toast = useEditor((s) => s.toast)
  const openPanel = useEditor((s) => s.openPanel)
  const setPanel = useEditor((s) => s.setPanel)
  const init = useEditor((s) => s.init)
  const dialog = useEditor((s) => s.dialog)
  const setDialog = useEditor((s) => s.setDialog)
  const compact = useCompactLayout()

  useEffect(() => {
    void init()
  }, [init])

  useKeyboardShortcuts()
  useDirtyGuard(dirty)

  if (status === 'error') return <ConnectScreen error={error} />

  // On medium and wide the docked panel always shows something; on compact the
  // panels are sheets, so nothing is docked.
  const dockedPanel = openPanel ?? 'layers'

  return (
    <div className="flex h-full flex-col bg-ground">
      <header className="safe-top safe-x flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-2">
        <span className="hidden select-none px-1 text-[13px] font-semibold tracking-tight text-accent md:inline">
          tile-editor
        </span>
        <span className="mx-1 hidden h-5 w-px bg-line md:block" />
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink-dim">
          {doc ? mapTitle(doc.path) : 'brak mapy'}
          {dirty ? <span className="ml-1 text-warn">•</span> : null}
        </span>
        <Button
          onClick={() => setDialog('palette')}
          title="Paleta poleceń (Ctrl+K)"
          aria-label="Paleta poleceń"
        >
          <Command size={15} />
          <span className="num hidden text-[11px] wide:inline">Ctrl K</span>
        </Button>
        <div className="hidden md:block">
          <ViewControls />
        </div>
        <HistoryControls />
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Icon rail: the only chrome that survives on a phone. */}
        <nav className="hidden w-11 shrink-0 flex-col items-center gap-0.5 border-r border-line bg-surface py-1 md:flex" aria-label="Panele">
          {PANELS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={dockedPanel === id}
              onClick={() => setPanel(id)}
              className={clsx(
                'hit flex w-9 items-center justify-center rounded-md',
                dockedPanel === id ? 'bg-accent-deep text-accent-ink' : 'text-ink-faint hover:bg-hover hover:text-ink',
              )}
            >
              <Icon size={17} />
            </button>
          ))}
        </nav>

        {compact ? null : (
          <aside className="flex w-[240px] shrink-0 border-r border-line wide:w-[300px]">
            <PanelBody id={dockedPanel} />
          </aside>
        )}

        <main className="relative min-w-0 flex-1">
          {status === 'loading' ? (
            <div className="flex h-full items-center justify-center text-[13px] text-ink-faint">Wczytywanie projektu…</div>
          ) : (
            <MapCanvas />
          )}
        </main>
      </div>

      {/* Compact widths get the tools along the bottom, within thumb reach. The
          panels move to a second row: twelve 44px targets do not fit across a
          phone, and squeezing them pushed the panel buttons off the screen. */}
      <footer className="safe-bottom safe-x shrink-0 border-t border-line bg-surface">
        <div className="flex h-14 items-center justify-between gap-2 px-2 md:h-10">
          <ToolBar />
          <div className="hidden md:block">
            <StampPreview />
          </div>
        </div>
        {compact ? (
          <nav className="flex items-center justify-around gap-1 border-t border-line/60 px-2" aria-label="Panele">
            {PANELS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-label={label}
                aria-pressed={openPanel === id}
                onClick={() => setPanel(openPanel === id ? null : id)}
                className={clsx(
                  'hit flex flex-1 items-center justify-center rounded-md',
                  openPanel === id ? 'bg-accent-deep text-accent-ink' : 'text-ink-faint',
                )}
              >
                <Icon size={18} />
              </button>
            ))}
          </nav>
        ) : null}
      </footer>

      {compact ? (
        <Sheet
          open={openPanel !== null}
          onClose={() => setPanel(null)}
          title={PANELS.find((p) => p.id === openPanel)?.label ?? ''}
        >
          {openPanel ? <PanelBody id={openPanel} /> : null}
        </Sheet>
      ) : null}

      <CommandPalette />
      <NewMapDialog open={dialog === 'new-map'} onClose={() => setDialog(null)} />
      <AddTilesetDialog open={dialog === 'add-tileset'} onClose={() => setDialog(null)} />

      {toast ? <Toast text={toast.text} tone={toast.tone} /> : null}
    </div>
  )
}

/** Shows which tile the brush will lay down, so the tool is never a mystery. */
function StampPreview() {
  const stamp = useEditor((s) => s.stamp)
  const doc = useEditor((s) => s.doc)
  const frame = stamp && doc ? doc.source.frame(stamp.gids[0] ?? 0) : undefined
  return (
    <div className="flex items-center gap-2 pr-1 text-[11px] text-ink-faint">
      <span>Pędzel</span>
      <div className="h-6 w-6 overflow-hidden rounded border border-line bg-ground">
        {frame ? (
          <img src={frame.url} alt="" className="h-full w-full object-contain [image-rendering:pixelated]" />
        ) : null}
      </div>
    </div>
  )
}

function useKeyboardShortcuts(): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      const state = useEditor.getState()
      const mod = event.ctrlKey || event.metaKey

      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        state.setDialog(state.dialog === 'palette' ? null : 'palette')
        return
      }
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void state.save()
        return
      }
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) state.redo()
        else state.undo()
        return
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        state.redo()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const layer = state.activeObjectLayer()
        const selected = state.selectedObjects()
        if (layer && selected.length > 0) {
          event.preventDefault()
          state.history.run(new RemoveObjectsCommand(layer, selected))
          state.selectObjects([])
          state.touch()
        }
        return
      }
      if (mod) return

      switch (event.key.toLowerCase()) {
        case 'b': state.setTool('brush'); break
        case 'e': state.setTool('eraser'); break
        case 'f': state.setTool('fill'); break
        case 'r': state.setTool('rect'); break
        case 'i': state.setTool('picker'); break
        case 'v': state.setTool('select'); break
        case 'a': state.setTool('object'); break
        case 'g': state.toggleGrid(); break
        case 'o': state.toggleObjects(); break
        case 'p': state.toggleAnimate(); break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}

/** Closing the tab with unsaved edits should cost a confirmation. */
function useDirtyGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])
}
