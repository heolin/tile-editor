import { XMLParser } from 'fast-xml-parser'
import type { XmlElement } from './writer.js'

/**
 * Thin navigation layer over fast-xml-parser's order-preserving output. Order
 * matters in TMX: layers, object groups and groups interleave freely, and a map
 * that reorders them on save is a map that produces noisy diffs.
 */
export interface XNode {
  tag: string
  attrs: Record<string, string>
  children: XNode[]
  text: string
}

const ATTRS_KEY = ':@'
const TEXT_KEY = '#text'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  attributesGroupName: ATTRS_KEY,
  preserveOrder: true,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
  commentPropName: '#comment',
})

function convert(raw: Record<string, unknown>): XNode | undefined {
  const tag = Object.keys(raw).find((key) => key !== ATTRS_KEY)
  if (tag === undefined || tag === TEXT_KEY || tag === '#comment') return undefined
  const body = raw[tag]
  const children: XNode[] = []
  let text = ''
  if (Array.isArray(body)) {
    for (const entry of body as Record<string, unknown>[]) {
      if (TEXT_KEY in entry) {
        text += String(entry[TEXT_KEY] ?? '')
        continue
      }
      const child = convert(entry)
      if (child) children.push(child)
    }
  }
  return {
    tag,
    attrs: (raw[ATTRS_KEY] as Record<string, string>) ?? {},
    children,
    text,
  }
}

export function parseXml(text: string): XNode {
  const parsed = parser.parse(text) as Record<string, unknown>[]
  for (const entry of parsed) {
    const node = convert(entry)
    if (node) return node
  }
  throw new Error('Plik nie zawiera żadnego elementu XML')
}

export const childrenNamed = (node: XNode, tag: string): XNode[] =>
  node.children.filter((child) => child.tag === tag)

export const childNamed = (node: XNode, tag: string): XNode | undefined =>
  node.children.find((child) => child.tag === tag)

export function attrNum(node: XNode, name: string, fallback = 0): number {
  const raw = node.attrs[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

export function attrBool(node: XNode, name: string, fallback: boolean): boolean {
  const raw = node.attrs[name]
  if (raw === undefined || raw === '') return fallback
  return raw !== '0' && raw !== 'false'
}

export function attrStr(node: XNode, name: string, fallback = ''): string {
  return node.attrs[name] ?? fallback
}

/** Turns a parsed node back into something the writer can emit verbatim. */
export function toElement(node: XNode): XmlElement {
  return {
    tag: node.tag,
    attrs: { ...node.attrs },
    children: node.children.map(toElement),
    text: node.children.length === 0 && node.text.trim() !== '' ? node.text.trim() : undefined,
    textLayout: 'indented',
  }
}

/**
 * Child elements the model does not understand - wangsets, terrain types, a
 * tileset's grid - kept exactly as they came in. Without this, opening and
 * saving a file would quietly delete parts of it that this editor never touched.
 */
export function unknownChildren(node: XNode, known: readonly string[]): XmlElement[] | undefined {
  const rest = node.children.filter((child) => !known.includes(child.tag))
  return rest.length > 0 ? rest.map(toElement) : undefined
}

/** Attributes the model does not name explicitly, kept so a save loses nothing. */
export function extraAttrs(node: XNode, known: readonly string[]): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(node.attrs)) {
    if (!known.includes(name)) extra[name] = value
  }
  return Object.keys(extra).length > 0 ? extra : undefined
}
