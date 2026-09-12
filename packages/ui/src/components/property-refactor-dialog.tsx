import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { AlertTriangle, Search } from 'lucide-react'
import { isEmptyChange, mapTitle, type PropertyChange, type PropertyIndexEntry, type PropertyType } from '@tile-editor/core'
import { Button, Dialog, Empty, Field, Select, TextInput } from './ui'
import { useEditor, type ChangePreview } from '../state/store'

const TYPES: PropertyType[] = ['string', 'int', 'float', 'bool', 'color', 'file']

const SCOPE_LABELS: Record<string, string> = {
  map: 'mapy',
  layer: 'warstwy',
  object: 'obiektu',
  tile: 'kafla',
}

/**
 * Renaming a property is an operation on the project, not on a document: these
 * games keep their semantics in properties spread over 115 files that share
 * nothing but a convention. It is also the one thing here that rewrites files
 * the editor never opened, so nothing happens without a preview first and there
 * is no undo across files - hence the count, the file list, and the second
 * button (docs/PLAN.md section 5.1).
 */
export function PropertyRefactorDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const index = useEditor((s) => s.propertyIndex)
  const indexProperties = useEditor((s) => s.indexProjectProperties)
  const previewChange = useEditor((s) => s.previewPropertyChange)
  const applyChange = useEditor((s) => s.applyPropertyChange)
  const dirty = useEditor((s) => s.dirty)
  const notify = useEditor((s) => s.notify)

  const [filter, setFilter] = useState('')
  const [picked, setPicked] = useState<PropertyIndexEntry | null>(null)
  const [rename, setRename] = useState('')
  const [retype, setRetype] = useState<PropertyType | ''>('')
  const [remove, setRemove] = useState(false)
  const [preview, setPreview] = useState<ChangePreview | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setFilter('')
    setPicked(null)
    setPreview(null)
    setBusy(false)
    if (index.length === 0) void indexProperties()
  }, [open, index.length, indexProperties])

  // Any change to what is being asked for invalidates the numbers on screen.
  useEffect(() => setPreview(null), [picked, rename, retype, remove])

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return needle ? index.filter((entry) => entry.name.toLowerCase().includes(needle)) : index
  }, [index, filter])

  const change: PropertyChange | null = picked
    ? {
        scope: picked.scope,
        name: picked.name,
        rename: remove ? undefined : rename,
        retype: remove || retype === '' ? undefined : retype,
        remove,
      }
    : null
  const ready = change !== null && !isEmptyChange(change)

  const run = async (apply: boolean) => {
    if (!change || !ready) return
    if (apply && dirty) {
      notify('Zapisz otwartą mapę przed zmianą w całym projekcie.', 'error')
      return
    }
    setBusy(true)
    try {
      if (!apply) {
        setPreview(await previewChange(change))
        return
      }
      const result = await applyChange(change)
      notify(
        result.properties === 0
          ? 'Nic nie pasowało — żaden plik nie został zmieniony.'
          : `Zmieniono ${result.properties} ${result.properties === 1 ? 'property' : 'properties'} w ${result.files} ${result.files === 1 ? 'pliku' : 'plikach'}`,
      )
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Property w całym projekcie"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Anuluj</Button>
          <Button variant="outline" disabled={!ready || busy} onClick={() => void run(false)}>
            Podejrzyj
          </Button>
          <Button
            variant={remove ? 'danger' : 'solid'}
            disabled={!ready || busy || preview === null || preview.properties === 0}
            onClick={() => void run(true)}
          >
            {preview ? `Zastosuj w ${preview.files.length}` : 'Zastosuj'}
          </Button>
        </>
      }
    >
      {picked === null ? (
        <>
          <div className="px-4 pb-2">
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint" />
              <TextInput
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filtruj properties…"
                className="pl-7"
                autoFocus
              />
            </div>
          </div>
          {shown.length === 0 ? (
            <Empty>{index.length === 0 ? 'Czytanie projektu…' : 'Nic nie pasuje.'}</Empty>
          ) : (
            <ul className="flex flex-col divide-y divide-line/60">
              {shown.map((entry) => (
                <li key={`${entry.scope}.${entry.name}`}>
                  <button
                    type="button"
                    className="hit flex w-full items-center gap-2 px-4 text-left text-[13px] text-ink-dim hover:bg-hover hover:text-ink"
                    onClick={() => {
                      setPicked(entry)
                      setRename(entry.name)
                      setRetype('')
                      setRemove(false)
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{entry.name}</span>
                    <span className="shrink-0 text-[11px] text-ink-faint">
                      {SCOPE_LABELS[entry.scope]} · {entry.type}
                      {entry.conflicting ? ' ⚠' : ''}
                    </span>
                    <span className="num shrink-0 text-[11px] text-ink-faint">{entry.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-1 px-1 pb-2">
          <p className="px-3 pb-1 text-[12px] text-ink-dim">
            <button type="button" className="text-accent hover:underline" onClick={() => setPicked(null)}>
              ← inna property
            </button>
            {'  '}
            <span className="text-ink">{picked.name}</span> — property {SCOPE_LABELS[picked.scope]} ·{' '}
            <span className="num">{picked.count}</span> wystąpień
          </p>

          <Field label="Nowa nazwa">
            <TextInput
              value={rename}
              aria-label="Nowa nazwa property"
              disabled={remove}
              onChange={(e) => setRename(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Nowy typ" hint={retype === '' ? 'Bez zmiany typu.' : 'Wartości, których nie da się przeliczyć, staną się puste.'}>
            <Select value={retype} disabled={remove} onChange={(e) => setRetype(e.target.value as PropertyType | '')}>
              <option value="">— bez zmiany ({picked.type}) —</option>
              {TYPES.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 px-3 py-2 text-[13px] text-ink-dim">
            <input type="checkbox" checked={remove} onChange={(e) => setRemove(e.target.checked)} />
            Usuń tę property z całego projektu
          </label>

          {preview ? (
            <div className="mx-3 mt-1 rounded-md border border-line bg-ground/60 p-2">
              {preview.properties === 0 ? (
                <p className="text-[12px] text-ink-faint">Nic nie pasuje — żaden plik nie zostanie zmieniony.</p>
              ) : (
                <>
                  <p className="text-[12px] text-ink">
                    Zmieni <span className="num">{preview.properties}</span> w{' '}
                    <span className="num">{preview.files.length}</span>{' '}
                    {preview.files.length === 1 ? 'pliku' : 'plikach'}.
                  </p>
                  <ul className="mt-1 max-h-32 overflow-y-auto text-[11px] text-ink-faint">
                    {preview.files.slice(0, 40).map((file) => (
                      <li key={file.path} className="flex gap-2">
                        <span className="min-w-0 flex-1 truncate" title={file.path}>
                          {file.kind === 'map' ? mapTitle(file.path) : file.path}
                        </span>
                        <span className="num">{file.count}</span>
                      </li>
                    ))}
                    {preview.files.length > 40 ? <li>…i {preview.files.length - 40} więcej</li> : null}
                  </ul>
                </>
              )}
            </div>
          ) : null}

          <p className={clsx('flex items-start gap-1.5 px-3 pt-2 text-[11px]', dirty ? 'text-danger' : 'text-warn')}>
            <AlertTriangle size={13} className="mt-px shrink-0" />
            {dirty
              ? 'Otwarta mapa ma niezapisane zmiany — zapisz ją najpierw.'
              : 'Zapisu w wielu plikach nie da się cofnąć jednym Ctrl+Z. Podejrzyj przed zastosowaniem.'}
          </p>
        </div>
      )}
    </Dialog>
  )
}
