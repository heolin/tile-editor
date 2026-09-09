import { useEffect, useMemo, useState } from 'react'
import { mapFolder, mapTitle } from '@tile-editor/core'
import { Button, Dialog, Field, Select, TextInput } from './ui'
import { useEditor } from '../state/store'

/**
 * Creating a map is the one place the editor writes a file that did not exist.
 * Both example projects keep a hand-maintained `template.tmj`, so basing a new
 * map on an existing one is offered first and picked by default when found.
 */
export function NewMapDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useEditor((s) => s.project)
  const doc = useEditor((s) => s.doc)
  const createMap = useEditor((s) => s.createMap)

  const folders = useMemo(() => {
    const set = new Set<string>(['.'])
    for (const path of project?.maps ?? []) set.add(mapFolder(path))
    return [...set].sort()
  }, [project])

  const templates = project?.maps ?? []
  const suggestedTemplate = templates.find((p) => mapTitle(p).toLowerCase() === 'template')

  const [name, setName] = useState('nowa-mapa')
  const [folder, setFolder] = useState('.')
  const [template, setTemplate] = useState('')
  const [width, setWidth] = useState(20)
  const [height, setHeight] = useState(20)
  const [tileSize, setTileSize] = useState(32)
  const [keepContent, setKeepContent] = useState(false)
  const [busy, setBusy] = useState(false)

  // Opening the dialog picks sensible starting values from the project itself.
  useEffect(() => {
    if (!open) return
    setName('nowa-mapa')
    setFolder(doc ? mapFolder(doc.path) : (folders[0] ?? '.'))
    setTemplate(suggestedTemplate ?? '')
    setKeepContent(false)
    setBusy(false)
    if (doc) {
      setWidth(doc.map.width)
      setHeight(doc.map.height)
      setTileSize(doc.map.tilewidth)
    }
  }, [open])

  // A chosen template brings its own dimensions; showing the open map's size
  // instead would silently produce a map the wrong shape.
  useEffect(() => {
    if (!open || !template) return
    let cancelled = false
    const loader = useEditor.getState().loader
    void loader?.loadMap(template).then((loaded) => {
      if (cancelled) return
      setWidth(loaded.map.width)
      setHeight(loaded.map.height)
      setTileSize(loaded.map.tilewidth)
    }).catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [open, template])

  const fileName = name.endsWith('.tmj') || name.endsWith('.tmx') ? name : `${name}.tmj`
  const valid = name.trim().length > 0 && width > 0 && height > 0 && tileSize > 0

  const submit = async () => {
    setBusy(true)
    await createMap({
      fileName,
      folder,
      width,
      height,
      tilewidth: tileSize,
      tileheight: tileSize,
      templatePath: template || undefined,
      keepContent,
    })
    setBusy(false)
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Nowa mapa"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Anuluj</Button>
          <Button variant="solid" disabled={!valid || busy} onClick={() => void submit()}>
            {busy ? 'Tworzę…' : 'Utwórz'}
          </Button>
        </>
      }
    >
      <Field label="Nazwa pliku" hint={`Powstanie ${folder === '.' ? '' : folder + '/'}${fileName}`}>
        <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>

      <Field label="Folder">
        <Select value={folder} onChange={(e) => setFolder(e.target.value)}>
          {folders.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </Select>
      </Field>

      <Field
        label="Na podstawie"
        hint={template ? 'Warstwy, tilesety i properties zostaną skopiowane.' : 'Pusta mapa z warstwą kafli i warstwą obiektów.'}
      >
        <Select value={template} onChange={(e) => setTemplate(e.target.value)}>
          <option value="">Pusta mapa</option>
          {templates.map((path) => (
            <option key={path} value={path}>{path}</option>
          ))}
        </Select>
      </Field>

      <div className="grid grid-cols-2">
        <Field label="Szerokość (kafle)">
          <TextInput className="num" type="number" min={1} value={width} onChange={(e) => setWidth(Number(e.target.value))} />
        </Field>
        <Field label="Wysokość (kafle)">
          <TextInput className="num" type="number" min={1} value={height} onChange={(e) => setHeight(Number(e.target.value))} />
        </Field>
      </div>

      {template ? (
        <Field label="Zawartość">
          <label className="flex items-center gap-2 text-[13px] text-ink-dim">
            <input
              type="checkbox"
              checked={keepContent}
              onChange={(e) => setKeepContent(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            Skopiuj też kafle i obiekty
          </label>
        </Field>
      ) : (
        <Field label="Rozmiar kafla (px)">
          <TextInput className="num" type="number" min={1} value={tileSize} onChange={(e) => setTileSize(Number(e.target.value))} />
        </Field>
      )}
    </Dialog>
  )
}
