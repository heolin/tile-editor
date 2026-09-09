/**
 * TMX serialiser. Tiled indents one space per level, keeps every attribute on
 * the element's own line, and lays out tile data differently depending on the
 * encoding: base64 is indented one level past its <data>, while CSV starts at
 * column zero and closes there too. Both shapes were taken from files Tiled
 * itself wrote (examples fetched from the Tiled repository).
 */
export interface XmlElement {
  tag: string
  attrs: Record<string, string | number | boolean | undefined>
  children?: XmlElement[]
  /** Character body; only <data> and <property> bodies use one. */
  text?: string
  /** 'raw' puts the body at column zero, the way Tiled writes CSV. */
  textLayout?: 'indented' | 'raw'
}

const ATTR_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}

export function escapeAttr(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ATTR_ESCAPES[ch]!)
}

export function escapeText(value: string): string {
  return value.replace(/[&<>]/g, (ch) => ATTR_ESCAPES[ch]!)
}

function formatAttr(value: string | number | boolean): string {
  // Tiled writes booleans as 0 and 1, never as words.
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number') return String(value)
  return value
}

function writeElement(element: XmlElement, depth: number, out: string[]): void {
  const pad = ' '.repeat(depth)
  const attrs = Object.entries(element.attrs)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([name, value]) => ` ${name}="${escapeAttr(formatAttr(value!))}"`)
    .join('')

  const children = element.children ?? []
  const hasText = element.text !== undefined && element.text !== ''

  if (children.length === 0 && !hasText) {
    out.push(`${pad}<${element.tag}${attrs}/>`)
    return
  }

  out.push(`${pad}<${element.tag}${attrs}>`)
  if (hasText) {
    if (element.textLayout === 'raw') {
      out.push(element.text!)
      out.push(`</${element.tag}>`)
      return
    }
    for (const line of element.text!.split('\n')) out.push(' '.repeat(depth + 1) + line)
  }
  for (const child of children) writeElement(child, depth + 1, out)
  out.push(`${pad}</${element.tag}>`)
}

export function writeXml(root: XmlElement): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>']
  writeElement(root, 0, out)
  return out.join('\n') + '\n'
}

/** Drops attributes that equal Tiled's default, which Tiled omits entirely. */
export function omitDefaults<T extends Record<string, unknown>>(
  attrs: T,
  defaults: Partial<Record<keyof T, unknown>>,
): T {
  const out = { ...attrs }
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    if (out[key] === defaults[key]) delete out[key]
  }
  return out
}
