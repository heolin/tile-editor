import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { Plus, Trash2 } from 'lucide-react'
import {
  FLIP_H, FLIP_V, ResizeMapCommand, SetAnimationCommand, SetPropertyCommand,
  UpdateLayerCommand, UpdateObjectsCommand, classFor, classMemberStates,
  defaultValueFor, flagsToValues, parseGid, propertiesOutsideClass,
  setClassMember, storageTypeOf, tileLabel, valuesToFlags, walkLayers,
  type ClassMember, type ClassPropertyType, type EnumPropertyType, type Frame,
  type Property, type PropertyType, type PropertyTypeDef, type PropertyTypeTarget,
  type Tile, type Tileset,
} from '@tile-editor/core'
import { Button, Empty, Field, Panel, Select, TextInput } from './ui'
import { useEditor, type PropertyOwner } from '../state/store'

const TYPES: PropertyType[] = ['string', 'int', 'float', 'bool', 'color', 'file']

/**
 * All of the corpus's game semantics live in properties rather than classes, so
 * this panel is the editor's centre of gravity, not a side feature
 * (docs/PLAN.md section 5.1).
 */
export function PropertiesPanel() {
  const doc = useEditor((s) => s.doc)
  const target = useEditor((s) => s.propertyTarget)
  useEditor((s) => s.revision)
  const state = useEditor.getState()

  const owner = useMemo(() => resolveOwner(target), [target, doc, state.revision])
  const registry = state.types()
  const kind = targetKind(target)
  const customTypes = registry.usableOn(kind)
  const nodeClass = owner ? classFor(owner.className, registry, kind) : undefined

  if (!doc) return <Panel title="Properties"><Empty>Brak otwartej mapy.</Empty></Panel>
  if (!owner) return <Panel title="Properties"><Empty>Nic nie jest zaznaczone.</Empty></Panel>

  const commit = (next: Property[]) => {
    state.history.run(new SetPropertyCommand(owner.node, next, `Properties: ${owner.title}`, `props:${owner.key}`))
    if (target.kind === 'tile') state.markTilesetDirty(target.tilesetPath)
    state.touch()
  }

  const setAt = (index: number, patch: Partial<Property>) => {
    const next = owner.node.properties.map((p, i) => (i === index ? { ...p, ...patch } : { ...p }))
    commit(next)
  }

  return (
    <Panel
      title={`Properties · ${owner.title}`}
      actions={
        <Button
          size="sm"
          title="Dodaj property"
          onClick={() => commit([...owner.node.properties, { name: uniqueName(owner.node.properties), type: 'string', value: '' }])}
        >
          <Plus size={14} />
        </Button>
      }
    >
      {owner.header}

      {nodeClass ? (
        <NodeClassSection type={nodeClass} owner={owner} onCommit={commit} />
      ) : null}

      {propertiesOutsideClass(owner.node.properties, nodeClass).length === 0 ? (
        <Empty>
          {nodeClass
            ? 'Poza klasą nie ma dodatkowych properties.'
            : 'Brak properties. Dodaj pierwszą przyciskiem plus.'}
        </Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-line/60">
          {owner.node.properties.map((prop, index) => (
            nodeClass?.members.some((member) => member.name === prop.name) ? null :
            <li key={index} className="flex flex-col gap-1.5 px-3 py-2">
              {/* The name gets its own row: sharing one with the type selector
                  crushed it to a couple of characters in a 240px panel. */}
              {/* A grid rather than flex: the shared base class on Select sets
                  w-full, which beats any width utility passed in here. */}
              <div className="grid grid-cols-[minmax(0,1fr)_76px_auto] items-center gap-1.5">
                <TextInput
                  value={prop.name}
                  aria-label="Nazwa property"
                  onChange={(e) => setAt(index, { name: e.target.value })}
                  className="font-medium"
                />
                <Select
                  value={prop.propertytype ? `custom:${prop.propertytype}` : prop.type}
                  aria-label="Typ property"
                  className="px-1 text-[11px]"
                  onChange={(e) => {
                    const chosen = e.target.value
                    if (chosen.startsWith('custom:')) {
                      const def = registry.get(chosen.slice(7))
                      if (!def) return
                      setAt(index, {
                        type: storageTypeOf(def),
                        propertytype: def.name,
                        value: defaultValueFor(def),
                      })
                      return
                    }
                    setAt(index, {
                      type: chosen as PropertyType,
                      propertytype: undefined,
                      value: coerce(prop.value, chosen as PropertyType),
                    })
                  }}
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                  {customTypes.length > 0 ? (
                    <optgroup label="Typy projektu">
                      {customTypes.map((def) => (
                        <option key={def.name} value={`custom:${def.name}`}>{def.name}</option>
                      ))}
                    </optgroup>
                  ) : null}
                </Select>
                <button
                  type="button"
                  className="hit shrink-0 px-1 text-ink-faint hover:text-danger"
                  title="Usuń property"
                  aria-label={`Usuń property ${prop.name}`}
                  onClick={() => commit(owner.node.properties.filter((_, i) => i !== index))}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <PropertyValue prop={prop} definition={registry.get(prop.propertytype)} onChange={(value) => setAt(index, { value })} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/** Which custom types make sense here, per each class's `useAs`. */
function targetKind(target: PropertyOwner): PropertyTypeTarget {
  switch (target.kind) {
    case 'map': return 'map'
    case 'layer': return 'layer'
    case 'object': return 'object'
    case 'tile': return 'tile'
  }
}

function PropertyValue({ prop, definition, onChange }: {
  prop: Property
  definition?: PropertyTypeDef
  onChange: (value: unknown) => void
}) {
  // A declared type replaces free text with the choices it allows, which is the
  // whole point of declaring it.
  if (definition?.kind === 'enum') return <EnumValue type={definition} prop={prop} onChange={onChange} />
  if (definition?.kind === 'class') return <ClassValue type={definition} prop={prop} onChange={onChange} />

  if (prop.type === 'bool') {
    return (
      <label className="flex items-center gap-2 text-[13px] text-ink-dim">
        <input
          type="checkbox"
          checked={prop.value === true}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 accent-[var(--color-accent)]"
        />
        {prop.value === true ? 'true' : 'false'}
      </label>
    )
  }
  if (prop.type === 'color') {
    const value = typeof prop.value === 'string' && prop.value ? toHex(prop.value) : '#4fd6bc'
    return (
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(fromHex(e.target.value))}
          className="hit w-12 rounded border border-line bg-ground"
        />
        <TextInput value={String(prop.value ?? '')} onChange={(e) => onChange(e.target.value)} />
      </div>
    )
  }
  if (prop.type === 'int' || prop.type === 'float') {
    return (
      <TextInput
        type="number"
        inputMode={prop.type === 'int' ? 'numeric' : 'decimal'}
        step={prop.type === 'int' ? 1 : 'any'}
        value={String(prop.value ?? 0)}
        onChange={(e) => onChange(prop.type === 'int' ? Math.trunc(Number(e.target.value)) : Number(e.target.value))}
        className="num"
      />
    )
  }
  return <TextInput value={String(prop.value ?? '')} onChange={(e) => onChange(e.target.value)} />
}

function EnumValue({ type, prop, onChange }: {
  type: EnumPropertyType
  prop: Property
  onChange: (value: unknown) => void
}) {
  if (type.valuesAsFlags) {
    const chosen = flagsToValues(type, prop.value)
    return (
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {type.values.map((value) => (
          <label key={value} className="flex items-center gap-1.5 text-[12.5px] text-ink-dim">
            <input
              type="checkbox"
              checked={chosen.includes(value)}
              onChange={(e) => {
                const next = e.target.checked ? [...chosen, value] : chosen.filter((v) => v !== value)
                onChange(valuesToFlags(type, next))
              }}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            {value}
          </label>
        ))}
      </div>
    )
  }

  // An int-backed enum stores the index; a string-backed one stores the text.
  const current = type.storageType === 'int' ? (type.values[Number(prop.value) || 0] ?? '') : String(prop.value ?? '')
  const known = type.values.includes(current)
  return (
    <div className="flex flex-col gap-1">
      <Select
        value={known ? current : ''}
        aria-label={`Wartość property ${prop.name}`}
        onChange={(e) => {
          const index = type.values.indexOf(e.target.value)
          onChange(type.storageType === 'int' ? index : e.target.value)
        }}
      >
        {!known ? <option value="">— wybierz —</option> : null}
        {type.values.map((value) => (
          <option key={value} value={value}>{value}</option>
        ))}
      </Select>
      {!known ? (
        <span className="text-[11px] text-danger">
          Obecna wartość „{String(prop.value ?? '')}" nie należy do typu {type.name}.
        </span>
      ) : null}
    </div>
  )
}

function ClassValue({ type, prop, onChange }: {
  type: ClassPropertyType
  prop: Property
  onChange: (value: unknown) => void
}) {
  const value = (prop.value ?? {}) as Record<string, unknown>
  const setMember = (name: string, next: unknown) => onChange({ ...value, [name]: next })

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-line bg-ground/40 p-2">
      {type.members.length === 0 ? (
        <span className="text-[11px] text-ink-faint">Klasa {type.name} nie ma pól.</span>
      ) : (
        type.members.map((member) => (
          <label key={member.name} className="grid grid-cols-[minmax(0,88px)_minmax(0,1fr)] items-center gap-2">
            <span className="truncate text-[11.5px] text-ink-faint" title={member.name}>{member.name}</span>
            <MemberValue
              member={member}
              value={value[member.name] ?? member.value}
              onChange={(next) => setMember(member.name, next)}
            />
          </label>
        ))
      )}
    </div>
  )
}

function MemberValue({ member, value, onChange }: {
  member: ClassMember
  value: unknown
  onChange: (next: unknown) => void
}) {
  const registry = useEditor.getState().types()
  const definition = registry.get(member.propertyType)
  // Nested enums render as their own dropdown; nested classes stay a summary,
  // because a fully recursive editor in a 240px panel helps nobody.
  if (definition?.kind === 'enum') {
    return (
      <EnumValue
        type={definition}
        prop={{ name: member.name, type: member.type, value }}
        onChange={onChange}
      />
    )
  }
  if (member.type === 'bool') {
    return (
      <input
        type="checkbox"
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 justify-self-start accent-[var(--color-accent)]"
      />
    )
  }
  if (member.type === 'int' || member.type === 'float') {
    return (
      <TextInput
        className="num"
        type="number"
        step={member.type === 'int' ? 1 : 'any'}
        value={String(value ?? 0)}
        onChange={(e) => onChange(member.type === 'int' ? Math.trunc(Number(e.target.value)) : Number(e.target.value))}
      />
    )
  }
  if (member.type === 'class') {
    const fields = Object.keys((value ?? {}) as Record<string, unknown>).length
    return <span className="text-[11.5px] text-ink-faint">{member.propertyType ?? 'klasa'} · {fields} pól</span>
  }
  return <TextInput value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
}

/* ------------------------------------------------------------------ */

interface ResolvedOwner {
  key: string
  title: string
  node: { properties: Property[] }
  /** The node's own class, when it declares one. */
  className?: string
  header?: React.ReactNode
}

/**
 * A node carrying a class shows that class's members as its own fields, with
 * inherited defaults filled in. Setting a field back to its default removes the
 * property, matching what Tiled writes.
 */
function NodeClassSection({ type, owner, onCommit }: {
  type: ClassPropertyType
  owner: ResolvedOwner
  onCommit: (next: Property[]) => void
}) {
  const states = classMemberStates(type, owner.node.properties)
  return (
    <div className="border-b border-line bg-ground/30">
      <div className="flex items-center gap-2 px-3 pb-1 pt-2">
        <span className="text-[11px] font-medium tracking-wide text-ink-faint">Z klasy</span>
        <span
          className="rounded px-1.5 text-[11px] font-medium"
          style={type.color ? { background: `${type.color.slice(0, 1)}${type.color.slice(3)}22`, color: 'inherit' } : undefined}
        >
          {type.name}
        </span>
      </div>
      <ul className="flex flex-col gap-1.5 px-3 pb-2">
        {states.map((state) => (
          <li key={state.member.name} className="grid grid-cols-[minmax(0,100px)_minmax(0,1fr)] items-center gap-2">
            <span
              className={clsx('truncate text-[12px]', state.overridden ? 'text-ink' : 'text-ink-faint')}
              title={state.overridden ? state.member.name : `${state.member.name} — wartość domyślna klasy`}
            >
              {state.member.name}
              {state.overridden ? null : <span className="pl-1 text-ink-faint">·</span>}
            </span>
            <MemberValue
              member={state.member}
              value={state.value}
              onChange={(next) => onCommit(setClassMember(owner.node.properties, state.member, next))}
            />
          </li>
        ))}
      </ul>
      <p className="px-3 pb-2 text-[10.5px] text-ink-faint">
        Pola równe domyślnym nie trafiają do pliku — tak samo robi Tiled.
      </p>
    </div>
  )
}

function resolveOwner(target: PropertyOwner): ResolvedOwner | undefined {
  const state = useEditor.getState()
  const doc = state.doc
  if (!doc) return undefined

  if (target.kind === 'map') {
    return { key: 'map', title: 'Mapa', node: doc.map, className: doc.map.className, header: <MapHeader /> }
  }
  if (target.kind === 'layer') {
    const layer = [...walkLayers(doc.map.layers)].find((l) => l.id === target.id)
    if (!layer) return undefined
    return {
      key: `layer:${layer.id}`,
      title: layer.name || 'Warstwa',
      node: layer,
      className: layer.className,
      header: <LayerHeader id={layer.id} />,
    }
  }
  if (target.kind === 'object') {
    for (const layer of walkLayers(doc.map.layers)) {
      if (layer.kind !== 'objectgroup') continue
      const obj = layer.objects.find((o) => o.id === target.id)
      if (obj) {
        return {
          key: `object:${obj.id}`,
          title: `Obiekt #${obj.id}`,
          node: obj,
          className: obj.className,
          header: <ObjectHeader id={obj.id} />,
        }
      }
    }
    return undefined
  }
  const entry = state.tilesets().find((t) => t.path === target.tilesetPath)
  const tile = entry?.tileset.tiles.find((t) => t.id === target.tileId)
  if (!tile || !entry) return undefined
  return {
    key: `tile:${target.tilesetPath}:${tile.id}`,
    title: `Kafel #${tile.id}`,
    node: tile,
    header: (
      <div className="border-b border-line">
        <p className="px-3 py-2 text-[11px] text-ink-faint">
          {entry.tileset.name} · {tile.image?.split('/').pop() ?? `id ${tile.id}`}
          <br />
          <span className="text-ink-faint">
            Zmiany zapisują się do {entry.tileset.sourcePath ?? 'tilesetu'} razem z mapą.
          </span>
        </p>
        <TileAnimationEditor tilesetPath={target.tilesetPath} tileset={entry.tileset} tile={tile} />
      </div>
    ),
  }
}

function MapHeader() {
  const doc = useEditor((s) => s.doc)!
  useEditor((s) => s.revision)
  const state = useEditor.getState()
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const w = size?.w ?? doc.map.width
  const h = size?.h ?? doc.map.height
  const changed = w !== doc.map.width || h !== doc.map.height

  const apply = () => {
    if (!changed || w < 1 || h < 1) return
    state.history.run(new ResizeMapCommand(doc.map, w, h))
    state.touch()
    setSize(null)
  }

  return (
    <div className="border-b border-line pb-2">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 px-3 py-2 text-[11px]">
        <Stat label="Kafel" value={`${doc.map.tilewidth} × ${doc.map.tileheight}`} />
        <Stat label="Orientacja" value={doc.map.orientation} />
        <Stat
          label="Format"
          value={doc.format === 'xml' ? 'TMX' : doc.hints.dialect === 'plain' ? 'JSON (generator)' : 'JSON (Tiled)'}
        />
      </dl>
      <div className="grid grid-cols-2">
        <Field label="Szerokość (kafle)">
          <TextInput className="num" type="number" min={1} value={w} onChange={(e) => setSize({ w: Number(e.target.value), h })} />
        </Field>
        <Field label="Wysokość (kafle)">
          <TextInput className="num" type="number" min={1} value={h} onChange={(e) => setSize({ w, h: Number(e.target.value) })} />
        </Field>
      </div>
      {changed ? (
        <div className="flex items-center gap-2 px-3 pt-1">
          <Button size="sm" variant="solid" onClick={apply}>Zmień rozmiar</Button>
          <Button size="sm" variant="outline" onClick={() => setSize(null)}>Anuluj</Button>
          <span className="text-[11px] text-warn">
            {w < doc.map.width || h < doc.map.height ? 'Kafle poza nowym obszarem przepadną.' : ''}
          </span>
        </div>
      ) : null}
    </div>
  )
}

function LayerHeader({ id }: { id: number }) {
  const doc = useEditor((s) => s.doc)!
  const state = useEditor.getState()
  const layer = [...walkLayers(doc.map.layers)].find((l) => l.id === id)
  if (!layer) return null
  return (
    <div className="border-b border-line pb-2">
      <Field label="Nazwa warstwy">
        <TextInput
          value={layer.name}
          onChange={(e) => {
            state.history.run(new UpdateLayerCommand('Zmień nazwę warstwy', layer, { name: e.target.value }))
            state.touch()
          }}
        />
      </Field>
    </div>
  )
}

function ObjectHeader({ id }: { id: number }) {
  const doc = useEditor((s) => s.doc)!
  const state = useEditor.getState()
  let object
  for (const layer of walkLayers(doc.map.layers)) {
    if (layer.kind === 'objectgroup') {
      const found = layer.objects.find((o) => o.id === id)
      if (found) object = found
    }
  }
  if (!object) return null
  const obj = object
  const patch = (next: Partial<typeof obj>) => {
    state.history.run(new UpdateObjectsCommand('Zmień obiekt', [obj], [next]))
    state.touch()
  }
  return (
    <div className="border-b border-line pb-2">
      <Field label="Nazwa">
        <TextInput value={obj.name} onChange={(e) => patch({ name: e.target.value })} />
      </Field>
      <ClassField
        value={obj.className}
        target="object"
        onChange={(className) => patch({ className })}
      />
      <div className="grid grid-cols-2">
        <Field label="X"><TextInput type="number" className="num" value={obj.x} onChange={(e) => patch({ x: Number(e.target.value) })} /></Field>
        <Field label="Y"><TextInput type="number" className="num" value={obj.y} onChange={(e) => patch({ y: Number(e.target.value) })} /></Field>
        <Field label="Szerokość"><TextInput type="number" className="num" value={obj.width} onChange={(e) => patch({ width: Number(e.target.value) })} /></Field>
        <Field label="Wysokość"><TextInput type="number" className="num" value={obj.height} onChange={(e) => patch({ height: Number(e.target.value) })} /></Field>
      </div>
      <Field label="Obrót (stopnie)">
        <div className="flex items-center gap-1">
          {[0, 90, 180, 270].map((deg) => (
            <Button key={deg} size="sm" variant="outline" active={obj.rotation === deg} onClick={() => patch({ rotation: deg })}>
              {deg}°
            </Button>
          ))}
          <TextInput type="number" className="num flex-1" value={obj.rotation} onChange={(e) => patch({ rotation: Number(e.target.value) })} />
        </div>
      </Field>
      {obj.gid !== undefined ? (
        <Field label="Odbicie" hint="Flagi zapisane w wysokich bitach gid, tak jak robi to Tiled.">
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              active={parseGid(obj.gid).flipH}
              onClick={() => patch({ gid: (obj.gid! ^ FLIP_H) >>> 0 })}
            >
              W poziomie
            </Button>
            <Button
              size="sm"
              variant="outline"
              active={parseGid(obj.gid).flipV}
              onClick={() => patch({ gid: (obj.gid! ^ FLIP_V) >>> 0 })}
            >
              W pionie
            </Button>
          </div>
        </Field>
      ) : null}
    </div>
  )
}

/**
 * Animation frames point at sibling tiles in the same tileset. Nothing in the
 * corpus animates yet, but the format supports it and the editor should not be
 * the reason a project cannot use it.
 */
function TileAnimationEditor({ tilesetPath, tileset, tile }: {
  tilesetPath: string
  tileset: Tileset
  tile: Tile
}) {
  const state = useEditor.getState()
  const animate = useEditor((s) => s.animate)
  const frames = tile.animation ?? []

  const commit = (next: Frame[]) => {
    state.history.run(new SetAnimationCommand(tile, next))
    state.markTilesetDirty(tilesetPath)
    state.rebuildSource()
    state.touch()
  }

  const setFrame = (index: number, patch: Partial<Frame>) =>
    commit(frames.map((f, i) => (i === index ? { ...f, ...patch } : { ...f })))

  return (
    <div className="border-t border-line px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium tracking-wide text-ink-faint">Animacja</span>
        <div className="flex items-center gap-1">
          {frames.length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              active={animate}
              onClick={() => state.toggleAnimate()}
              title="Odtwarzanie animacji na mapie"
            >
              {animate ? 'Odtwarza' : 'Podgląd'}
            </Button>
          ) : null}
          <Button
            size="sm"
            title="Dodaj klatkę"
            aria-label="Dodaj klatkę animacji"
            onClick={() => commit([...frames, { tileid: tile.id, duration: 100 }])}
          >
            <Plus size={14} />
          </Button>
        </div>
      </div>

      {frames.length === 0 ? (
        <p className="pt-1 text-[11px] text-ink-faint">
          Kafel nie jest animowany. Dodaj klatkę, żeby zaczął przełączać się między kaflami tego tilesetu.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 pt-1.5">
          {frames.map((frame, index) => (
            <li key={index} className="grid grid-cols-[minmax(0,1fr)_72px_auto] items-center gap-1.5">
              <Select
                value={String(frame.tileid)}
                aria-label={`Kafel klatki ${index + 1}`}
                onChange={(e) => setFrame(index, { tileid: Number(e.target.value) })}
              >
                {tileset.tiles.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {tileLabel(candidate)}
                  </option>
                ))}
              </Select>
              <TextInput
                className="num"
                type="number"
                min={1}
                step={10}
                aria-label={`Czas klatki ${index + 1} w ms`}
                value={frame.duration}
                onChange={(e) => setFrame(index, { duration: Math.max(1, Number(e.target.value)) })}
              />
              <button
                type="button"
                className="hit shrink-0 px-1 text-ink-faint hover:text-danger"
                title="Usuń klatkę"
                aria-label={`Usuń klatkę ${index + 1}`}
                onClick={() => commit(frames.filter((_, i) => i !== index))}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
          <li className="num pt-0.5 text-right text-[10.5px] text-ink-faint">
            {frames.reduce((sum, f) => sum + f.duration, 0)} ms na pętlę
          </li>
        </ul>
      )}
    </div>
  )
}

/**
 * Picks the node's own class. Falls back to free text when the project declares
 * no classes, so a project that has not adopted types keeps working as before.
 */
function ClassField({ value, target, onChange }: {
  value: string
  target: PropertyTypeTarget
  onChange: (className: string) => void
}) {
  const registry = useEditor.getState().types()
  const classes = registry.usableOn(target).filter((type) => type.kind === 'class')
  const known = classes.some((type) => type.name === value)

  if (classes.length === 0) {
    return (
      <Field label="Klasa" hint="Projekt nie deklaruje żadnych klas dla tego węzła.">
        <TextInput value={value} onChange={(e) => onChange(e.target.value)} />
      </Field>
    )
  }

  return (
    <Field label="Klasa" hint={value && !known ? `„${value}" nie jest zadeklarowana w projekcie.` : undefined}>
      <Select value={known ? value : ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">— bez klasy —</option>
        {!known && value ? <option value={value}>{value} (nieznana)</option> : null}
        {classes.map((type) => (
          <option key={type.name} value={type.name}>{type.name}</option>
        ))}
      </Select>
    </Field>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-ink-faint">{label}</dt>
      <dd className="num text-right text-ink-dim">{value}</dd>
    </>
  )
}

function uniqueName(props: Property[]): string {
  let i = 1
  while (props.some((p) => p.name === `property${i}`)) i++
  return `property${i}`
}

function coerce(value: unknown, type: PropertyType): unknown {
  switch (type) {
    case 'int': return Math.trunc(Number(value) || 0)
    case 'float': return Number(value) || 0
    case 'bool': return Boolean(value)
    default: return value === undefined || value === null ? '' : String(value)
  }
}

/** Tiled stores colours as #AARRGGBB; the colour input wants #RRGGBB. */
function toHex(value: string): string {
  const hex = value.replace('#', '')
  return '#' + (hex.length === 8 ? hex.slice(2) : hex).padStart(6, '0')
}

function fromHex(value: string): string {
  return '#ff' + value.replace('#', '')
}
