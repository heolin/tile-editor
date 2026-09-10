import type { Preserving, Property, PropertyType } from './model.js'

/**
 * Custom property types, as Tiled stores them in a project file. They matter
 * here more than in most projects: the corpus carries every piece of game logic
 * in loose properties, and the very first lint run found `railId` used as an
 * int in 56 objects and a string in 18. A declared type is what turns that from
 * something you notice later into something the editor refuses to let you type.
 */

/** Where a custom type may be attached. */
export type PropertyTypeTarget =
  | 'property' | 'map' | 'layer' | 'object' | 'tile' | 'tileset' | 'wangcolor' | 'wangset'

export const ALL_TARGETS: PropertyTypeTarget[] = [
  'property', 'map', 'layer', 'object', 'tile', 'tileset', 'wangcolor', 'wangset',
]

export interface EnumPropertyType extends Preserving {
  kind: 'enum'
  id: number
  name: string
  /** Whether values are stored in the map file as strings or as ints. */
  storageType: 'string' | 'int'
  values: string[]
  /** When set, a value is a bitmask combining several entries. */
  valuesAsFlags: boolean
}

export interface ClassMember extends Preserving {
  name: string
  type: PropertyType
  /** Name of another custom type, when this member is an enum or a class. */
  propertyType?: string
  value: unknown
}

export interface ClassPropertyType extends Preserving {
  kind: 'class'
  id: number
  name: string
  color?: string
  drawFill?: boolean
  members: ClassMember[]
  useAs: PropertyTypeTarget[]
}

export type PropertyTypeDef = EnumPropertyType | ClassPropertyType

const ENUM_KEYS = ['id', 'name', 'type', 'storageType', 'values', 'valuesAsFlags'] as const
const CLASS_KEYS = ['id', 'name', 'type', 'color', 'drawFill', 'members', 'useAs'] as const
const MEMBER_KEYS = ['name', 'type', 'propertyType', 'value'] as const

function keep(src: Record<string, unknown>, known: readonly string[]): Preserving {
  const extra: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(src)) if (!known.includes(k)) extra[k] = v
  const out: Preserving = { keyOrder: Object.keys(src) }
  if (Object.keys(extra).length > 0) out.extra = extra
  return out
}

function ordered(node: Preserving, known: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...known }
  for (const [k, v] of Object.entries(node.extra ?? {})) if (!(k in merged)) merged[k] = v
  const present = Object.keys(merged).filter((k) => merged[k] !== undefined)
  const seen = new Set<string>()
  const out: Record<string, unknown> = {}
  for (const k of node.keyOrder ?? []) {
    if (present.includes(k) && !seen.has(k)) {
      out[k] = merged[k]
      seen.add(k)
    }
  }
  for (const k of present.filter((k) => !seen.has(k)).sort()) out[k] = merged[k]
  return out
}

/* ------------------------------------------------------------------ */
/* Reading and writing                                                 */
/* ------------------------------------------------------------------ */

export function parsePropertyTypes(raw: unknown): PropertyTypeDef[] {
  if (!Array.isArray(raw)) return []
  const out: PropertyTypeDef[] = []
  for (const entry of raw) {
    const src = entry as Record<string, unknown>
    if (src.type === 'enum') {
      out.push({
        kind: 'enum',
        id: Number(src.id) || 0,
        name: String(src.name ?? ''),
        storageType: src.storageType === 'int' ? 'int' : 'string',
        values: Array.isArray(src.values) ? src.values.map(String) : [],
        valuesAsFlags: src.valuesAsFlags === true,
        ...keep(src, ENUM_KEYS),
      })
    } else if (src.type === 'class') {
      out.push({
        kind: 'class',
        id: Number(src.id) || 0,
        name: String(src.name ?? ''),
        color: src.color as string | undefined,
        drawFill: src.drawFill as boolean | undefined,
        members: Array.isArray(src.members)
          ? src.members.map((m) => {
              const member = m as Record<string, unknown>
              return {
                name: String(member.name ?? ''),
                type: (member.type as PropertyType) ?? 'string',
                propertyType: member.propertyType as string | undefined,
                value: member.value,
                ...keep(member, MEMBER_KEYS),
              }
            })
          : [],
        useAs: Array.isArray(src.useAs) ? (src.useAs as PropertyTypeTarget[]) : [...ALL_TARGETS],
        ...keep(src, CLASS_KEYS),
      })
    }
    // Anything else is a type this editor does not know; it stays in the raw
    // array the project codec preserves, so it is not lost either way.
  }
  return out
}

/**
 * Entries this editor does not recognise. They are carried through untouched
 * rather than dropped, on the same principle as everything else in the codecs.
 */
export function unrecognizedPropertyTypes(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((entry) => {
    const type = (entry as Record<string, unknown>)?.type
    return type !== 'enum' && type !== 'class'
  })
}

export function serializePropertyTypes(types: PropertyTypeDef[]): Record<string, unknown>[] {
  return types
    .slice()
    // Tiled writes them sorted by name, which keeps project diffs stable.
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((type) =>
      type.kind === 'enum'
        ? ordered(type, {
            id: type.id,
            name: type.name,
            storageType: type.storageType,
            type: 'enum',
            values: type.values,
            valuesAsFlags: type.valuesAsFlags,
          })
        : ordered(type, {
            color: type.color,
            drawFill: type.drawFill,
            id: type.id,
            members: type.members.map((member) =>
              ordered(member, {
                name: member.name,
                propertyType: member.propertyType,
                type: member.type,
                value: member.value,
              }),
            ),
            name: type.name,
            type: 'class',
            useAs: type.useAs,
          }),
    )
}

/* ------------------------------------------------------------------ */
/* Using them                                                          */
/* ------------------------------------------------------------------ */

export class PropertyTypeRegistry {
  private byName = new Map<string, PropertyTypeDef>()

  constructor(readonly types: PropertyTypeDef[] = []) {
    for (const type of types) this.byName.set(type.name, type)
  }

  get(name: string | undefined): PropertyTypeDef | undefined {
    return name === undefined ? undefined : this.byName.get(name)
  }

  get isEmpty(): boolean {
    return this.byName.size === 0
  }

  /** Types offerable on a given node, honouring each class's `useAs`. */
  usableOn(target: PropertyTypeTarget): PropertyTypeDef[] {
    return this.types.filter((type) => type.kind === 'enum' || type.useAs.includes(target))
  }

  /** The next free id, so a new type never collides with an existing one. */
  nextId(): number {
    return this.types.reduce((max, type) => Math.max(max, type.id), 0) + 1
  }
}

/** Splits a flags value into the entries it combines. */
export function flagsToValues(type: EnumPropertyType, value: unknown): string[] {
  const bits = Number(value) || 0
  return type.values.filter((_, index) => (bits & (1 << index)) !== 0)
}

export function valuesToFlags(type: EnumPropertyType, chosen: readonly string[]): number {
  return type.values.reduce((bits, value, index) => (chosen.includes(value) ? bits | (1 << index) : bits), 0)
}

export interface PropertyProblem {
  property: string
  message: string
}

/**
 * Checks one property against its declared type. Returns undefined when the
 * property is fine or declares no type at all.
 */
export function checkProperty(property: Property, registry: PropertyTypeRegistry): PropertyProblem | undefined {
  const type = registry.get(property.propertytype)
  if (!type) {
    if (property.propertytype) {
      return { property: property.name, message: `nieznany typ „${property.propertytype}"` }
    }
    return undefined
  }

  if (type.kind === 'enum') {
    if (type.valuesAsFlags) {
      const bits = Number(property.value) || 0
      const allowed = (1 << type.values.length) - 1
      if ((bits & ~allowed) !== 0) {
        return { property: property.name, message: `wartość ${bits} zawiera bity spoza typu „${type.name}"` }
      }
      return undefined
    }
    if (type.storageType === 'int') {
      const index = Number(property.value)
      if (!Number.isInteger(index) || index < 0 || index >= type.values.length) {
        return { property: property.name, message: `${String(property.value)} jest poza zakresem typu „${type.name}"` }
      }
      return undefined
    }
    if (!type.values.includes(String(property.value))) {
      return {
        property: property.name,
        message: `„${String(property.value)}" nie należy do typu „${type.name}" (${type.values.join(', ')})`,
      }
    }
    return undefined
  }

  if (property.type !== 'class') {
    return { property: property.name, message: `typ „${type.name}" jest klasą, a property ma typ ${property.type}` }
  }
  const value = (property.value ?? {}) as Record<string, unknown>
  const known = new Set(type.members.map((member) => member.name))
  const unknown = Object.keys(value).filter((key) => !known.has(key))
  if (unknown.length > 0) {
    return { property: property.name, message: `pola spoza klasy „${type.name}": ${unknown.join(', ')}` }
  }
  return undefined
}

/** A blank value for a property of this type, used when one is first assigned. */
export function defaultValueFor(type: PropertyTypeDef): unknown {
  if (type.kind === 'enum') {
    if (type.valuesAsFlags) return 0
    return type.storageType === 'int' ? 0 : (type.values[0] ?? '')
  }
  const value: Record<string, unknown> = {}
  for (const member of type.members) value[member.name] = member.value
  return value
}

/** Which scalar type a property carrying this custom type must declare. */
export function storageTypeOf(type: PropertyTypeDef): PropertyType {
  return type.kind === 'class' ? 'class' : type.storageType
}

/* ------------------------------------------------------------------ */
/* A class used as a node's own type                                   */
/* ------------------------------------------------------------------ */

/**
 * Tiled lets a map, layer, object, tile or tileset carry a class as its own
 * type. The class's members then behave as properties of that node, and Tiled
 * omits from the file any member still equal to its default. Reproducing that
 * omission is what keeps files small and diffs honest: a saved map records the
 * decisions somebody made, not the ones they left alone.
 */
export function classFor(
  className: string | undefined,
  registry: PropertyTypeRegistry,
  target: PropertyTypeTarget,
): ClassPropertyType | undefined {
  if (!className) return undefined
  const type = registry.get(className)
  if (type?.kind !== 'class') return undefined
  return type.useAs.includes(target) ? type : undefined
}

export interface ClassMemberState {
  member: ClassMember
  value: unknown
  /** True when the node declares this member itself instead of inheriting it. */
  overridden: boolean
}

export function classMemberStates(type: ClassPropertyType, properties: Property[]): ClassMemberState[] {
  return type.members.map((member) => {
    const declared = properties.find((property) => property.name === member.name)
    return {
      member,
      value: declared ? declared.value : member.value,
      overridden: declared !== undefined,
    }
  })
}

/** Deep enough for the values a property can hold: scalars and flat objects. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) if (!sameValue(left[key], right[key])) return false
  return true
}

/**
 * Sets one class member on a node. A value back at the class default removes
 * the property entirely, which is exactly what Tiled writes.
 */
export function setClassMember(properties: Property[], member: ClassMember, value: unknown): Property[] {
  const rest = properties.filter((property) => property.name !== member.name)
  if (sameValue(value, member.value)) return rest
  return [
    ...rest,
    {
      name: member.name,
      type: member.type,
      propertytype: member.propertyType,
      value,
    },
  ]
}

/** Properties that are not part of the node's class, so still shown separately. */
export function propertiesOutsideClass(properties: Property[], type: ClassPropertyType | undefined): Property[] {
  if (!type) return properties
  const members = new Set(type.members.map((member) => member.name))
  return properties.filter((property) => !members.has(property.name))
}
