import { useEffect, useState } from 'react'
import clsx from 'clsx'
import {
  Command, FolderTree, Layers, Palette, Paintbrush, ShieldCheck,
  SlidersHorizontal, Smartphone,
} from 'lucide-react'
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
import { PropertyTypesDialog } from './components/property-types-dialog'
import { PropertyRefactorDialog } from './components/property-refactor-dialog'
import { ThemeDialog } from './components/theme-dialog'
import { RecoveryDialog } from './components/recovery-dialog'
import { Button, Sheet, Toast } from './components/ui'
import { flushDraft, useEditor, type PanelId } from './state/store'
import { canOfferInstall, installOffered, onInstallabilityChange } from './pwa'

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
        <InstallButton />
        <Button
          onClick={() => setDialog('theme')}
          title="Motyw kolorów"
          aria-label="Motyw kolorów"
          className="hidden md:inline-flex"
        >
          <Paintbrush size={15} />
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
      <RecoveryDialog />
      <NewMapDialog open={dialog === 'new-map'} onClose={() => setDialog(null)} />
      <AddTilesetDialog open={dialog === 'add-tileset'} onClose={() => setDialog(null)} />
      <PropertyTypesDialog open={dialog === 'property-types'} onClose={() => setDialog(null)} />
      <PropertyRefactorDialog open={dialog === 'rename-property'} onClose={() => setDialog(null)} />
      <ThemeDialog open={dialog === 'theme'} onClose={() => setDialog(null)} />

      {toast ? <Toast text={toast.text} tone={toast.tone} /> : null}
    </div>
  )
}

/**
 * Visible on the web wherever a shortcut could exist, and gone inside the
 * packaged app or once the editor already runs from one. It stands out only
 * while the browser is actually offering to install; otherwise it is quiet and
 * pressing it explains what is in the way.
 */
function InstallButton() {
  const addToHomeScreen = useEditor((s) => s.addToHomeScreen)
  const [offered, setOffered] = useState(installOffered)

  useEffect(() => onInstallabilityChange(() => setOffered(installOffered())), [])
  if (!canOfferInstall()) return null

  return (
    <Button
      variant={offered ? 'outline' : 'ghost'}
      onClick={() => void addToHomeScreen()}
      title={offered ? 'Dodaj skrót do ekranu głównego' : 'Skrót na ekranie głównym — sprawdź, czy się da'}
      aria-label="Dodaj do ekranu głównego"
    >
      <Smartphone size={15} />
      <span className={offered ? 'hidden wide:inline' : 'sr-only'}>Dodaj skrót</span>
    </Button>
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
      // The clipboard keys only claim these when there is something to do with
      // them; otherwise they stay the browser's, so copying text still works.
      const onTiles = state.activeTileLayer() !== undefined
      const onObjects = state.activeObjectLayer() !== undefined
      const key = event.key.toLowerCase()
      if (mod && key === 'a' && onTiles) {
        event.preventDefault()
        state.selectAllTiles()
        return
      }
      if (mod && key === 'd' && onObjects && state.selectedObjectIds.length > 0) {
        event.preventDefault()
        state.duplicateObjects()
        return
      }
      if (mod && /^[cx]$/.test(key)) {
        if (onTiles && state.tileSelection) {
          event.preventDefault()
          state.copyTiles(key === 'x')
          return
        }
        if (onObjects && state.selectedObjectIds.length > 0) {
          event.preventDefault()
          state.copyObjects(key === 'x')
          return
        }
      }
      if (mod && key === 'v') {
        if (onTiles && state.clipboard) {
          event.preventDefault()
          state.pasteTiles()
          return
        }
        if (onObjects && state.objectClipboard) {
          event.preventDefault()
          state.pasteObjects()
          return
        }
      }
      if (event.key === 'Escape' && state.tileSelection) {
        event.preventDefault()
        state.selectTiles(undefined)
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
        } else if (state.tileSelection) {
          event.preventDefault()
          state.fillSelection(0)
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
        case 's': state.setTool('area'); break
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

/**
 * Closing the tab with unsaved edits should cost a confirmation - but Android
 * backgrounding the browser costs nothing and gives no warning, so the draft
 * gets written the moment the page stops being visible.
 */
function useDirtyGuard(dirty: boolean): void {
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === 'hidden') void flushDraft()
    }
    document.addEventListener('visibilitychange', hide)
    window.addEventListener('pagehide', hide)
    return () => {
      document.removeEventListener('visibilitychange', hide)
      window.removeEventListener('pagehide', hide)
    }
  }, [])

  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => {
      void flushDraft()
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])
}
