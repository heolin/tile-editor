/**
 * Service worker for the editor shell.
 *
 * Only the application itself is cached. Project files - maps, tilesets, images
 * - are deliberately never cached: they live on disk beside the server and a
 * stale copy would be worse than an error.
 *
 * The shell is fetched during `install` rather than opportunistically while
 * browsing. The navigation that registers a worker is not controlled by it, so
 * waiting for a request to pass through means the very page people reload is
 * the one never stored - offline then fails on the first try, every time.
 */
const CACHE = 'tile-editor-shell-v2'

/** Requests that must always go to the network. */
function isProjectData(url) {
  return url.pathname.startsWith('/api/') || url.pathname.startsWith('/assets/')
}

/** The build emits content-hashed files under /app, so they never go stale. */
function isImmutable(url) {
  return url.pathname.startsWith('/app/') || /^\/icon-[\w-]+\.png$/.test(url.pathname)
}

/**
 * Works out what the shell is made of by reading the page itself. The bundle
 * names carry a content hash, so they cannot be listed here ahead of time, and
 * asking the build to write a manifest would put the two out of step the first
 * time someone forgot.
 */
async function shellUrls() {
  const urls = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png']
  try {
    const response = await fetch('/', { cache: 'reload' })
    if (!response.ok) return urls
    const html = await response.text()
    for (const match of html.matchAll(/(?:src|href)="(\/app\/[^"]+)"/g)) {
      urls.push(match[1])
    }
  } catch (error) {
    // Installing with no network still leaves a worker in place for later.
  }
  return [...new Set(urls)]
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      const urls = await shellUrls()
      // One missing file must not fail the whole install.
      await Promise.allSettled(urls.map((url) => cache.add(new Request(url, { cache: 'reload' }))))
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key)
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (isProjectData(url)) return

  if (isImmutable(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request)
        if (cached) return cached
        const response = await fetch(request)
        if (response.ok) (await caches.open(CACHE)).put(request, response.clone())
        return response
      })(),
    )
    return
  }

  // The shell itself: prefer the network so a rebuild is picked up straight
  // away, and fall back to the cache when the server is not running. A
  // navigation falls back to the stored page even when its URL differs, which
  // is what lets a home-screen shortcut open at all.
  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request)
        if (response.ok) (await caches.open(CACHE)).put(request, response.clone())
        return response
      } catch (error) {
        const cached = await caches.match(request)
        if (cached) return cached
        if (request.mode === 'navigate') {
          const shell = await caches.match('/')
          if (shell) return shell
        }
        throw error
      }
    })(),
  )
})
