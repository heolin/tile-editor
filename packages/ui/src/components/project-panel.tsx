import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { Folder, LayoutGrid, List, Plus } from 'lucide-react'
import { mapFolder, mapTitle } from '@tile-editor/core'
import { Button, Empty, Panel } from './ui'
import { MapThumb } from './map-thumb'
import { useEditor } from '../state/store'

const VIEW_KEY = 'tile-editor:project-view'

/** The project is a folder of maps sharing tilesets, so this lists it by folder. */
export function ProjectPanel() {
  const project = useEditor((s) => s.project)
  const doc = useEditor((s) => s.doc)
  const dirty = useEditor((s) => s.dirty)
  const openMap = useEditor((s) => s.openMap)
  const setPanel = useEditor((s) => s.setPanel)
  const [filter, setFilter] = useState('')
  const setDialog = useEditor((s) => s.setDialog)
  // 115 levels called story-01..story-40 are told apart by their shape, not
  // their name, so pictures are the default. The list stays one tap away.
  const [view, setView] = useState<'grid' | 'list'>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
    } catch {
      return 'grid'
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view)
    } catch {
      // A browser that refuses storage still gets a working panel.
    }
  }, [view])

  const grouped = useMemo(() => {
    const groups = new Map<string, string[]>()
    for (const path of project?.maps ?? []) {
      if (filter && !path.toLowerCase().includes(filter.toLowerCase())) continue
      const folder = mapFolder(path)
      groups.set(folder, [...(groups.get(folder) ?? []), path])
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [project, filter])

  if (!project) return <Panel title="Projekt"><Empty>Wczytywanie…</Empty></Panel>

  const open = (path: string) => {
    void openMap(path)
    setPanel(null)
  }

  const total = project.maps.length

  return (
    <Panel
      title={`Projekt · ${total} map`}
      actions={
        <>
          <Button
            size="sm"
            title={view === 'grid' ? 'Pokaż listę' : 'Pokaż miniatury'}
            aria-label={view === 'grid' ? 'Pokaż listę' : 'Pokaż miniatury'}
            onClick={() => setView(view === 'grid' ? 'list' : 'grid')}
          >
            {view === 'grid' ? <List size={14} /> : <LayoutGrid size={14} />}
          </Button>
          <Button size="sm" title="Nowa mapa" aria-label="Nowa mapa" onClick={() => setDialog('new-map')}>
            <Plus size={14} />
          </Button>
        </>
      }
    >
      <div className="sticky top-0 z-10 border-b border-line bg-surface px-2 py-1.5">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Szukaj mapy…"
          className="hit w-full rounded-md border border-line bg-ground px-2 text-[12px] placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
      </div>
      {grouped.length === 0 ? (
        <Empty>Nic nie pasuje do filtra.</Empty>
      ) : (
        grouped.map(([folder, paths]) => (
          <div key={folder}>
            <h3 className="flex items-center gap-1.5 bg-ground/50 px-3 py-1 text-[11px] text-ink-faint">
              <Folder size={12} />
              {folder}
              <span className="num ml-auto">{paths.length}</span>
            </h3>
            {view === 'grid' ? (
              <ul className="grid grid-cols-2 gap-2 p-2">
                {paths.map((path) => (
                  <li key={path}>
                    <button
                      type="button"
                      onClick={() => open(path)}
                      title={path}
                      className={clsx(
                        'flex w-full flex-col gap-1 rounded-md border p-1 text-left',
                        doc?.path === path
                          ? 'border-accent bg-accent-deep text-accent-ink'
                          : 'border-line text-ink-dim hover:border-line-strong hover:text-ink',
                      )}
                    >
                      <MapThumb path={path} className="aspect-[4/3] w-full overflow-hidden rounded bg-ground/60" />
                      <span className="flex items-center gap-1 px-0.5 text-[11px]">
                        <span className="truncate">{mapTitle(path)}</span>
                        {doc?.path === path && dirty ? <span className="ml-auto shrink-0 text-warn">•</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <ul>
                {paths.map((path) => (
                  <li key={path}>
                    <button
                      type="button"
                      onClick={() => open(path)}
                      className={clsx(
                        'hit flex w-full items-center gap-2 px-3 text-left text-[13px]',
                        doc?.path === path ? 'bg-accent-deep text-accent-ink' : 'text-ink-dim hover:bg-hover hover:text-ink',
                      )}
                    >
                      <MapThumb path={path} className="h-6 w-8 shrink-0 overflow-hidden rounded-sm bg-ground/60" />
                      <span className="truncate">{mapTitle(path)}</span>
                      {doc?.path === path && dirty ? <span className="ml-auto text-warn">•</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))
      )}
      {project.tilesets.length > 0 ? (
        <div className="border-t border-line">
          <h3 className="bg-ground/50 px-3 py-1 text-[11px] text-ink-faint">Tilesety</h3>
          <ul className="px-3 py-1">
            {project.tilesets.map((path) => (
              <li key={path} className="truncate py-0.5 text-[12px] text-ink-faint">{path}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  )
}
