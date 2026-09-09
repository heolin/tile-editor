import { AddLayerCommand, MoveLayerCommand, RemoveLayerCommand, UpdateLayerCommand, walkLayers, type Layer } from '@tile-editor/core'
import { ChevronDown, ChevronUp, Eye, EyeOff, Layers, Plus, Shapes, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { Button, Empty, Panel } from './ui'
import { makeObjectLayer, makeTileLayer, useEditor } from '../state/store'

export function LayersPanel() {
  const doc = useEditor((s) => s.doc)
  useEditor((s) => s.revision)
  const activeLayerId = useEditor((s) => s.activeLayerId)
  const state = useEditor.getState()
  if (!doc) return <Panel title="Warstwy"><Empty>Brak otwartej mapy.</Empty></Panel>

  const layers = [...walkLayers(doc.map.layers)]

  const add = (kind: 'tile' | 'object') => {
    const layer = kind === 'tile'
      ? makeTileLayer(doc.map, `warstwa ${doc.map.nextlayerid}`)
      : makeObjectLayer(doc.map, `obiekty ${doc.map.nextlayerid}`)
    state.history.run(new AddLayerCommand(doc.map, layer, doc.map.layers.length))
    state.touch()
    state.setActiveLayer(layer.id)
  }

  const move = (layer: Layer, delta: number) => {
    const from = doc.map.layers.indexOf(layer)
    const to = from + delta
    if (from < 0 || to < 0 || to >= doc.map.layers.length) return
    state.history.run(new MoveLayerCommand(doc.map, from, to))
    state.touch()
  }

  return (
    <Panel
      title="Warstwy"
      actions={
        <div className="flex gap-0.5">
          <Button size="sm" onClick={() => add('tile')} title="Nowa warstwa kafli">
            <Plus size={13} /> <Layers size={13} />
          </Button>
          <Button size="sm" onClick={() => add('object')} title="Nowa warstwa obiektów">
            <Plus size={13} /> <Shapes size={13} />
          </Button>
        </div>
      }
    >
      {layers.length === 0 ? (
        <Empty>Mapa nie ma warstw.</Empty>
      ) : (
        <ul className="flex flex-col-reverse">
          {layers.map((layer) => (
            <li key={layer.id}>
              <div
                className={clsx(
                  'flex items-center gap-1 border-b border-line/60 pr-1',
                  activeLayerId === layer.id ? 'bg-accent-deep/60' : 'hover:bg-hover',
                )}
              >
                <button
                  type="button"
                  className="hit px-2 text-ink-faint hover:text-ink"
                  title={layer.visible ? 'Ukryj warstwę' : 'Pokaż warstwę'}
                  onClick={() => {
                    state.history.run(
                      new UpdateLayerCommand(layer.visible ? 'Ukryj warstwę' : 'Pokaż warstwę', layer, { visible: !layer.visible }),
                    )
                    state.touch()
                  }}
                >
                  {layer.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>
                <button
                  type="button"
                  className="hit flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => state.setActiveLayer(layer.id)}
                >
                  {layer.kind === 'objectgroup' ? (
                    <Shapes size={13} className="shrink-0 text-ink-faint" />
                  ) : (
                    <Layers size={13} className="shrink-0 text-ink-faint" />
                  )}
                  <span className="truncate text-[13px]">{layer.name || '(bez nazwy)'}</span>
                  {layer.kind === 'objectgroup' ? (
                    <span className="num ml-auto shrink-0 pr-1 text-[11px] text-ink-faint">{layer.objects.length}</span>
                  ) : null}
                </button>
                <button
                  type="button"
                  className="hit px-1 text-ink-faint hover:text-ink"
                  title="W górę"
                  onClick={() => move(layer, 1)}
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  type="button"
                  className="hit px-1 text-ink-faint hover:text-ink"
                  title="W dół"
                  onClick={() => move(layer, -1)}
                >
                  <ChevronDown size={14} />
                </button>
                <button
                  type="button"
                  className="hit px-1 text-ink-faint hover:text-danger"
                  title="Usuń warstwę"
                  onClick={() => {
                    state.history.run(new RemoveLayerCommand(doc.map, layer))
                    state.touch()
                    if (activeLayerId === layer.id) state.setActiveLayer(doc.map.layers[0]?.id)
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              {activeLayerId === layer.id ? (
                <div className="flex items-center gap-2 border-b border-line/60 bg-ground/40 px-3 py-1.5">
                  <span className="text-[11px] text-ink-faint">Krycie</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(layer.opacity * 100)}
                    className="h-1 flex-1 accent-[var(--color-accent)]"
                    onChange={(e) => {
                      state.history.run(new UpdateLayerCommand('Krycie warstwy', layer, { opacity: Number(e.target.value) / 100 }))
                      state.touch()
                    }}
                  />
                  <span className="num w-9 text-right text-[11px] text-ink-dim">{Math.round(layer.opacity * 100)}%</span>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
