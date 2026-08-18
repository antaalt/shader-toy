/*
 * Cross-origin isolation for hosts that cannot send response headers, such as
 * GitHub Pages.
 *
 * A service worker sits in front of every request and re-serves the response
 * with COOP/COEP attached, which is enough for the browser to treat the
 * document as cross-origin isolated — and therefore to expose
 * SharedArrayBuffer, which the WASI language server needs for blocking stdin.
 *
 * Registered from `src/coiServiceWorker.ts`; the dev and preview servers send
 * the real headers, so there it is never used.
 *
 * Same idea as https://github.com/gzuidhof/coi-serviceworker.
 */

self.addEventListener('install', () => self.skipWaiting())

// Take over the pages that are already open, so the reload after registration
// is served through this worker.
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (event) => {
  const request = event.request

  // Range requests replayed from the HTTP cache cannot be re-fetched here.
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Opaque (no-cors) responses have no readable headers or body to copy.
        if (response.status === 0) return response

        const headers = new Headers(response.headers)
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
        headers.set('Cross-Origin-Opener-Policy', 'same-origin')

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        })
      })
      .catch((error) => {
        console.error('[coi]', error)
        throw error
      }),
  )
})
