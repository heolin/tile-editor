import { tileId } from './gid.js'
import { allObjects, tilesetForGid, walkLayers, type Property, type TileMap, type Tileset } from './model.js'
import { checkProperty, type PropertyTypeRegistry } from './property-types.js'

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
}

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
    report(map.properties, 'Mapa')
    for (const layer of walkLayers(map.layers)) {
      report(layer.properties, `Warstwa „${layer.name}"`, layer.id)
      if (layer.kind !== 'objectgroup') continue
      for (const obj of layer.objects) {
        report(obj.properties, `Obiekt #${obj.id}`, layer.id, obj.id)
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
    const summary = [...byType.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([type, e]) => `${type} ×${e.count}`)
      .join(', ')
    findings.push({
      rule: 'conflicting-property-type',
      severity: 'error',
      message: `Property „${name.split('.').slice(1).join('.')}" występuje w dwóch typach: ${summary}.`,
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

export function summarize(findings: LintFinding[]): Record<LintSeverity, number> {
  return {
    error: findings.filter((f) => f.severity === 'error').length,
    warning: findings.filter((f) => f.severity === 'warning').length,
    info: findings.filter((f) => f.severity === 'info').length,
  }
}
