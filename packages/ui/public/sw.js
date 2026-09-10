/**
 * Service worker for the editor shell.
 *
 * Only the application itself is cached. Project files - maps, tilesets, images
 * - are deliberately never cached: they live on disk beside the server and a
 * stale copy would be worse than an error. Installing this is what lets the
 * editor run full-screen from the home screen of a tablet.
 */
const CACHE = 'tile-editor-shell-v1'

/** Requests that must always go to the network. */
function isProjectData(url) {
  return url.pathname.startsWith('/api/') || url.pathname.startsWith('/assets/')
}

/** The build emits content-hashed files under /app, so they never go stale. */
function isImmutable(url) {
  return url.pathname.startsWith('/app/') || /^\/icon-[\w-]+\.png$/.test(url.pathname)
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
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
  // away, and fall back to the cache when the server is not running.
  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request)
        if (response.ok) (await caches.open(CACHE)).put(request, response.clone())
        return response
      } catch (error) {
        const cached = (await caches.match(request)) ?? (await caches.match('/'))
        if (cached) return cached
        throw error
      }
    })(),
  )
})
