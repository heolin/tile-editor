import type { Preserving, Property, PropertyType } from '../model.js'

/**
 * Per-file formatting quirks detected on read and restored on write, so that
 * saving an untouched file leaves the smallest possible diff.
 */
export interface FormatHints {
  /** Which serialiser wrote this file; a save keeps it in the same dialect. */
  dialect: 'tiled' | 'plain'
  rootBraceInline: boolean
  trailingNewline: boolean
}

/**
 * Tiled writes `"key":value`; plain serialisers write `"key": value`. That one
 * character is the most reliable separator between the two dialects, and every
 * other formatting difference follows from it.
 */
export function detectHints(text: string): FormatHints {
  const spaced = text.match(/":[ ]/g)?.length ?? 0
  const tight = text.match(/":[^ \n]/g)?.length ?? 0
  return {
    dialect: spaced > tight ? 'plain' : 'tiled',
    rootBraceInline: !/^\{\s*\n/.test(text),
    trailingNewline: text.endsWith('\n'),
  }
}

export const DEFAULT_HINTS: FormatHints = { dialect: 'tiled', rootBraceInline: true, trailingNewline: false }

/**
 * Project files are always written in the plain dialect, but Tiled versions
 * disagree on how far to indent and whether an empty array takes two lines.
 * Both are measured from the file rather than assumed.
 */
export interface ProjectFormatHints {
  indent: number
  breakEmptyArrays: boolean
  trailingNewline: boolean
}

export const DEFAULT_PROJECT_HINTS: ProjectFormatHints = {
  indent: 1,
  breakEmptyArrays: false,
  trailingNewline: true,
}

export function detectProjectHints(text: string): ProjectFormatHints {
  const firstMember = /\n(\s*)"/.exec(text)
  return {
    indent: firstMember?.[1]?.length ?? 1,
    breakEmptyArrays: /\[\s*\n\s*\]/.test(text),
    trailingNewline: text.endsWith('\n'),
  }
}

/**
 * Splits a source object into the keys the model understands and the rest,
 * remembering the order so a save can put everything back where it was.
 */
export function takePreserved(src: Record<string, unknown>, known: readonly string[]): Preserving {
  const extra: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(src)) {
    if (!known.includes(k)) extra[k] = v
  }
  const result: Preserving = { keyOrder: Object.keys(src) }
  if (Object.keys(extra).length > 0) result.extra = extra
  return result
}

/**
 * Rebuilds an output object: keys the source had keep their original position,
 * anything new is appended in alphabetical order.
 */
export function emitOrdered(node: Preserving, known: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...known }
  for (const [k, v] of Object.entries(node.extra ?? {})) {
    if (!(k in merged)) merged[k] = v
  }
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

const PROPERTY_KEYS = ['name', 'type', 'value', 'propertytype'] as const

export function parseProperties(raw: unknown): Property[] {
  if (!Array.isArray(raw)) return []
  return raw.map((entry) => {
    const src = entry as Record<string, unknown>
    return {
      name: String(src.name ?? ''),
      type: (src.type as PropertyType) ?? 'string',
      value: src.value,
      propertytype: src.propertytype as string | undefined,
      ...takePreserved(src, PROPERTY_KEYS),
    }
  })
}

export function emitProperties(props: Property[]): Record<string, unknown>[] | undefined {
  if (props.length === 0) return undefined
  return props.map((p) =>
    emitOrdered(p, {
      name: p.name,
      type: p.type,
      value: p.value,
      propertytype: p.propertytype,
    }),
  )
}

export const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback)
export const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
export const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
