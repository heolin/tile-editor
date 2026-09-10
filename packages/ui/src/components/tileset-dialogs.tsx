import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { basename, mapTitle, resolveFrom } from '@tile-editor/core'
import { Button, Dialog, Empty, Field, Select, TextInput } from './ui'
import { useEditor } from '../state/store'

/** Attaches a tileset the project already has, or makes a new empty one. */
export function AddTilesetDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useEditor((s) => s.project)
  const doc = useEditor((s) => s.doc)
  const attachTileset = useEditor((s) => s.attachTileset)
  const createTilesetFile = useEditor((s) => s.createTilesetFile)
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [name, setName] = useState('nowy-tileset')
  const [folder, setFolder] = useState('')
  const [tileSize, setTileSize] = useState(32)
  const [busy, setBusy] = useState(false)

  const attached = useMemo(() => {
    const set = new Set<string>()
    for (const ref of doc?.map.tilesets ?? []) {
      if (ref.source && doc) set.add(resolveFrom(doc.path, ref.source))
    }
    return set
  }, [doc])

  const available = (project?.tilesets ?? []).filter((path) => !attached.has(path))

  const folderChoices = useMemo(() => {
    const set = new Set<string>([''])
    for (const path of project?.tilesets ?? []) set.add(path.split('/').slice(0, -1).join('/'))
    for (const path of project?.maps ?? []) set.add(path.split('/').slice(0, -1).join('/'))
    return [...set].sort()
  }, [project])

  useEffect(() => {
    if (!open) return
    setMode(available.length > 0 ? 'existing' : 'new')
    setName('nowy-tileset')
    // Tilesets are shared between maps, so a new one belongs where the existing
    // ones live rather than inside whichever map folder happens to be open.
    const existing = project?.tilesets[0]
    setFolder(existing ? existing.split('/').slice(0, -1).join('/') : '')
    setTileSize(doc?.map.tilewidth ?? 32)
    setBusy(false)
  }, [open])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    await fn()
    setBusy(false)
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} title="Dodaj tileset">
      <div className="flex gap-1 px-3 pb-1 pt-2">
        <Button variant="outline" active={mode === 'existing'} onClick={() => setMode('existing')}>
          Z projektu
        </Button>
        <Button variant="outline" active={mode === 'new'} onClick={() => setMode('new')}>
          Nowy
        </Button>
      </div>

      {mode === 'existing' ? (
        available.length === 0 ? (
          <Empty>Wszystkie tilesety projektu są już podłączone do tej mapy.</Empty>
        ) : (
          <ul className="divide-y divide-line/60">
            {available.map((path) => (
              <li key={path}>
                <button
                  type="button"
                  disabled={busy}
                  className="hit flex w-full items-center gap-2 px-3 text-left text-[13px] text-ink-dim hover:bg-hover hover:text-ink"
                  onClick={() => void run(() => attachTileset(path))}
                >
                  <span className="truncate">{path}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          <Field
            label="Nazwa pliku"
            hint={`Powstanie ${folder ? folder + '/' : ''}${name.replace(/\.tsj$/, '')}.tsj`}
          >
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Folder">
            <Select value={folder} onChange={(e) => setFolder(e.target.value)}>
              {folderChoices.map((f) => (
                <option key={f} value={f}>{f || '.'}</option>
              ))}
            </Select>
          </Field>
          <Field label="Rozmiar kafla (px)" hint="Kolekcja obrazków — każdy kafel to osobny plik.">
            <TextInput className="num" type="number" min={1} value={tileSize} onChange={(e) => setTileSize(Number(e.target.value))} />
          </Field>
          <div className="flex justify-end gap-2 px-3 py-2">
            <Button variant="outline" onClick={onClose}>Anuluj</Button>
            <Button
              variant="solid"
              disabled={busy || !name.trim() || tileSize < 1}
              onClick={() =>
                void run(() =>
                  createTilesetFile({
                    fileName: name,
                    folder,
                    name: mapTitle(name),
                    tileSize,
                  }),
                )
              }
            >
              {busy ? 'Tworzę…' : 'Utwórz i podłącz'}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  )
}

/** Picks project images to append as tiles to an image-collection tileset. */
export function AddImagesDialog({ tilesetPath, open, onClose }: {
  tilesetPath: string
  open: boolean
  onClose: () => void
}) {
  const project = useEditor((s) => s.project)
  const fs = useEditor((s) => s.fs)
  const addImages = useEditor((s) => s.addImagesToActiveTileset)
  // Never call a store method inside a selector: it returns a fresh array every
  // time, so zustand sees a change on every notification and loops forever.
  const revision = useEditor((s) => s.revision)
  const [picked, setPicked] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)

  const used = useMemo(() => {
    const entry = useEditor.getState().tilesets().find((t) => t.path === tilesetPath)
    if (!entry) return new Set<string>()
    return new Set(
      entry.tileset.tiles
        .filter((tile) => tile.image)
        .map((tile) => resolveFrom(tilesetPath, tile.image!)),
    )
  }, [revision, tilesetPath])

  const candidates = (project?.images ?? []).filter(
    (path) => !used.has(path) && (!filter || path.toLowerCase().includes(filter.toLowerCase())),
  )

  useEffect(() => {
    if (!open) return
    setPicked([])
    setFilter('')
    setBusy(false)
  }, [open])

  const toggle = (path: string) =>
    setPicked((current) => (current.includes(path) ? current.filter((p) => p !== path) : [...current, path]))

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Dodaj obrazki jako kafle"
      footer={
        <>
          <span className="mr-auto self-center text-[12px] text-ink-faint">
            {picked.length > 0 ? `${picked.length} zaznaczonych` : `${candidates.length} dostępnych`}
          </span>
          <Button variant="outline" onClick={onClose}>Anuluj</Button>
          <Button
            variant="solid"
            disabled={picked.length === 0 || busy}
            onClick={async () => {
              setBusy(true)
              await addImages(tilesetPath, picked)
              setBusy(false)
              onClose()
            }}
          >
            {busy ? 'Dodaję…' : 'Dodaj'}
          </Button>
        </>
      }
    >
      <div className="px-3 pb-2">
        <TextInput placeholder="Filtruj po ścieżce…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {candidates.length === 0 ? (
        <Empty>
          {(project?.images.length ?? 0) === 0
            ? 'W projekcie nie ma żadnych obrazków.'
            : 'Wszystkie obrazki są już w tym tilesecie.'}
        </Empty>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-1.5 px-3 pb-2">
          {candidates.slice(0, 300).map((path) => (
            <button
              key={path}
              type="button"
              title={path}
              onClick={() => toggle(path)}
              className={clsx(
                'flex flex-col gap-1 rounded border p-1',
                picked.includes(path) ? 'border-accent bg-accent-deep' : 'border-line hover:border-line-strong',
              )}
            >
              <img
                src={fs.assetUrl(path)}
                alt=""
                loading="lazy"
                className="aspect-square w-full object-contain [image-rendering:pixelated]"
              />
              <span className="truncate text-[10px] text-ink-faint">{basename(path)}</span>
            </button>
          ))}
        </div>
      )}
    </Dialog>
  )
}
