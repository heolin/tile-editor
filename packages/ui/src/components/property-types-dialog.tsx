import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Boxes, ListChecks, Plus, Sparkles, Trash2, Wand2 } from 'lucide-react'
import {
  ALL_TARGETS, type ClassPropertyType, type EnumPropertyType,
  type PropertyTypeDef, type TypeSuggestion,
} from '@tile-editor/core'
import { Button, Dialog, Empty, Field, Select, TextInput } from './ui'
import { useEditor } from '../state/store'

/**
 * Custom types are where a project stops relying on convention. The corpus runs
 * entirely on loose string properties, and the first lint pass found the same
 * name used with two different types - so this dialog leads with proposing
 * types from how the project already behaves, rather than with an empty form.
 */
export function PropertyTypesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useEditor((s) => s.project)
  const save = useEditor((s) => s.savePropertyTypes)
  const suggest = useEditor((s) => s.suggestPropertyTypes)
  const apply = useEditor((s) => s.applyPropertyType)
  const notify = useEditor((s) => s.notify)

  const types = project?.config.propertyTypes ?? []
  const [tab, setTab] = useState<'list' | 'suggest'>('list')
  const [suggestions, setSuggestions] = useState<TypeSuggestion[] | undefined>()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [assign, setAssign] = useState(true)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<PropertyTypeDef | undefined>()

  useEffect(() => {
    if (!open) return
    setTab(types.length === 0 ? 'suggest' : 'list')
    setSuggestions(undefined)
    setPicked(new Set())
    setAssign(true)
    setBusy(false)
    setEditing(undefined)
  }, [open])

  const runSuggest = async () => {
    setBusy(true)
    const found = await suggest()
    setSuggestions(found)
    setPicked(new Set(found.map(key)))
    setBusy(false)
  }

  const createPicked = async () => {
    if (!suggestions) return
    setBusy(true)
    const chosen = suggestions.filter((s) => picked.has(key(s)))
    let nextId = types.reduce((max, t) => Math.max(max, t.id), 0) + 1
    const created: PropertyTypeDef[] = chosen.map((suggestion) => ({
      kind: 'enum',
      id: nextId++,
      name: typeNameFor(suggestion, types),
      storageType: 'string',
      values: suggestion.values,
      valuesAsFlags: false,
    }))
    await save([...types, ...created])

    if (assign) {
      let maps = 0
      let properties = 0
      for (const [index, suggestion] of chosen.entries()) {
        const result = await apply(suggestion.scope, suggestion.property, created[index]!.name)
        maps += result.maps
        properties += result.properties
      }
      notify(`Przypisano typy do ${properties} properties w ${maps} mapach`)
    }
    setBusy(false)
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} title="Typy projektu">
      <div className="flex gap-1 px-3 pb-1 pt-2">
        <Button variant="outline" active={tab === 'list'} onClick={() => setTab('list')}>
          <ListChecks size={13} /> Zadeklarowane ({types.length})
        </Button>
        <Button variant="outline" active={tab === 'suggest'} onClick={() => setTab('suggest')}>
          <Sparkles size={13} /> Zaproponuj z projektu
        </Button>
      </div>

      {tab === 'list' ? (
        editing ? (
          <TypeEditor
            type={editing}
            onCancel={() => setEditing(undefined)}
            onSave={async (next) => {
              await save(types.map((t) => (t.id === next.id ? next : t)))
              setEditing(undefined)
            }}
          />
        ) : (
          <>
            {types.length === 0 ? (
              <Empty>
                Projekt nie deklaruje żadnych typów. Zakładka obok potrafi je zgadnąć z tego, jak
                properties są już używane.
              </Empty>
            ) : (
              <ul className="divide-y divide-line/60">
                {types.map((type) => (
                  <li key={type.id} className="flex items-center gap-2 px-3 py-2">
                    {type.kind === 'enum' ? (
                      <ListChecks size={14} className="shrink-0 text-ink-faint" />
                    ) : (
                      <Boxes size={14} className="shrink-0 text-ink-faint" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-ink">{type.name}</div>
                      <div className="truncate text-[11px] text-ink-faint">
                        {type.kind === 'enum'
                          ? `${type.storageType}${type.valuesAsFlags ? ' · flagi' : ''} · ${type.values.join(', ')}`
                          : `klasa · ${type.members.length} pól · ${type.useAs.join(', ')}`}
                      </div>
                    </div>
                    {type.kind === 'enum' ? (
                      <Button size="sm" variant="outline" onClick={() => setEditing(type)}>Edytuj</Button>
                    ) : null}
                    <button
                      type="button"
                      className="hit shrink-0 px-1 text-ink-faint hover:text-danger"
                      title={`Usuń typ ${type.name}`}
                      aria-label={`Usuń typ ${type.name}`}
                      onClick={() => void save(types.filter((t) => t.id !== type.id))}
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end gap-2 px-3 py-2">
              <Button
                variant="outline"
                onClick={() =>
                  setEditing({
                    kind: 'enum',
                    id: types.reduce((max, t) => Math.max(max, t.id), 0) + 1,
                    name: 'NowyTyp',
                    storageType: 'string',
                    values: [''],
                    valuesAsFlags: false,
                  })
                }
              >
                <Plus size={14} /> Nowy enum
              </Button>
            </div>
          </>
        )
      ) : (
        <>
          {suggestions === undefined ? (
            <div className="flex flex-col items-start gap-3 px-3 py-4">
              <p className="text-[13px] leading-relaxed text-ink-dim">
                Przejrzę wszystkie mapy i poszukam properties tekstowych, które w praktyce
                przyjmują tylko kilka powtarzających się wartości. To są enumy, których projekt
                używa, tylko nigdzie ich nie zapisał.
              </p>
              <Button variant="solid" disabled={busy} onClick={() => void runSuggest()}>
                <Wand2 size={14} /> {busy ? 'Szukam…' : 'Przejrzyj projekt'}
              </Button>
            </div>
          ) : suggestions.length === 0 ? (
            <Empty>Nie znalazłem properties, które wyglądałyby na zamknięty zbiór wartości.</Empty>
          ) : (
            <>
              <ul className="divide-y divide-line/60">
                {suggestions.map((suggestion) => {
                  const id = key(suggestion)
                  return (
                    <li key={id}>
                      <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2">
                        <input
                          type="checkbox"
                          checked={picked.has(id)}
                          onChange={(e) => {
                            const next = new Set(picked)
                            if (e.target.checked) next.add(id)
                            else next.delete(id)
                            setPicked(next)
                          }}
                          className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="truncate text-[13px] text-ink">{typeNameFor(suggestion, types)}</span>
                            <span className="num shrink-0 text-[11px] text-ink-faint">
                              {suggestion.scope === 'map' ? 'mapa' : 'obiekt'} · {suggestion.property} · ×{suggestion.occurrences}
                            </span>
                          </div>
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {suggestion.values.map((value) => (
                              <span key={value} className="rounded border border-line bg-ground px-1.5 text-[11px] text-ink-dim">
                                {value}
                              </span>
                            ))}
                          </div>
                        </div>
                      </label>
                    </li>
                  )
                })}
              </ul>
              <div className="flex flex-col gap-2 border-t border-line px-3 py-2">
                <label className="flex items-start gap-2 text-[12.5px] text-ink-dim">
                  <input
                    type="checkbox"
                    checked={assign}
                    onChange={(e) => setAssign(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                  />
                  <span>
                    Przypisz typy do istniejących properties we wszystkich mapach.
                    <span className="block text-[11px] text-warn">
                      To zapisuje pliki bezpośrednio i nie da się tego cofnąć w edytorze — cofniesz to gitem.
                    </span>
                  </span>
                </label>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={onClose}>Anuluj</Button>
                  <Button variant="solid" disabled={busy || picked.size === 0} onClick={() => void createPicked()}>
                    {busy ? 'Pracuję…' : `Utwórz ${picked.size}`}
                  </Button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </Dialog>
  )
}

function TypeEditor({ type, onSave, onCancel }: {
  type: PropertyTypeDef
  onSave: (next: PropertyTypeDef) => void | Promise<void>
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<EnumPropertyType>(
    type.kind === 'enum' ? { ...type, values: [...type.values] } : ({} as EnumPropertyType),
  )
  if (type.kind !== 'enum') return null

  const setValue = (index: number, value: string) =>
    setDraft({ ...draft, values: draft.values.map((v, i) => (i === index ? value : v)) })

  return (
    <div className="flex flex-col">
      <Field label="Nazwa typu">
        <TextInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </Field>
      <Field label="Przechowywanie" hint="string zapisuje tekst, int zapisuje indeks wartości.">
        <Select
          value={draft.storageType}
          onChange={(e) => setDraft({ ...draft, storageType: e.target.value as 'string' | 'int' })}
        >
          <option value="string">string</option>
          <option value="int">int</option>
        </Select>
      </Field>
      <div className="px-3 pb-1">
        <label className="flex items-center gap-2 text-[12.5px] text-ink-dim">
          <input
            type="checkbox"
            checked={draft.valuesAsFlags}
            onChange={(e) => setDraft({ ...draft, valuesAsFlags: e.target.checked, storageType: 'int' })}
            className="h-4 w-4 accent-[var(--color-accent)]"
          />
          Wartości jako flagi (można wybrać kilka naraz)
        </label>
      </div>

      <div className="flex flex-col gap-1 px-3 py-2">
        <span className="text-[11px] font-medium tracking-wide text-ink-faint">Wartości</span>
        {draft.values.map((value, index) => (
          <div key={index} className="flex items-center gap-1.5">
            <TextInput value={value} aria-label={`Wartość ${index + 1}`} onChange={(e) => setValue(index, e.target.value)} />
            <button
              type="button"
              className="hit shrink-0 px-1 text-ink-faint hover:text-danger"
              aria-label={`Usuń wartość ${index + 1}`}
              onClick={() => setDraft({ ...draft, values: draft.values.filter((_, i) => i !== index) })}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <Button size="sm" variant="outline" className="self-start" onClick={() => setDraft({ ...draft, values: [...draft.values, ''] })}>
          <Plus size={13} /> Dodaj wartość
        </Button>
      </div>

      <div className="flex justify-end gap-2 border-t border-line px-3 py-2">
        <Button variant="outline" onClick={onCancel}>Anuluj</Button>
        <Button
          variant="solid"
          disabled={!draft.name.trim() || draft.values.filter((v) => v.trim()).length < 1}
          onClick={() => void onSave({ ...draft, values: draft.values.map((v) => v.trim()).filter(Boolean) })}
        >
          Zapisz typ
        </Button>
      </div>
    </div>
  )
}

const key = (suggestion: TypeSuggestion) => `${suggestion.scope}.${suggestion.property}`

/** A CamelCase type name from the property it describes, kept unique. */
function typeNameFor(suggestion: TypeSuggestion, existing: PropertyTypeDef[]): string {
  const base = suggestion.property.replace(/(^|[^A-Za-z0-9])([a-z])/g, (_, sep: string, ch: string) => ch.toUpperCase())
  const taken = new Set(existing.map((t) => t.name))
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}${n}`)) n++
  return `${base}${n}`
}

export { ALL_TARGETS, type ClassPropertyType }
