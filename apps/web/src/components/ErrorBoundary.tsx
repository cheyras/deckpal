/**
 * Error boundaries — QUAL-01 (scratchpad/audits/quality.md): before this file,
 * `main.tsx` had no `<ErrorBoundary>` anywhere above `<RouterProvider>` and the
 * router itself had no `defaultErrorComponent`, so a render-time exception
 * anywhere unmounted the ENTIRE app to a blank white page, with nothing
 * anywhere to tell the maintainer it happened.
 *
 * Two layers, matching the two things that can actually throw:
 *
 * `RouteErrorFallback` is wired in as `createRouter()`'s `defaultErrorComponent`
 * — see main.tsx. TanStack Router wraps EVERY matched route (not just the leaf)
 * in its own `CatchBoundary` whenever `errorComponent`/`defaultErrorComponent`
 * is set (`@tanstack/react-router`'s `Match.js`: `ResolvedCatchBoundary` is a
 * no-op `SafeFragment` when neither is set, which is the bug). Because boundaries
 * nest one per route, a crash in a LEAF route's component is caught by that
 * route's own boundary before it ever reaches the parent — so `AppShell`'s
 * header/rail and the root route survive untouched. This is the "one page
 * crashes, the rest of the app doesn't" fix, and it needed no change to any of
 * the many individual `createRoute()` calls in main.tsx.
 *
 * `RootErrorBoundary` is the backstop for everything OUTSIDE the router's own
 * reconciliation — a throw from `RootComponent` itself, `QueryClientProvider`,
 * or anything else between `createRoot().render()` and `<RouterProvider>`.
 * Deliberately dependency-light (no router hooks, no BugButton): it has to
 * keep working even when the thing that broke is the router or a context
 * above it, so "Go home" is a plain `<a href>`, not a router `Link`.
 *
 * STALE CHUNKS: `lib/lazyRoute.ts` already retries a failed dynamic import once
 * (pull the waiting service worker forward, reload) before ever letting the
 * error reach a boundary. So by the time either boundary here sees a
 * chunk-load-shaped error, that retry has already happened and failed —
 * offering the same fix again would loop. `isStaleChunkError` recognizes the
 * class and both fallbacks swap "Retry" for a plain "Reload" instead of
 * fighting lazyRoute's own recovery.
 */
import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { Link, type ErrorComponentProps } from '@tanstack/react-router'
import { Icon } from './Icon'
import { Button, buttonClass } from './ui/Button'
import { BugButton } from './BugReport'
import { api } from '../lib/api'
import { BUILD_SHA } from '../lib/buildInfo'
import { isCloudMode } from '../lib/supabase'

// A plain constant, not a hook — safe for `RootErrorBoundary` to read despite
// its "no router hooks" rule. Self-host serves the app under `/deckpal/`
// (`main.tsx`'s own `basepath: import.meta.env.VITE_SUPABASE_URL ? '' :
// '/deckpal'`); `<Link to="/">` resolves that automatically for
// `RouteErrorFallback`, but a plain `<a href>` has to be told.
const HOME_HREF = isCloudMode ? '/' : '/deckpal/'

// The exact strings `lazyRoute.ts`'s own failed `import()` rejects with
// (Chromium/WebKit/Firefox phrase this differently), seen only on a SECOND
// failure — lazyRoute already reloaded once by the time either boundary here
// could render.
const STALE_CHUNK_RE = /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown error'
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined
}

export function isStaleChunkError(error: unknown): boolean {
  return STALE_CHUNK_RE.test(errorMessage(error))
}

/**
 * console.error (visible in the browser's own devtools, and greppable from a
 * user-supplied screenshot per QUAL-01's fix note) plus a best-effort beacon
 * to the maintainer (`api.reportClientError` → `POST /client-errors`, see
 * `apps/api/src/routes/clientErrors.ts`). The beacon never throws and its
 * failure is never surfaced — see the function's own comment in `lib/api.ts`
 * for why.
 */
function reportCrash(scope: 'root' | 'route', error: unknown): void {
  console.error(`[deckpal] ${scope} error boundary caught:`, error)
  api.reportClientError({
    route: window.location.pathname,
    message: errorMessage(error),
    stack: errorStack(error),
    buildId: BUILD_SHA || undefined,
  })
}

const COPY = {
  stale: {
    title: 'DeckPal was updated',
    body: 'A newer version of DeckPal is ready. Reload to pick it up.',
  },
  route: {
    title: 'This page hit a snag',
    body: 'Something went wrong loading this page. Retrying usually clears it — the rest of DeckPal is unaffected.',
  },
  root: {
    title: 'Something went wrong',
    body: "DeckPal hit an error it couldn't recover from on its own. Reloading usually clears it.",
  },
}

/**
 * `createRouter()`'s `defaultErrorComponent` — see main.tsx and the file
 * header above for why this alone gives every route its own crash boundary.
 * Renders in place of the route's content, inside the same `AppShell` the
 * healthy route would have used, so the header/rail/nav stay interactive.
 */
export function RouteErrorFallback({ error, reset }: ErrorComponentProps) {
  const stale = isStaleChunkError(error)
  const message = errorMessage(error)

  // Fires once per distinct caught error: `error` is a fresh value each time
  // CatchBoundary's `getDerivedStateFromError` catches (see its state shape,
  // `{ error: [unknown] }`), and `reset()` clears state entirely rather than
  // mutating it in place — so a genuinely new crash after a Retry gets a
  // genuinely new effect run, not a deduped no-op.
  useEffect(() => {
    reportCrash('route', error)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- report once per error identity, not per render
  }, [error])

  const copy = stale ? COPY.stale : COPY.route

  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-[16px] px-[24px] py-[96px] text-center">
      <Icon name="alert" size={44} className="text-icon-muted" />
      <h1 className="font-display text-[20px] font-bold text-text-primary">{copy.title}</h1>
      <p className="max-w-[420px] text-[14px] leading-[1.5] text-text-muted">{copy.body}</p>
      <div className="flex flex-wrap items-center justify-center gap-[10px]">
        {stale ? (
          <Button onClick={() => window.location.reload()}>Reload</Button>
        ) : (
          <Button onClick={reset}>Retry</Button>
        )}
        <Link to="/" className={buttonClass('secondary')}>
          Go home
        </Link>
        <BugButton
          initialText={`Crash on ${window.location.pathname}:\n${message}`}
          trigger={(open) => (
            <button
              type="button"
              onClick={open}
              className="text-[13px] font-semibold text-text-muted underline hover:text-text-body"
            >
              Report this
            </button>
          )}
        />
      </div>
    </div>
  )
}

interface RootErrorBoundaryState {
  error: Error | null
}

/**
 * Last resort, wrapped directly around `<RouterProvider>` in main.tsx. Kept
 * deliberately minimal — no router hooks (the router may be what broke), no
 * `BugButton` (one more component tree that could itself throw here is the
 * opposite of a backstop). A plain `<a href="/">` for "Go home" works
 * regardless of what state the app is in, because it is just an anchor.
 */
export class RootErrorBoundary extends Component<{ children: ReactNode }, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): RootErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(errorMessage(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    reportCrash('root', error)
    if (info.componentStack) console.error('[deckpal] component stack:', info.componentStack)
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    const stale = isStaleChunkError(error)
    const copy = stale ? COPY.stale : COPY.root
    return (
      <div
        role="alert"
        className="flex min-h-dvh flex-col items-center justify-center gap-[16px] bg-surface-primary px-[24px] text-center"
      >
        <Icon name="alert" size={44} className="text-icon-muted" />
        <h1 className="font-display text-[22px] font-bold text-text-primary">{copy.title}</h1>
        <p className="max-w-[420px] text-[14px] leading-[1.5] text-text-muted">{copy.body}</p>
        <div className="flex flex-wrap items-center justify-center gap-[10px]">
          <Button onClick={stale ? () => window.location.reload() : this.reset}>{stale ? 'Reload' : 'Retry'}</Button>
          <a href={HOME_HREF} className={buttonClass('secondary')}>
            Go home
          </a>
        </div>
      </div>
    )
  }
}
