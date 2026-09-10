import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { FileText, Folder, Plus } from 'lucide-react'
import { mapFolder, mapTitle } from '@tile-editor/core'
import { Button, Empty, Panel } from './ui'
import { useEditor } from '../state/store'

/** The project is a folder of maps sharing tilesets, so this lists it by folder. */
export function ProjectPanel() {
  const project = useEditor((s) => s.project)
  const doc = useEditor((s) => s.doc)
  const dirty = useEditor((s) => s.dirty)
  const openMap = useEditor((s) => s.openMap)
  const setPanel = useEditor((s) => s.setPanel)
  const [filter, setFilter] = useState('')
  const setDialog = useEditor((s) => s.setDialog)

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

  const total = project.maps.length

  return (
    <Panel
      title={`Projekt · ${total} map`}
      actions={
        <Button size="sm" title="Nowa mapa" aria-label="Nowa mapa" onClick={() => setDialog('new-map')}>
          <Plus size={14} />
        </Button>
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
            <ul>
              {paths.map((path) => (
                <li key={path}>
                  <button
                    type="button"
                    onClick={() => {
                      void openMap(path)
                      setPanel(null)
                    }}
                    className={clsx(
                      'hit flex w-full items-center gap-2 px-3 text-left text-[13px]',
                      doc?.path === path ? 'bg-accent-deep text-accent-ink' : 'text-ink-dim hover:bg-hover hover:text-ink',
                    )}
                  >
                    <FileText size={13} className="shrink-0 opacity-60" />
                    <span className="truncate">{mapTitle(path)}</span>
                    {doc?.path === path && dirty ? <span className="ml-auto text-warn">•</span> : null}
                  </button>
                </li>
              ))}
            </ul>
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
