import { allObjects, walkLayers, type Property, type PropertyType, type TileMap, type Tileset } from './model.js'
import type { PropertyScope } from './lint.js'

/**
 * Project-wide property surgery. All of these games' semantics live in
 * properties, spread over 115 files that share nothing but a convention, so
 * renaming one is an operation on the project rather than on a document - the
 * thing you would otherwise do with `sed` and hope (docs/PLAN.md section 5.1).
 */
export interface PropertyChange {
  scope: PropertyScope
  /** The property being changed, by name. */
  name: string
  /** New name, when renaming. */
  rename?: string
  /** New storage type, when retyping. Values are coerced, not reinterpreted. */
  retype?: PropertyType
  /** Remove it entirely. Wins over the other two. */
  remove?: boolean
}

/** Whether a change would do anything at all. */
export function isEmptyChange(change: PropertyChange): boolean {
  if (change.remove) return false
  const renames = change.rename !== undefined && change.rename !== '' && change.rename !== change.name
  return !renames && change.retype === undefined
}

/** Every property list a scope covers within one map. */
function listsInMap(map: TileMap, scope: PropertyScope): Property[][] {
  switch (scope) {
    case 'map':
      return [map.properties]
    case 'layer':
      return [...walkLayers(map.layers)].map((layer) => layer.properties)
    case 'object':
      return [...allObjects(map)].map((object) => object.properties)
    default:
      return []
  }
}

function listsInTileset(tileset: Tileset, scope: PropertyScope): Property[][] {
  return scope === 'tile' ? tileset.tiles.map((tile) => tile.properties) : []
}

/** How many properties a change would touch, without touching any. */
export function countInMap(map: TileMap, change: PropertyChange): number {
  return listsInMap(map, change.scope).reduce(
    (sum, list) => sum + list.filter((property) => property.name === change.name).length,
    0,
  )
}

export function countInTileset(tileset: Tileset, change: PropertyChange): number {
  return listsInTileset(tileset, change.scope).reduce(
    (sum, list) => sum + list.filter((property) => property.name === change.name).length,
    0,
  )
}

/** Applies the change in place. Returns how many properties moved. */
export function applyInMap(map: TileMap, change: PropertyChange): number {
  return applyToLists(listsInMap(map, change.scope), change)
}

export function applyInTileset(tileset: Tileset, change: PropertyChange): number {
  return applyToLists(listsInTileset(tileset, change.scope), change)
}

function applyToLists(lists: Property[][], change: PropertyChange): number {
  let touched = 0
  for (const list of lists) {
    for (let i = list.length - 1; i >= 0; i--) {
      const property = list[i]!
      if (property.name !== change.name) continue
      touched++
      if (change.remove) {
        list.splice(i, 1)
        continue
      }
      if (change.rename !== undefined && change.rename !== '') property.name = change.rename
      if (change.retype !== undefined && change.retype !== property.type) {
        property.value = coerceValue(property.value, change.retype)
        property.type = change.retype
        // A declared type belongs to the old storage type; keeping it would
        // point at a definition that no longer describes the value.
        property.propertytype = undefined
      }
    }
  }
  return touched
}

/**
 * Reads a value as the new type. Deliberately conservative: anything that does
 * not convert cleanly becomes the type's empty value rather than a guess, so a
 * bad conversion looks wrong instead of looking plausible.
 */
export function coerceValue(value: unknown, type: PropertyType): unknown {
  const text = value === undefined || value === null ? '' : String(value)
  switch (type) {
    case 'int': {
      const n = Number.parseInt(text, 10)
      return Number.isFinite(n) ? n : 0
    }
    case 'float': {
      const n = Number.parseFloat(text)
      return Number.isFinite(n) ? n : 0
    }
    case 'bool':
      return text === 'true' || text === '1' || value === true
    case 'color':
      return /^#[0-9a-fA-F]{6,8}$/.test(text) ? text : ''
    default:
      return text
  }
}
