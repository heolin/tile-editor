import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { ImagePlus, Plus, Unlink } from 'lucide-react'
import { isImageCollection, resolveFrom, tileLabel, type Tileset, type TilesetRef } from '@tile-editor/core'
import { Button, Empty, Panel } from './ui'
import { AddImagesDialog, AddTilesetDialog } from './tileset-dialogs'
import { useEditor } from '../state/store'
import type { TileSourceIndex } from '../render/tile-source'

/**
 * Draws one tile. An atlas tileset packs many tiles into a single image, so the
 * thumbnail crops with background-position instead of showing the whole file.
 */
function TileThumb({ frame }: { frame: NonNullable<ReturnType<TileSourceIndex['frame']>> }) {
  const box = 44
  const scale = box / Math.max(frame.sw, frame.sh)
  const width = frame.imageWidth || frame.sw
  const height = frame.imageHeight || frame.sh
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div
        aria-hidden
        style={{
          width: frame.sw * scale,
          height: frame.sh * scale,
          backgroundImage: `url(${frame.url})`,
          backgroundSize: `${width * scale}px ${height * scale}px`,
          backgroundPosition: `-${frame.sx * scale}px -${frame.sy * scale}px`,
          backgroundRepeat: 'no-repeat',
          imageRendering: 'pixelated',
        }}
      />
    </div>
  )
}

interface Entry {
  gid: number
  frame: NonNullable<ReturnType<TileSourceIndex['frame']>>
  label: string
  kind?: string
  tileId: number
}

/**
 * The palette, grouped by tileset. Both example projects use image collections,
 * where every tile is its own PNG, so a section can hold a few dozen separate
 * files; the grid loads them lazily.
 */
export function TilesetPanel() {
  const doc = useEditor((s) => s.doc)
  const stamp = useEditor((s) => s.stamp)
  const revision = useEditor((s) => s.revision)
  const sourceRevision = useEditor((s) => s.sourceRevision)
  const setStamp = useEditor((s) => s.setStamp)
  const setTool = useEditor((s) => s.setTool)
  const setPropertyTarget = useEditor((s) => s.setPropertyTarget)
  const detachTileset = useEditor((s) => s.detachTileset)
  const [filter, setFilter] = useState('')
  const [adding, setAdding] = useState(false)
  const [imagesFor, setImagesFor] = useState<string | null>(null)

  const sections = useMemo(() => {
    if (!doc) return []
    return doc.map.tilesets.map((ref) => {
      const tileset = ref.tileset
      const path = tileset?.sourcePath ?? (ref.source ? resolveFrom(doc.path, ref.source) : '')
      const entries: Entry[] = []
      if (tileset) {
        const highest = Math.max(tileset.tilecount, ...tileset.tiles.map((t) => t.id + 1), 0)
        for (let i = 0; i < highest; i++) {
          const frame = doc.source.frame(ref.firstgid + i)
          if (!frame) continue
          const tile = tileset.tiles.find((t) => t.id === i)
          const kind = tile?.properties.find((p) => p.name === 'kind')?.value
          entries.push({
            gid: ref.firstgid + i,
            frame,
            label: tile ? tileLabel(tile) : `#${i}`,
            kind: typeof kind === 'string' ? kind : undefined,
            tileId: i,
          })
        }
      }
      return { ref, tileset, path, entries }
    })
  }, [doc, revision, sourceRevision])

  const total = sections.reduce((sum, section) => sum + section.entries.length, 0)

  if (!doc) {
    return <Panel title="Tilesety"><Empty>Brak otwartej mapy.</Empty></Panel>
  }

  return (
    <Panel
      title={`Tilesety · ${total}`}
      actions={
        <Button size="sm" title="Dodaj tileset" aria-label="Dodaj tileset" onClick={() => setAdding(true)}>
          <Plus size={14} />
        </Button>
      }
    >
      <AddTilesetDialog open={adding} onClose={() => setAdding(false)} />
      {imagesFor ? (
        <AddImagesDialog tilesetPath={imagesFor} open onClose={() => setImagesFor(null)} />
      ) : null}

      <div className="sticky top-0 z-10 border-b border-line bg-surface px-2 py-1.5">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtruj po nazwie lub kind…"
          className="hit w-full rounded-md border border-line bg-ground px-2 text-[12px] placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
      </div>

      {sections.length === 0 ? (
        <Empty>Ta mapa nie odwołuje się do żadnego tilesetu. Dodaj jeden przyciskiem plus.</Empty>
      ) : (
        sections.map((section) => (
          <TilesetSection
            key={`${section.ref.firstgid}:${section.path}`}
            entries={section.entries}
            tileset={section.tileset}
            path={section.path}
            refEntry={section.ref}
            filter={filter}
            selectedGid={stamp?.gids[0]}
            onPick={(entry) => {
              setStamp({ width: 1, height: 1, gids: [entry.gid] })
              setTool(useEditor.getState().activeLayer()?.kind === 'objectgroup' ? 'object' : 'brush')
              setPropertyTarget({ kind: 'tile', tilesetPath: section.path, tileId: entry.tileId })
            }}
            onAddImages={() => setImagesFor(section.path)}
            onDetach={() => detachTileset(section.ref)}
          />
        ))
      )}
    </Panel>
  )
}

function TilesetSection({
  entries, tileset, path, refEntry, filter, selectedGid, onPick, onAddImages, onDetach,
}: {
  entries: Entry[]
  tileset: Tileset | undefined
  path: string
  refEntry: TilesetRef
  filter: string
  selectedGid: number | undefined
  onPick: (entry: Entry) => void
  onAddImages: () => void
  onDetach: () => void
}) {
  const shown = filter
    ? entries.filter((e) => e.label.toLowerCase().includes(filter.toLowerCase()) || e.kind?.includes(filter.toLowerCase()))
    : entries

  if (filter && shown.length === 0) return null

  const collection = tileset ? isImageCollection(tileset) : false

  return (
    <section>
      <header className="sticky top-[41px] z-[9] flex items-center gap-1 border-b border-line bg-ground/95 px-2 py-1 backdrop-blur">
        <h3 className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink-dim" title={path}>
          {tileset?.name || path || 'tileset osadzony'}
        </h3>
        <span className="num shrink-0 text-[10.5px] text-ink-faint">{entries.length}</span>
        {collection ? (
          <button
            type="button"
            className="hit shrink-0 px-1 text-ink-faint hover:text-accent"
            title="Dodaj obrazki jako kafle"
            aria-label={`Dodaj obrazki do ${tileset?.name ?? path}`}
            onClick={onAddImages}
          >
            <ImagePlus size={14} />
          </button>
        ) : null}
        <button
          type="button"
          className="hit shrink-0 px-1 text-ink-faint hover:text-danger"
          title="Odłącz tileset od mapy"
          aria-label={`Odłącz ${tileset?.name ?? path}`}
          onClick={onDetach}
        >
          <Unlink size={14} />
        </button>
      </header>

      {shown.length === 0 ? (
        <Empty>
          {collection ? 'Tileset jest pusty — dodaj obrazki ikoną obok nazwy.' : 'Tileset nie ma kafli.'}
        </Empty>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1 p-2">
          {shown.map((entry) => (
            <button
              key={entry.gid}
              type="button"
              title={`${entry.label}${entry.kind ? ` · ${entry.kind}` : ''}`}
              onClick={() => onPick(entry)}
              className={clsx(
                'relative aspect-square overflow-hidden rounded border bg-ground/60 p-0.5',
                selectedGid === entry.gid ? 'border-accent ring-1 ring-accent' : 'border-line hover:border-line-strong',
              )}
            >
              <TileThumb frame={entry.frame} />
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
