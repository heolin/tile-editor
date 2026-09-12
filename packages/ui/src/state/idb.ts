/**
 * The browser's own storage, used for two things the editor cannot afford to
 * lose or recompute: unsaved work, and rendered map thumbnails. Both are
 * caches in the sense that the project on disk is the truth - but one of them
 * holds work that is not on disk yet, so failures here are reported, not
 * swallowed silently by the callers that matter.
 */
const DB_NAME = 'tile-editor'
const VERSION = 2

export const DRAFTS = 'drafts'
export const THUMBS = 'thumbs'

let dbPromise: Promise<IDBDatabase | undefined> | undefined

export function openDb(): Promise<IDBDatabase | undefined> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(undefined)
      return
    }
    const request = indexedDB.open(DB_NAME, VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const name of [DRAFTS, THUMBS]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    // Private windows and blocked storage both land here. Losing the safety net
    // is bad; refusing to open the editor over it would be worse.
    request.onerror = () => resolve(undefined)
  })
  return dbPromise
}

export function idb<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) {
          resolve(undefined)
          return
        }
        try {
          const request = fn(db.transaction(store, mode).objectStore(store))
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => resolve(undefined)
        } catch {
          resolve(undefined)
        }
      }),
  )
}
