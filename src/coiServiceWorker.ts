/**
 * Cross-origin isolation on hosts that cannot set headers (GitHub Pages).
 *
 * `public/coi-serviceworker.js` re-serves every response with COOP/COEP, but a
 * service worker only affects loads it controls — so the first visit arrives
 * un-isolated and has to be reloaded once, after the worker is active. Without
 * isolation there is no SharedArrayBuffer, and the WASI language server falls
 * back to the built-in provider (see `src/lsp/wasiTransport.ts`).
 */

/** Guards against a reload loop when isolation cannot be achieved at all. */
const RELOAD_FLAG = 'coi-reload-attempted'

/**
 * Resolves once the page is cross-origin isolated, or once it is clear that it
 * will not become isolated. Reloads the page at most once per session, so
 * callers must treat a pending promise as "initialisation is over".
 */
export async function ensureCrossOriginIsolated(): Promise<boolean> {
  if (globalThis.crossOriginIsolated) {
    // Reached via real headers (dev/preview) or via a previous reload.
    forgetReloadAttempt()
    return true
  }

  // Service workers need a secure context, so plain-HTTP hosts stop here.
  if (!('serviceWorker' in navigator)) return false

  // The worker is already in charge and the page still is not isolated, so
  // reloading again would achieve nothing.
  if (reloadAttempted()) {
    console.warn(
      '[coi] still not cross-origin isolated after reloading; SharedArrayBuffer stays unavailable',
    )
    return false
  }

  try {
    await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}coi-serviceworker.js`)
    await navigator.serviceWorker.ready
  } catch (error) {
    console.warn('[coi] service worker registration failed:', error)
    return false
  }

  rememberReloadAttempt()
  location.reload()

  // The reload is asynchronous: this keeps the caller from booting Monaco, the
  // renderer and the language server into a document that is about to go away.
  return new Promise<boolean>(() => {})
}

// sessionStorage throws instead of returning null when storage is blocked (for
// example third-party cookies disabled in an iframe), and a failure here should
// never take the whole app down. Losing the flag only costs one extra reload.

function reloadAttempted(): boolean {
  try {
    return sessionStorage.getItem(RELOAD_FLAG) !== null
  } catch {
    return false
  }
}

function rememberReloadAttempt(): void {
  try {
    sessionStorage.setItem(RELOAD_FLAG, '1')
  } catch {
    /* ignore */
  }
}

function forgetReloadAttempt(): void {
  try {
    sessionStorage.removeItem(RELOAD_FLAG)
  } catch {
    /* ignore */
  }
}
