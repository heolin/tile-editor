import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { Empty, Panel } from './ui'
import { useEditor } from '../state/store'
import type { TileSourceIndex } from '../render/tile-source'

/**
 * Both tilesets in the corpus are image collections: every tile is its own PNG,
 * so this grid loads a few dozen separate files rather than slicing one atlas.
 * Images are lazy so a large collection does not stall the first paint.
 */
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

export function TilesetPanel() {
  const doc = useEditor((s) => s.doc)
  const stamp = useEditor((s) => s.stamp)
  const fs = useEditor((s) => s.fs)
  const setStamp = useEditor((s) => s.setStamp)
  const setTool = useEditor((s) => s.setTool)
  const setPropertyTarget = useEditor((s) => s.setPropertyTarget)
  const [filter, setFilter] = useState('')

  const entries = useMemo(() => {
    if (!doc) return []
    const out: {
      gid: number
      frame: ReturnType<typeof doc.source.frame>
      label: string
      tilesetPath: string
      tileId: number
      kind?: string
    }[] = []
    for (const ref of doc.map.tilesets) {
      const tileset = ref.tileset
      if (!tileset) continue
      for (let i = 0; i < Math.max(tileset.tilecount, tileset.tiles.length); i++) {
        const gid = ref.firstgid + i
        const frame = doc.source.frame(gid)
        if (!frame) continue
        const tile = tileset.tiles.find((t) => t.id === i)
        const kind = tile?.properties.find((p) => p.name === 'kind')?.value
        out.push({
          gid,
          frame,
          label: tile?.image?.split('/').pop() ?? `#${i}`,
          tilesetPath: tileset.sourcePath ?? ref.source ?? '',
          tileId: i,
          kind: typeof kind === 'string' ? kind : undefined,
        })
      }
    }
    return out
  }, [doc])

  const shown = filter
    ? entries.filter((e) => e.label.toLowerCase().includes(filter.toLowerCase()) || e.kind?.includes(filter.toLowerCase()))
    : entries

  if (!doc) return <Panel title="Tilesety"><Empty>Brak otwartej mapy.</Empty></Panel>

  return (
    <Panel title={`Tilesety · ${entries.length}`}>
      <div className="sticky top-0 z-10 border-b border-line bg-surface px-2 py-1.5">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtruj po nazwie lub kind…"
          className="hit w-full rounded-md border border-line bg-ground px-2 text-[12px] placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
      </div>
      {shown.length === 0 ? (
        <Empty>{entries.length === 0 ? 'Mapa nie odwołuje się do żadnego tilesetu.' : 'Nic nie pasuje do filtra.'}</Empty>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1 p-2">
          {shown.map((entry) => (
            <button
              key={entry.gid}
              type="button"
              title={`${entry.label}${entry.kind ? ` · ${entry.kind}` : ''}`}
              onClick={() => {
                setStamp({ width: 1, height: 1, gids: [entry.gid] })
                setTool('brush')
                setPropertyTarget({ kind: 'tile', tilesetPath: entry.tilesetPath, tileId: entry.tileId })
              }}
              className={clsx(
                'relative aspect-square overflow-hidden rounded border bg-ground/60 p-0.5',
                stamp?.gids[0] === entry.gid ? 'border-accent ring-1 ring-accent' : 'border-line hover:border-line-strong',
              )}
            >
              <TileThumb frame={entry.frame!} />
            </button>
          ))}
        </div>
      )}
    </Panel>
  )
}
