import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  ArrowRight, Brush, Eraser, FileText, Grid3x3, Layers, ListChecks, MousePointer2,
  PaintBucket, Palette, Pipette, Play, Plus, Redo2, Save, Search, Shapes,
  ShieldCheck, SlidersHorizontal, Smartphone, Square, SquareDashed, StickyNote,
  ClipboardCopy, ClipboardPaste, CopyPlus, History, Replace, Scissors, Undo2,
} from 'lucide-react'
import { allObjects, mapFolder, mapTitle, type TileMap } from '@tile-editor/core'
import { THEMES } from '../theme'
import { useEditor } from '../state/store'

interface Entry {
  id: string
  label: string
  group: string
  icon: typeof Brush
  hint?: string
  detail?: string
  run: () => void | Promise<void>
}

/**
 * One box for everything: run a command, jump to a map, or search the project
 * for a property. Searching is what a Tiled user has to grep the folder for
 * today, and the corpus is entirely property-driven, so it earns its place.
 *
 *   plain text   commands and maps by name
 *   #mode=coop   maps whose own properties match
 *   @railId=3    objects whose properties match
 */
export function CommandPalette() {
  const open = useEditor((s) => s.dialog === 'palette')
  const setDialog = useEditor((s) => s.setDialog)
  const project = useEditor((s) => s.project)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [matches, setMatches] = useState<Entry[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    setMatches([])
    inputRef.current?.focus()
  }, [open])

  const commands = useMemo<Entry[]>(() => {
    const state = useEditor.getState()
    const onObjects = () => useEditor.getState().activeObjectLayer() !== undefined
    const tool = (id: Parameters<typeof state.setTool>[0], label: string, icon: typeof Brush, hint: string): Entry => ({
      id: `tool:${id}`, label, group: 'Narzędzia', icon, hint, run: () => useEditor.getState().setTool(id),
    })
    return [
      { id: 'save', label: 'Zapisz mapę', group: 'Plik', icon: Save, hint: 'Ctrl+S', run: () => useEditor.getState().save() },
      { id: 'new-map', label: 'Nowa mapa…', group: 'Plik', icon: Plus, run: () => useEditor.getState().setDialog('new-map') },
      { id: 'add-tileset', label: 'Dodaj tileset…', group: 'Plik', icon: Palette, run: () => useEditor.getState().setDialog('add-tileset') },
      { id: 'types', label: 'Typy projektu…', group: 'Projekt', icon: ListChecks, run: () => useEditor.getState().setDialog('property-types') },
      { id: 'rename-property', label: 'Zmień property w całym projekcie…', group: 'Projekt', icon: Replace, detail: 'Zmiana nazwy, typu albo usunięcie we wszystkich plikach naraz', run: () => useEditor.getState().setDialog('rename-property') },
      { id: 'drafts', label: 'Niezapisane zmiany…', group: 'Plik', icon: History, detail: 'Odzyskaj pracę z sesji, która skończyła się bez zapisu', run: () => useEditor.getState().setDialog('drafts') },
      { id: 'undo', label: 'Cofnij', group: 'Edycja', icon: Undo2, hint: 'Ctrl+Z', run: () => useEditor.getState().undo() },
      { id: 'redo', label: 'Ponów', group: 'Edycja', icon: Redo2, hint: 'Ctrl+Shift+Z', run: () => useEditor.getState().redo() },
      { id: 'select-all', label: 'Zaznacz całą warstwę', group: 'Edycja', icon: SquareDashed, hint: 'Ctrl+A', run: () => useEditor.getState().selectAllTiles() },
      // Which clipboard these mean depends on the layer, exactly as the
      // keyboard shortcuts do - one command, not two that mostly do nothing.
      { id: 'copy', label: 'Kopiuj zaznaczenie', group: 'Edycja', icon: ClipboardCopy, hint: 'Ctrl+C', run: () => onObjects() ? useEditor.getState().copyObjects() : useEditor.getState().copyTiles() },
      { id: 'cut', label: 'Wytnij zaznaczenie', group: 'Edycja', icon: Scissors, hint: 'Ctrl+X', run: () => onObjects() ? useEditor.getState().copyObjects(true) : useEditor.getState().copyTiles(true) },
      { id: 'paste', label: 'Wklej', group: 'Edycja', icon: ClipboardPaste, hint: 'Ctrl+V', run: () => onObjects() ? useEditor.getState().pasteObjects() : useEditor.getState().pasteTiles() },
      { id: 'duplicate', label: 'Duplikuj obiekty', group: 'Edycja', icon: CopyPlus, hint: 'Ctrl+D', run: () => useEditor.getState().duplicateObjects() },
      tool('brush', 'Pędzel', Brush, 'B'),
      tool('eraser', 'Gumka', Eraser, 'E'),
      tool('fill', 'Wypełnienie', PaintBucket, 'F'),
      tool('rect', 'Prostokąt', Square, 'R'),
      tool('area', 'Zaznacz obszar', SquareDashed, 'S'),
      tool('picker', 'Pipeta', Pipette, 'I'),
      tool('select', 'Zaznaczanie obiektów', MousePointer2, 'V'),
      tool('object', 'Stawianie obiektów', StickyNote, 'A'),
      { id: 'grid', label: 'Siatka', group: 'Widok', icon: Grid3x3, hint: 'G', run: () => useEditor.getState().toggleGrid() },
      { id: 'objects', label: 'Obiekty', group: 'Widok', icon: Shapes, hint: 'O', run: () => useEditor.getState().toggleObjects() },
      { id: 'animate', label: 'Animacje kafli', group: 'Widok', icon: Play, hint: 'P', run: () => useEditor.getState().toggleAnimate() },
      { id: 'lint', label: 'Sprawdź projekt lintem', group: 'Projekt', icon: ShieldCheck, run: () => useEditor.getState().runLint() },
      { id: 'panel-project', label: 'Panel: projekt', group: 'Panele', icon: FileText, run: () => useEditor.getState().setPanel('project') },
      { id: 'panel-layers', label: 'Panel: warstwy', group: 'Panele', icon: Layers, run: () => useEditor.getState().setPanel('layers') },
      { id: 'panel-tilesets', label: 'Panel: tilesety', group: 'Panele', icon: Palette, run: () => useEditor.getState().setPanel('tilesets') },
      { id: 'panel-props', label: 'Panel: properties', group: 'Panele', icon: SlidersHorizontal, run: () => useEditor.getState().setPanel('properties') },
      { id: 'theme', label: 'Motyw…', group: 'Widok', icon: Palette, run: () => useEditor.getState().setDialog('theme') },
      {
        id: 'install',
        label: 'Dodaj do ekranu głównego',
        group: 'Widok',
        icon: Smartphone,
        run: () => useEditor.getState().addToHomeScreen(),
      },
      ...THEMES.map((theme): Entry => ({
        id: `theme:${theme.id}`,
        label: `Motyw: ${theme.label}`,
        group: 'Widok',
        icon: Palette,
        detail: theme.note,
        run: () => useEditor.getState().setTheme(theme.id),
      })),
    ]
  }, [])

  const mapEntries = useMemo<Entry[]>(
    () =>
      (project?.maps ?? []).map((path) => ({
        id: `map:${path}`,
        label: mapTitle(path),
        group: 'Mapy',
        icon: FileText,
        detail: mapFolder(path),
        run: () => useEditor.getState().openMap(path),
      })),
    [project],
  )

  // Property search has to read every map, so it runs on a debounce rather than
  // on each keystroke.
  useEffect(() => {
    if (!open) return
    const trimmed = query.trim()
    const kind = trimmed.startsWith('#') ? 'map' : trimmed.startsWith('@') ? 'object' : undefined
    if (!kind) {
      setMatches([])
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = window.setTimeout(async () => {
      const results = await searchProperties(kind, trimmed.slice(1))
      if (!cancelled) {
        setMatches(results)
        setSearching(false)
        setActive(0)
      }
    }, 220)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, query])

  const trimmed = query.trim()
  const isSearch = trimmed.startsWith('#') || trimmed.startsWith('@')
  const visible = isSearch
    ? matches
    : [...commands, ...mapEntries]
        .filter((entry) => !trimmed || fuzzy(entry.label + ' ' + entry.group, trimmed))
        .slice(0, 60)

  useEffect(() => {
    listRef.current?.querySelector('[data-active=true]')?.scrollIntoView({ block: 'nearest' })
  }, [active, visible.length])

  if (!open) return null

  const choose = (entry: Entry | undefined) => {
    if (!entry) return
    setDialog(null)
    void entry.run()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-3 pt-[10vh]">
      <button type="button" aria-label="Zamknij" className="absolute inset-0 bg-black/60" onClick={() => setDialog(null)} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Paleta poleceń"
        className="relative flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search size={15} className="shrink-0 text-ink-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive((i) => Math.min(i + 1, visible.length - 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((i) => Math.max(i - 1, 0))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                choose(visible[active])
              } else if (event.key === 'Escape') {
                setDialog(null)
              }
            }}
            placeholder="Polecenie lub mapa · #property mapy · @property obiektu"
            className="hit w-full bg-transparent text-[14px] text-ink placeholder:text-ink-faint focus:outline-none"
          />
        </div>

        <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
          {searching ? (
            <li className="px-3 py-6 text-center text-[12px] text-ink-faint">Przeszukuję mapy…</li>
          ) : visible.length === 0 ? (
            <li className="px-3 py-6 text-center text-[12px] text-ink-faint">
              {isSearch ? 'Nic nie pasuje.' : 'Brak wyników.'}
            </li>
          ) : (
            visible.map((entry, index) => (
              <li key={entry.id}>
                <button
                  type="button"
                  data-active={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(entry)}
                  className={clsx(
                    'hit flex w-full items-center gap-2.5 px-3 text-left text-[13px]',
                    index === active ? 'bg-accent-deep text-accent-ink' : 'text-ink-dim',
                  )}
                >
                  <entry.icon size={15} className="shrink-0 opacity-70" />
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  {entry.detail ? <span className="shrink-0 truncate text-[11px] text-ink-faint">{entry.detail}</span> : null}
                  {entry.hint ? <span className="num shrink-0 text-[11px] text-ink-faint">{entry.hint}</span> : null}
                  {index === active ? <ArrowRight size={13} className="shrink-0 opacity-60" /> : null}
                </button>
              </li>
            ))
          )}
        </ul>

        <footer className="flex items-center gap-3 border-t border-line px-3 py-1.5 text-[11px] text-ink-faint">
          <span><kbd className="num">↑↓</kbd> wybór</span>
          <span><kbd className="num">Enter</kbd> uruchom</span>
          <span className="ml-auto">
            {isSearch ? `${visible.length} wyników` : `${visible.length} pozycji`}
          </span>
        </footer>
      </div>
    </div>
  )
}

/** Subsequence match, so "npm" finds "Nowa mapa". */
function fuzzy(haystack: string, needle: string): boolean {
  const text = haystack.toLowerCase()
  const query = needle.toLowerCase()
  let index = 0
  for (const ch of query) {
    if (ch === ' ') continue
    index = text.indexOf(ch, index)
    if (index < 0) return false
    index++
  }
  return true
}

/** Parses `name`, `name=value` or `name~fragment`. */
function parseQuery(raw: string): { name: string; value?: string; loose: boolean } {
  const loose = raw.includes('~')
  const [name = '', value] = raw.split(loose ? '~' : '=')
  return { name: name.trim(), value: value?.trim(), loose }
}

function propertyMatches(
  properties: { name: string; value: unknown }[],
  query: { name: string; value?: string; loose: boolean },
): boolean {
  return properties.some((property) => {
    if (query.name && !property.name.toLowerCase().includes(query.name.toLowerCase())) return false
    if (query.value === undefined || query.value === '') return true
    const text = String(property.value ?? '').toLowerCase()
    return query.loose ? text.includes(query.value.toLowerCase()) : text === query.value.toLowerCase()
  })
}

async function searchProperties(kind: 'map' | 'object', raw: string): Promise<Entry[]> {
  const state = useEditor.getState()
  const { loader, project, doc } = state
  if (!loader || !project || raw.trim() === '') return []
  const query = parseQuery(raw)
  const results: Entry[] = []

  for (const path of project.maps) {
    let map: TileMap
    try {
      // The open document is authoritative; the rest come from disk, cached by
      // the loader so a second search is fast.
      map = doc && doc.path === path ? doc.map : (await loader.loadMap(path)).map
    } catch {
      continue
    }

    if (kind === 'map') {
      if (!propertyMatches(map.properties, query)) continue
      const shown = map.properties.find((p) => p.name.toLowerCase().includes(query.name.toLowerCase()))
      results.push({
        id: `found:${path}`,
        label: mapTitle(path),
        group: 'Mapy',
        icon: FileText,
        detail: shown ? `${shown.name} = ${String(shown.value)}` : mapFolder(path),
        run: () => useEditor.getState().openMap(path),
      })
      continue
    }

    for (const object of allObjects(map)) {
      if (!propertyMatches(object.properties, query)) continue
      const shown = object.properties.find((p) => p.name.toLowerCase().includes(query.name.toLowerCase()))
      results.push({
        id: `found:${path}:${object.id}`,
        label: `${object.name || object.className || `obiekt #${object.id}`} · ${mapTitle(path)}`,
        group: 'Obiekty',
        icon: Shapes,
        detail: shown ? `${shown.name} = ${String(shown.value)}` : undefined,
        run: async () => {
          const editor = useEditor.getState()
          if (editor.doc?.path !== path) await editor.openMap(path)
          const layer = [...(useEditor.getState().doc?.map.layers ?? [])].find(
            (l) => l.kind === 'objectgroup' && l.objects.some((o) => o.id === object.id),
          )
          if (layer) useEditor.getState().setActiveLayer(layer.id)
          useEditor.getState().selectObjects([object.id])
          useEditor.getState().setPanel('properties')
        },
      })
      if (results.length > 200) return results
    }
  }
  return results
}
