import { DRAFTS, idb } from './idb'

/**
 * Unsaved work, parked in the browser.
 *
 * The editor's target is a tablet running the server in Termux, and Android
 * kills background processes without warning. `beforeunload` does nothing about
 * that - it is not a tab closing. So every edit is mirrored into IndexedDB a
 * couple of seconds later, as exactly the text a save would have written, and
 * offered back the next time the project opens.
 *
 * Nothing here ever writes to the project. Restoring puts the draft back into
 * the editor as unsaved changes; committing them stays the user's Ctrl+S.
 */

export const draftKey = (root: string, path: string): string => `${root}::${path}`

export interface Draft {
  /** Project root and map path together, so two folders never collide. */
  key: string
  root: string
  path: string
  /** What a save would write right now. */
  text: string
  /** What the file held when the map was opened, to spot edits made elsewhere. */
  baseText: string
  /** Tilesets edited alongside the map, in the same shape. */
  tilesets: { path: string; text: string }[]
  savedAt: number
}

export async function putDraft(draft: Draft): Promise<void> {
  await idb(DRAFTS, 'readwrite', (store) => store.put(draft) as IDBRequest<IDBValidKey>)
}

export async function dropDraft(key: string): Promise<void> {
  await idb(DRAFTS, 'readwrite', (store) => store.delete(key) as unknown as IDBRequest<undefined>)
}

/** Every draft belonging to one project, newest first. */
export async function listDrafts(root: string): Promise<Draft[]> {
  const all = (await idb(DRAFTS, 'readonly', (store) => store.getAll() as IDBRequest<Draft[]>)) ?? []
  return all.filter((draft) => draft.root === root).sort((a, b) => b.savedAt - a.savedAt)
}

/** Polish, and rounded: a draft from 90 seconds ago is "sprzed 2 minut". */
export function timeAgo(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 45) return 'przed chwilą'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return minutes === 1 ? 'sprzed minuty' : `sprzed ${minutes} ${plural(minutes, 'minuty', 'minut')}`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours === 1 ? 'sprzed godziny' : `sprzed ${hours} ${plural(hours, 'godziny', 'godzin')}`
  const days = Math.round(hours / 24)
  return days === 1 ? 'sprzed dnia' : `sprzed ${days} dni`
}

/** Polish counts take one form for 2-4 and another from 5 up, teens excepted. */
function plural(n: number, few: string, many: string): string {
  const last = n % 10
  const teens = n % 100 >= 12 && n % 100 <= 14
  return !teens && last >= 2 && last <= 4 ? few : many
}
