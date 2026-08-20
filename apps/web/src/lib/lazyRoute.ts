/**
 * A lazy route that survives a deploy.
 *
 * THE FAILURE. Navigations are served the PRECACHED `index.html` (`sw.ts` binds
 * them to it, which is what makes the app work offline), and that shell
 * references the entry chunk it was built with. Both are in the precache, so an
 * old service worker keeps serving a self-consistent pair until the user accepts
 * the update toast — which is the design, and is fine, because every chunk that
 * shell can ask for is precached alongside it.
 *
 * Except one. `vite.config.ts` deliberately excludes `assets/Decke-*.js` from
 * the precache manifest, because it is ~945 kB of three.js for a route exactly
 * one account can open and precaching is eager. So that chunk — and only that
 * chunk — is always fetched from the network, by a shell that may be a deploy or
 * two old, naming a hash the server no longer has. The result is a hard failure
 * on a route that worked ten minutes ago:
 *
 *     Failed to fetch dynamically imported module:
 *     https://deckpal.app/assets/Decke-DqREFuSk.js
 *
 * and it recurs on EVERY deploy, for the one person who uses that route. It is a
 * consequence of the precache exclusion rather than a bug in it: the exclusion
 * is right, and this is the other half of it.
 *
 * THE RECOVERY. A module that will not load is very likely a stale shell, so:
 * pull the waiting service worker forward, reload once, and let the fresh shell
 * ask for a hash that exists. Guarded by a session flag so a genuinely broken
 * chunk surfaces as an error instead of a reload loop, and gated on there
 * actually being a service worker in control — in dev there is none, and a
 * failed import there is a real error that should be seen, not reloaded away.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import { activateLatest } from '../pwa'

const RETRY_KEY = 'deckpal:chunk-retry'

function retried(): boolean {
  try {
    return sessionStorage.getItem(RETRY_KEY) !== null
  } catch {
    // Storage can be unavailable (Safari private mode, a partitioned iframe).
    // Without it we cannot tell a first failure from a second, and reloading
    // forever is far worse than showing the error, so treat it as "already
    // tried".
    return true
  }
}

function markRetried(): void {
  try {
    sessionStorage.setItem(RETRY_KEY, String(Date.now()))
  } catch {
    /* see `retried` */
  }
}

function clearRetry(): void {
  try {
    sessionStorage.removeItem(RETRY_KEY)
  } catch {
    /* nothing to clear */
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- React's own
// signature for `lazy`; narrowing it rejects perfectly ordinary components.
export function lazyRoute<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const mod = await load()
      // Reaching here means the shell and the chunk agree again.
      clearRetry()
      return mod
    } catch (err) {
      const controlled =
        typeof navigator !== 'undefined' &&
        'serviceWorker' in navigator &&
        !!navigator.serviceWorker.controller
      if (!controlled || retried()) throw err

      markRetried()
      await activateLatest()
      window.location.reload()
      // The reload wins the race; resolving would flash the route for a frame
      // on the way out.
      return new Promise<never>(() => {})
    }
  })
}
