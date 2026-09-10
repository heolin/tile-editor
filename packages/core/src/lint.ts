import { tileId } from './gid.js'
import { allObjects, tilesetForGid, walkLayers, type Property, type PropertyType, type TileMap, type Tileset } from './model.js'
import { checkProperty, type PropertyTypeRegistry, type PropertyTypeTarget } from './property-types.js'

/**
 * Rules derived from real defects found in examples/ (docs/PLAN.md section 5.2):
 * a property used with two different types, properties missing from some maps
 * but not others, tile ids that no tileset covers, and tiles nothing uses.
 */
export type LintSeverity = 'error' | 'warning' | 'info'

export interface LintFinding {
  rule: string
  severity: LintSeverity
  message: string
  mapPath?: string
  layerId?: number
  objectId?: number
  tileId?: number
  /** Present when the editor can repair the finding on its own. */
  fix?: LintFix
}

/**
 * A repair the editor knows how to apply across the whole project. Only
 * findings whose correct outcome is unambiguous carry one.
 */
export type LintFix = {
  kind: 'normalize-property-type'
  scope: PropertyScope
  property: string
  /** The type the majority of uses already agree on. */
  to: PropertyType
  /** How many properties would change. */
  count: number
}

export type PropertyScope = 'map' | 'layer' | 'object'

export interface LintTarget {
  path: string
  map: TileMap
}

export interface LintContext {
  /** Tilesets already resolved, keyed by the path the map refers to them by. */
  tilesets?: Map<string, Tileset>
  /** Custom types from the project, when it declares any. */
  registry?: PropertyTypeRegistry
}

const scope = (props: Property[]) => new Map(props.map((p) => [p.name, p.type]))

/* ------------------------------------------------------------------ */

/** Checks one map in isolation. */
export function lintMap(target: LintTarget, ctx: LintContext = {}): LintFinding[] {
  const { path, map } = target
  const findings: LintFinding[] = []

  for (const layer of walkLayers(map.layers)) {
    if (layer.kind !== 'tilelayer') continue
    const seen = new Set<number>()
    layer.data.forEach((x, y, gid) => {
      const id = tileId(gid)
      if (seen.has(id)) return
      seen.add(id)
      if (!tilesetForGid(map, gid)) {
        findings.push({
          rule: 'gid-out-of-range',
          severity: 'error',
          message: `Kafel ${id} na warstwie „${layer.name}" (${x}, ${y}) nie należy do żadnego tilesetu tej mapy.`,
          mapPath: path,
          layerId: layer.id,
          tileId: id,
        })
      }
    })
  }

  for (const layer of walkLayers(map.layers)) {
    if (layer.kind !== 'objectgroup') continue
    for (const obj of layer.objects) {
      if (obj.gid !== undefined && !tilesetForGid(map, obj.gid)) {
        findings.push({
          rule: 'gid-out-of-range',
          severity: 'error',
          message: `Obiekt #${obj.id} na warstwie „${layer.name}" wskazuje kafel ${tileId(obj.gid)} spoza tilesetów mapy.`,
          mapPath: path,
          layerId: layer.id,
          objectId: obj.id,
        })
      }
      const px = map.width * map.tilewidth
      const py = map.height * map.tileheight
      if (obj.x < 0 || obj.y < 0 || obj.x > px || obj.y > py) {
        findings.push({
          rule: 'object-out-of-bounds',
          severity: 'warning',
          message: `Obiekt #${obj.id} leży poza granicami mapy (${obj.x}, ${obj.y}).`,
          mapPath: path,
          layerId: layer.id,
          objectId: obj.id,
        })
      }
    }
  }

  // A property that names a custom type has to agree with it. This is the rule
  // that would have caught railId being an int in one map and a string in
  // another, at the moment of typing rather than months later.
  if (ctx.registry && !ctx.registry.isEmpty) {
    const report = (props: Property[], where: string, layerId?: number, objectId?: number) => {
      for (const property of props) {
        const problem = checkProperty(property, ctx.registry!)
        if (!problem) continue
        findings.push({
          rule: 'property-type-mismatch',
          severity: 'error',
          message: `${where}: property „${problem.property}" ${problem.message}.`,
          mapPath: path,
          layerId,
          objectId,
        })
      }
    }
    // A node may also carry a class as its own type; naming one the project
    // never declared is the same mistake at a different level.
    const reportClass = (className: string | undefined, target: PropertyTypeTarget, where: string, layerId?: number, objectId?: number) => {
      if (!className) return
      const type = ctx.registry!.get(className)
      if (!type) {
        findings.push({
          rule: 'unknown-class',
          severity: 'warning',
          message: `${where}: klasa „${className}" nie jest zadeklarowana w projekcie.`,
          mapPath: path, layerId, objectId,
        })
        return
      }
      if (type.kind !== 'class') {
        findings.push({
          rule: 'unknown-class',
          severity: 'error',
          message: `${where}: „${className}" jest enumem, a nie klasą.`,
          mapPath: path, layerId, objectId,
        })
        return
      }
      if (!type.useAs.includes(target)) {
        findings.push({
          rule: 'unknown-class',
          severity: 'warning',
          message: `${where}: klasa „${className}" nie jest przeznaczona dla tego węzła (useAs: ${type.useAs.join(', ')}).`,
          mapPath: path, layerId, objectId,
        })
      }
    }

    report(map.properties, 'Mapa')
    reportClass(map.className, 'map', 'Mapa')
    for (const layer of walkLayers(map.layers)) {
      report(layer.properties, `Warstwa „${layer.name}"`, layer.id)
      reportClass(layer.className, 'layer', `Warstwa „${layer.name}"`, layer.id)
      if (layer.kind !== 'objectgroup') continue
      for (const obj of layer.objects) {
        report(obj.properties, `Obiekt #${obj.id}`, layer.id, obj.id)
        reportClass(obj.className || undefined, 'object', `Obiekt #${obj.id}`, layer.id, obj.id)
      }
    }
  }

  const names = new Set<string>()
  for (const layer of walkLayers(map.layers)) {
    if (names.has(layer.name)) {
      findings.push({
        rule: 'duplicate-layer-name',
        severity: 'info',
        message: `Więcej niż jedna warstwa nazywa się „${layer.name}".`,
        mapPath: path,
        layerId: layer.id,
      })
    }
    names.add(layer.name)
  }

  return findings
}

/* ------------------------------------------------------------------ */

/**
 * Checks the whole project, where the interesting defects live: a property
 * name used with two types, or present in most maps but not all.
 */
/**
 * Looks at how a property name is actually used across the project and, when
 * the values form a small closed set, proposes an enum for it. This is how a
 * project that has been running on loose strings for months gets types without
 * anyone writing them out by hand.
 */
export interface TypeSuggestion {
  /** Where the property lives: on maps or on objects. */
  scope: 'map' | 'object'
  property: string
  values: string[]
  /** How many properties carry one of these values. */
  occurrences: number
}

export function suggestEnums(targets: LintTarget[], options: { maxValues?: number; minOccurrences?: number } = {}): TypeSuggestion[] {
  const maxValues = options.maxValues ?? 8
  const minOccurrences = options.minOccurrences ?? 4
  const seen = new Map<string, { values: Map<string, number>; scope: 'map' | 'object'; typed: boolean }>()

  const record = (scope: 'map' | 'object', property: Property) => {
    // Numeric and boolean properties are already well typed; enums are for the
    // string properties standing in for a closed set of choices.
    if (property.type !== 'string' || property.propertytype) return
    const text = String(property.value ?? '')
    if (text === '' || text.length > 40) return
    const key = `${scope}.${property.name}`
    const entry = seen.get(key) ?? { values: new Map(), scope, typed: false }
    entry.values.set(text, (entry.values.get(text) ?? 0) + 1)
    seen.set(key, entry)
  }

  for (const { map } of targets) {
    for (const property of map.properties) record('map', property)
    for (const object of allObjects(map)) {
      for (const property of object.properties) record('object', property)
    }
  }

  const out: TypeSuggestion[] = []
  for (const [key, entry] of seen) {
    const occurrences = [...entry.values.values()].reduce((sum, n) => sum + n, 0)
    if (entry.values.size < 2 || entry.values.size > maxValues || occurrences < minOccurrences) continue
    // A set worth naming repeats: values seen once each are free-form text.
    if (occurrences < entry.values.size * 2) continue
    // Values that are all numbers are a number written as text, not a set of
    // choices. Proposing an enum there would cement the mistake instead of
    // surfacing it - and `conflicting-property-type` already reports it.
    if ([...entry.values.keys()].every((value) => value.trim() !== '' && Number.isFinite(Number(value)))) continue
    out.push({
      scope: entry.scope,
      property: key.split('.').slice(1).join('.'),
      values: [...entry.values.keys()].sort(),
      occurrences,
    })
  }
  return out.sort((a, b) => b.occurrences - a.occurrences)
}

export function lintProject(targets: LintTarget[], ctx: LintContext = {}): LintFinding[] {
  const findings: LintFinding[] = targets.flatMap((t) => lintMap(t, ctx))
  if (targets.length === 0) return findings

  // A property name should mean one type everywhere it appears.
  const kinds = new Map<string, Map<string, { count: number; where: string[] }>>()
  const record = (name: string, type: string, where: string) => {
    const byType = kinds.get(name) ?? new Map()
    kinds.set(name, byType)
    const entry = byType.get(type) ?? { count: 0, where: [] }
    entry.count++
    if (entry.where.length < 4 && !entry.where.includes(where)) entry.where.push(where)
    byType.set(type, entry)
  }
  for (const { path, map } of targets) {
    for (const p of map.properties) record(`map.${p.name}`, p.type, path)
    for (const layer of walkLayers(map.layers)) {
      for (const p of layer.properties) record(`layer.${p.name}`, p.type, path)
    }
    for (const obj of allObjects(map)) {
      for (const p of obj.properties) record(`object.${p.name}`, p.type, path)
    }
  }
  for (const [name, byType] of kinds) {
    if (byType.size < 2) continue
    const ranked = [...byType.entries()].sort((a, b) => b[1].count - a[1].count)
    const summary = ranked.map(([type, e]) => `${type} ×${e.count}`).join(', ')
    const [scope, ...rest] = name.split('.')
    const property = rest.join('.')
    const [dominant] = ranked
    const minority = ranked.slice(1).reduce((sum, [, entry]) => sum + entry.count, 0)
    findings.push({
      rule: 'conflicting-property-type',
      severity: 'error',
      message: `Property „${property}" występuje w dwóch typach: ${summary}.`,
      // Repairable only when one type clearly wins; a tie is a decision for a
      // person, not for a majority vote.
      fix:
        dominant && ranked[1] && dominant[1].count > ranked[1][1].count
          ? {
              kind: 'normalize-property-type',
              scope: scope as PropertyScope,
              property,
              to: dominant[0] as PropertyType,
              count: minority,
            }
          : undefined,
    })
  }

  // A map-level property present in most maps but absent from a few is usually
  // an oversight rather than a decision.
  const mapPropCount = new Map<string, number>()
  for (const { map } of targets) {
    for (const name of new Set(map.properties.map((p) => p.name))) {
      mapPropCount.set(name, (mapPropCount.get(name) ?? 0) + 1)
    }
  }
  for (const [name, count] of mapPropCount) {
    if (count === targets.length || count < targets.length * 0.6) continue
    const missing = targets.filter((t) => !t.map.properties.some((p) => p.name === name)).map((t) => t.path)
    findings.push({
      rule: 'inconsistent-map-property',
      severity: 'warning',
      message: `Property mapy „${name}" jest w ${count} z ${targets.length} map, brakuje w: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` (+${missing.length - 5})` : ''}.`,
    })
  }

  return findings
}

/** Reports tiles that no map in the project places. */
export function lintUnusedTiles(targets: LintTarget[], tilesets: Map<string, Tileset>): LintFinding[] {
  const used = new Set<string>()
  for (const { map } of targets) {
    const mark = (gid: number) => {
      const ref = tilesetForGid(map, gid)
      if (ref?.source) used.add(`${ref.source}#${tileId(gid) - ref.firstgid}`)
    }
    for (const layer of walkLayers(map.layers)) {
      if (layer.kind === 'tilelayer') layer.data.forEach((_x, _y, gid) => mark(gid))
      else if (layer.kind === 'objectgroup') {
        for (const o of layer.objects) if (o.gid !== undefined) mark(o.gid)
      }
    }
  }

  const findings: LintFinding[] = []
  for (const [source, tileset] of tilesets) {
    const unused = tileset.tiles.filter((t) => !used.has(`${source}#${t.id}`)).map((t) => t.id)
    if (unused.length === 0) continue
    findings.push({
      rule: 'unused-tile',
      severity: 'info',
      message: `Tileset „${tileset.name}": ${unused.length} z ${tileset.tiles.length} kafli nie jest używanych w żadnej mapie (${unused.slice(0, 8).join(', ')}${unused.length > 8 ? '…' : ''}).`,
    })
  }
  return findings
}

/**
 * Converts a value to a different property type without losing what it meant.
 * A number written as text becomes that number; anything genuinely unparseable
 * is left alone so the repair cannot quietly destroy data.
 */
export function coercePropertyValue(value: unknown, to: PropertyType): unknown {
  switch (to) {
    case 'int': {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? Math.trunc(parsed) : value
    }
    case 'float': {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : value
    }
    case 'bool':
      if (typeof value === 'boolean') return value
      if (value === 'true' || value === 1) return true
      if (value === 'false' || value === 0) return false
      return value
    case 'string':
      return value === undefined || value === null ? '' : String(value)
    default:
      return value
  }
}

export interface PropertyIndexEntry {
  scope: PropertyScope
  name: string
  /** The type most uses agree on. */
  type: PropertyType
  count: number
  /** Set when the project uses this name with more than one type. */
  conflicting?: boolean
}

/**
 * What property names the project already uses, and with what type. The editor
 * offers these when a new property is added: a name typed afresh gets whatever
 * type the editor happened to be in, which is exactly how `railId` ended up an
 * int in 56 objects and a string in 18.
 */
export function indexProperties(targets: LintTarget[]): PropertyIndexEntry[] {
  const seen = new Map<string, { scope: PropertyScope; name: string; types: Map<PropertyType, number> }>()
  const record = (scope: PropertyScope, property: Property) => {
    const key = `${scope}.${property.name}`
    const entry = seen.get(key) ?? { scope, name: property.name, types: new Map() }
    entry.types.set(property.type, (entry.types.get(property.type) ?? 0) + 1)
    seen.set(key, entry)
  }

  for (const { map } of targets) {
    for (const property of map.properties) record('map', property)
    for (const layer of walkLayers(map.layers)) {
      for (const property of layer.properties) record('layer', property)
    }
    for (const object of allObjects(map)) {
      for (const property of object.properties) record('object', property)
    }
  }

  return [...seen.values()]
    .map((entry) => {
      const ranked = [...entry.types.entries()].sort((a, b) => b[1] - a[1])
      return {
        scope: entry.scope,
        name: entry.name,
        type: ranked[0]![0],
        count: ranked.reduce((sum, [, n]) => sum + n, 0),
        conflicting: ranked.length > 1 ? true : undefined,
      }
    })
    .sort((a, b) => b.count - a.count)
}

/** Applies a repair to one map. Returns how many properties changed. */
export function applyFix(map: TileMap, fix: LintFix): number {
  if (fix.kind !== 'normalize-property-type') return 0
  const lists: Property[][] =
    fix.scope === 'map'
      ? [map.properties]
      : fix.scope === 'layer'
        ? [...walkLayers(map.layers)].map((layer) => layer.properties)
        : allObjects(map).map((object) => object.properties)

  let changed = 0
  for (const list of lists) {
    for (const property of list) {
      if (property.name !== fix.property || property.type === fix.to) continue
      const next = coercePropertyValue(property.value, fix.to)
      // Refuse to change a value the conversion could not make sense of.
      if (fix.to !== 'string' && typeof next !== typeof (fix.to === 'bool' ? true : 0)) continue
      property.type = fix.to
      property.value = next
      changed++
    }
  }
  return changed
}

export function summarize(findings: LintFinding[]): Record<LintSeverity, number> {
  return {
    error: findings.filter((f) => f.severity === 'error').length,
    warning: findings.filter((f) => f.severity === 'warning').length,
    info: findings.filter((f) => f.severity === 'info').length,
  }
}
