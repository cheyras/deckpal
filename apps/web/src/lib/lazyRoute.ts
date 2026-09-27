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
 * chunk surfaces as an error instead of a reload loop. The guard belongs to
 * that chunk: a parent route or background preload succeeding must not clear
 * a child's failed-import guard. Recovery never runs in dev — there
 * a failed import is a real error that should be seen, not reloaded away.
 *
 * ── EVERY PRODUCT PAGE IS ONE OF THESE NOW (2026-09-26, PERF-01) ─────────────
 *
 * `main.tsx` used to import every page statically, so the admin panel, the
 * scanner and Stripe's checkout UI were all in the one entry chunk every visitor
 * downloaded and parsed before seeing a card. Carrying that meant three changes:
 *
 *   1. `preload()`. TanStack Router calls `component.preload()` while it loads
 *      a match and does not commit the navigation until it settles, so the old
 *      page stays up while the new one's chunk arrives. It is also what
 *      `defaultPreload: 'intent'` fires on hover and touchstart. A preload is
 *      SPECULATIVE, so it never rejects and never reloads — hovering a link must
 *      not reload the page. A failed preload just leaves the render to try
 *      again, and the render is where the recovery lives.
 *   2. No Suspense flash. Once the module is here the page renders it directly,
 *      not through `React.lazy`, so a preloaded route paints in the frame the
 *      router commits it.
 *   3. The uncontrolled case recovers too. With one chunk there was nothing to go
 *      stale; with thirty, a tab opened before a deploy and NOT under a service
 *      worker (a first visit, a browser without one) asks for hashes the server
 *      no longer has. A plain reload fetches the new shell, so a production
 *      build reloads once either way; the worker is pulled forward only when
 *      there is one to pull.
 */
import { createElement, lazy, useState, type ComponentProps, type ComponentType, type ReactElement } from 'react'
import { activateLatest } from '../pwa'

const RETRY_KEY = 'deckpal:chunk-retry'

function retryKey(chunkId: string): string {
  return `${RETRY_KEY}:${chunkId}`
}

function retried(chunkId: string): boolean {
  try {
    return sessionStorage.getItem(retryKey(chunkId)) !== null
  } catch {
    return true
  }
}

function markRetried(chunkId: string): void {
  try {
    sessionStorage.setItem(retryKey(chunkId), String(Date.now()))
  } catch {
  }
}

function clearRetry(chunkId: string): void {
  try {
    sessionStorage.removeItem(retryKey(chunkId))
  } catch {
  }
}

export type LazyRoute<C extends ComponentType<any>> = ((props: ComponentProps<C>) => ReactElement) & {
  /** Fetch and evaluate the chunk without rendering it. Never rejects. */
  preload: () => Promise<void>
  /** True once the chunk is here, after which rendering cannot suspend. */
  ready: () => boolean
}

export function lazyRoute<M extends Record<string, any>, K extends keyof M = 'default'>(
  chunkId: string,
  load: () => Promise<M>,
  exportName: K = 'default' as K,
): M[K] extends ComponentType<any> ? LazyRoute<M[K]> : never {
  let loaded: ComponentType<any> | undefined
  let inflight: Promise<void> | undefined

  const settle = (mod: M): ComponentType<any> => {
    const page: ComponentType<any> = mod[exportName]
    loaded = page
    clearRetry(chunkId)
    return page
  }

  const preload = () =>
    (inflight ??= load().then(
      (mod) => void settle(mod),
      () => {
        inflight = undefined
      },
    ))

  const Recovering = lazy(async () => {
    try {
      return { default: settle(await load()) }
    } catch (err) {
      if (import.meta.env.DEV || retried(chunkId)) throw err
      markRetried(chunkId)
      if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) await activateLatest()
      window.location.reload()
      return new Promise<never>(() => {})
    }
  })

  function Route(props: object) {
    // Decided once per mount: an instance that started on the lazy path stays
    // on it, because swapping the element type under a mounted page would
    // remount it and throw its state away.
    const [direct] = useState(() => loaded !== undefined)
    return createElement<object>(direct ? loaded! : Recovering, props)
  }
  Route.preload = preload
  Route.ready = () => loaded !== undefined
  return Route as never
}
