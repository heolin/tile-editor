/**
 * Adding the editor to a home screen.
 *
 * Chrome decides when a page may be installed and says so once, through
 * `beforeinstallprompt`, often before this bundle has even parsed. index.html
 * catches that event and parks it; everything here reads what it left.
 *
 * Where it does not work, and why, matters as much as where it does: Safari and
 * Firefox never fire the event, an installed copy is not offered again, and a
 * page served over plain HTTP to a LAN address is not a secure context, so it
 * has no service worker and cannot be installed at all. Each of those gets its
 * own answer rather than a button that quietly does nothing.
 */
export type InstallOutcome = 'accepted' | 'dismissed' | 'already' | 'native' | 'insecure' | 'unsupported'

interface DeferredPrompt extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const deferred = (): DeferredPrompt | null =>
  (window as unknown as { __tileEditorInstall?: DeferredPrompt | null }).__tileEditorInstall ?? null

/** True inside the Capacitor shell, which is already an installed app. */
export function isNativeShell(): boolean {
  return 'Capacitor' in window
}

/** True when the page is already running from a home-screen icon. */
export function isStandalone(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  // iOS reports it here instead.
  return (window.navigator as unknown as { standalone?: boolean }).standalone === true
}

export function canInstall(): boolean {
  return !isNativeShell() && !isStandalone() && deferred() !== null
}

/** Fires whenever the answer to `canInstall()` may have changed. */
export function onInstallabilityChange(listener: () => void): () => void {
  window.addEventListener('tile-editor:installable', listener)
  return () => window.removeEventListener('tile-editor:installable', listener)
}

export async function promptInstall(): Promise<InstallOutcome> {
  if (isNativeShell()) return 'native'
  if (isStandalone()) return 'already'
  const event = deferred()
  if (!event) return window.isSecureContext ? 'unsupported' : 'insecure'

  await event.prompt()
  const { outcome } = await event.userChoice
  // The browser will not hand the same event over twice.
  ;(window as unknown as { __tileEditorInstall: DeferredPrompt | null }).__tileEditorInstall = null
  window.dispatchEvent(new Event('tile-editor:installable'))
  return outcome
}

/** What to tell the user for an outcome that did not install anything. */
export const INSTALL_MESSAGES: Record<Exclude<InstallOutcome, 'accepted'>, string> = {
  dismissed: 'Anulowano dodawanie skrótu.',
  already: 'Edytor już działa jako zainstalowana aplikacja.',
  native: 'To jest aplikacja natywna — skrót masz już na ekranie.',
  insecure:
    'Instalacja wymaga bezpiecznego połączenia. Otwórz edytor pod 127.0.0.1 zamiast adresu sieciowego.',
  unsupported:
    'Ta przeglądarka nie oferuje instalacji. Działa w Chrome i Edge; w Safari użyj Udostępnij → Do ekranu początkowego.',
}
