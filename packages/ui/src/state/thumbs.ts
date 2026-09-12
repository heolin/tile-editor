import { idb, THUMBS } from './idb'

/**
 * Rendered map thumbnails, kept between sessions. Drawing one means fetching
 * and parsing a map, so a project of 115 levels would otherwise pay that price
 * on every reload. The file's own timestamp is part of the key, so a map that
 * changed is simply a cache miss rather than a stale picture.
 */
export interface Thumb {
  key: string
  root: string
  path: string
  dataUrl: string
  madeAt: number
}

export const thumbKey = (root: string, path: string, stamp: number | undefined): string =>
  `${root}::${path}::${stamp ?? 0}`

export function readThumb(key: string): Promise<Thumb | undefined> {
  return idb(THUMBS, 'readonly', (store) => store.get(key) as IDBRequest<Thumb | undefined>)
}

export async function writeThumb(thumb: Thumb): Promise<void> {
  await idb(THUMBS, 'readwrite', (store) => store.put(thumb) as IDBRequest<IDBValidKey>)
}

/**
 * Throws away thumbnails of maps that have since changed. Keys carry the
 * timestamp they were made for, so anything whose prefix matches a live map but
 * whose key does not is by definition out of date.
 */
export async function pruneThumbs(root: string, live: Set<string>): Promise<void> {
  const all = (await idb(THUMBS, 'readonly', (store) => store.getAll() as IDBRequest<Thumb[]>)) ?? []
  for (const thumb of all) {
    if (thumb.root !== root || live.has(thumb.key)) continue
    await idb(THUMBS, 'readwrite', (store) => store.delete(thumb.key) as unknown as IDBRequest<undefined>)
  }
}
