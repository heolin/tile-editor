/**
 * Tiled writes JSON in a format no standard serialiser reproduces: keys are
 * separated from values by a bare colon, forward slashes are escaped, object
 * members are indented one space past their container, array elements seven,
 * and tile data wraps at the layer width. The rules below were derived by
 * measuring the corpus in examples/ rather than from any specification.
 *
 * The goal is not byte-equality with arbitrary input - the corpus is not even
 * internally consistent - but a canonical form that is stable: writing a
 * document twice produces identical bytes. See docs/PLAN.md section 5.5.
 */

/** Marks a number array that should wrap at a fixed column count. */
export class WrappedNumbers {
  constructor(readonly values: readonly number[], readonly columns: number) {}
}

export interface JsonStyle {
  /** Separator between a key and its value. */
  colon: string
  /** Spaces added to a container's indent for its object members. */
  objectIndent: number
  /** Spaces added to a key's indent for its array elements. */
  arrayIndent: number
  /** Emitted between array elements, before the newline and indent. */
  arraySeparator: string
  /** Break every array onto multiple lines, even arrays of scalars. */
  arrayBreakAlways: boolean
  /** Put an array's closing bracket on its own line at the key's indent. */
  arrayCloseNewline: boolean
  /** Tiled escapes '/' as '\/'; most other writers do not. */
  escapeSlash: boolean
  /** Tiled puts the first root member on the opening brace's line. */
  rootBraceInline: boolean
  trailingNewline: boolean
}

/** Matches Tiled's own .tmj/.tsx output. */
export const TILED_STYLE: JsonStyle = {
  colon: ':',
  objectIndent: 1,
  arrayIndent: 7,
  arraySeparator: ', ',
  arrayBreakAlways: false,
  arrayCloseNewline: false,
  escapeSlash: true,
  rootBraceInline: true,
  trailingNewline: false,
}

/**
 * The dialect produced by a plain serialiser such as Python's
 * `json.dumps(indent=1)`. Tiled reads it happily, and part of the corpus was
 * written by a level generator rather than by Tiled, so the editor keeps files
 * in whichever dialect it found them.
 */
export const PLAIN_STYLE: JsonStyle = {
  colon: ': ',
  objectIndent: 1,
  arrayIndent: 1,
  arraySeparator: ',',
  arrayBreakAlways: true,
  arrayCloseNewline: true,
  escapeSlash: false,
  rootBraceInline: false,
  trailingNewline: true,
}

/** .tiled-project uses the same plain dialect. */
export const PROJECT_STYLE: JsonStyle = PLAIN_STYLE

const ESCAPES: Record<string, string> = {
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
}

function writeString(value: string, style: JsonStyle): string {
  let out = '"'
  for (const ch of value) {
    const esc = ESCAPES[ch]
    if (esc) out += esc
    else if (ch === '/' && style.escapeSlash) out += '\\/'
    else if (ch < ' ') out += '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')
    else out += ch
  }
  return out + '"'
}

function writeNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (Number.isInteger(value)) return String(value)
  // Tiled emits floats at the shortest round-tripping representation.
  return String(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof WrappedNumbers)
}

function writeValue(value: unknown, indent: number, style: JsonStyle, isRoot: boolean): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return writeNumber(value)
  if (typeof value === 'string') return writeString(value, style)

  if (value instanceof WrappedNumbers) {
    if (value.values.length === 0) return '[]'
    // A dialect that breaks every array ignores the width hint entirely.
    if (style.arrayBreakAlways) return writeValue([...value.values], indent, style, false)
    const cont = ' '.repeat(indent + 3)
    const columns = Math.max(1, value.columns)
    let out = '['
    for (let i = 0; i < value.values.length; i++) {
      if (i > 0) out += i % columns === 0 ? ',\n' + cont : ', '
      out += writeNumber(value.values[i] ?? 0)
    }
    return out + ']'
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const inner = indent + style.arrayIndent
    const pad = ' '.repeat(inner)
    const parts = value.map((item) => writeValue(item, inner, style, false))
    // Arrays of scalars stay on one line; arrays of structures break.
    const structural =
      style.arrayBreakAlways || value.some((v) => isPlainObject(v) || Array.isArray(v) || v instanceof WrappedNumbers)
    if (!structural) return '[' + parts.join(style.arraySeparator) + ']'
    const tail = style.arrayCloseNewline ? '\n' + ' '.repeat(indent) + ']' : ']'
    return '[\n' + pad + parts.join(style.arraySeparator + '\n' + pad) + tail
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined)
    if (keys.length === 0) return '{}'
    const inner = indent + style.objectIndent
    const pad = ' '.repeat(inner)
    const members = keys.map((k) => writeString(k, style) + style.colon + writeValue(value[k], inner, style, false))
    const head = isRoot && style.rootBraceInline ? '{' + ' '.repeat(style.objectIndent) : '{\n' + pad
    return head + members.join(',\n' + pad) + '\n' + ' '.repeat(indent) + '}'
  }

  return 'null'
}

export function writeJson(value: unknown, style: JsonStyle = TILED_STYLE): string {
  return writeValue(value, 0, style, true) + (style.trailingNewline ? '\n' : '')
}
