---
date: "2026-09-26"
title: "App-wide React error boundaries, plus a minimal client-crash beacon"
decided_by: "Chey (via Claude)"
areas: ["general"]
supersedes: []
---
## 2026-09-26 — App-wide React error boundaries, plus a minimal client-crash beacon

**Decided by:** Chey (via Claude)

**Decision:** Fix QUAL-01 (`scratchpad/audits/quality.md`): the app had no
`ErrorBoundary` anywhere above `<RouterProvider>` and `createRouter()` set no
`errorComponent`/`defaultErrorComponent`, so an uncaught render exception
anywhere unmounted the whole app to a blank page with nothing anywhere to
tell the maintainer it happened. Two boundaries, added in
`apps/web/src/components/ErrorBoundary.tsx`:

- `RouteErrorFallback` is wired in as `createRouter()`'s single new option,
  `defaultErrorComponent` (`main.tsx`). `@tanstack/react-router` wraps EVERY
  matched route (not just the leaf) in its own `CatchBoundary` whenever
  `errorComponent`/`defaultErrorComponent` is set — with neither set, the
  wrapper is a no-op `SafeFragment` (confirmed by reading
  `@tanstack/react-router`'s `Match.js`), which is the bug. Because
  boundaries nest one per matched route, a leaf route's crash is caught by
  that route's own boundary before it reaches its parent, so `AppShell`'s
  header/rail survive untouched. No change to any of the many individual
  `createRoute()` calls was needed.
- `RootErrorBoundary` wraps `<RouterProvider>` itself as the last resort for
  anything outside the router's own reconciliation (a throw from
  `RootComponent`, `QueryClientProvider`, or a context between them).
  Deliberately dependency-light — no router hooks, no `BugButton` — since it
  has to keep working when the thing that broke is the router or a context
  above it.
- Both fallbacks recognize `lib/lazyRoute.ts`'s stale-chunk failure message
  and swap "Retry" for "Reload": `lazyRoute.ts` already retries a failed
  dynamic import once before an error ever reaches a boundary, so a second
  failure reaching either fallback means that retry already happened and
  offering it again would loop.
- The route-level fallback's "Report this" reuses the existing
  `BugButton`/`/api/bugs` flow rather than inventing a second reporting UI —
  `BugButton` gained two props (`initialText`, `trigger`) so the crash
  message can pre-fill the report. Nothing is auto-sent: the modal still
  opens for a human to review and click Submit, same as every other report.

**Observability (AGENTS.md B11):** No existing client error-reporting or
logging endpoint was found (`console.error` only, and only where a component
happened to add it). A minimal, unauthenticated `POST /client-errors`
(`apps/api/src/routes/clientErrors.ts`) was added: it truncates route/
message/stack/buildId and `console.error`s them server-side — no DB row, no
screenshot, no GitHub issue, no user identity. Reusing `/bugs`' pipeline was
considered and rejected: that route persists a `bug_report` row and, in
cloud mode, files a real GitHub issue per call, which is right for a report
a human chose to send and wrong for an unattended beacon that would
otherwise open a GitHub issue on every affected page load across every user
hitting the same bug. Rate-limited at 20/min/IP
(`rateLimit.ts`'s `clientErrorRateLimit`, on top of the existing
`preAuthFloodGuard`) purely to bound log volume from a repeating crash loop,
not because the handler has real cost. The client learns which commit built
its own bundle via a new `VITE_BUILD_SHA` (`vite.config.ts`, baked from
Vercel's `VERCEL_GIT_COMMIT_SHA` the same way `VITE_VERCEL_ENV` already is;
empty outside a Vercel build) — the client-side twin of
`apps/api/src/decke/build.ts`'s `buildStamp()` — so a report can say which
build was actually running in the browser, which can legitimately differ
from whichever build the API happens to be answering from.

**Testing:** `tests/browser/fixture.tsx` gained an `?errorboundary` mode: a
minimal but REAL `@tanstack/react-router` tree wired exactly like `main.tsx`
(`defaultErrorComponent` + `RootErrorBoundary`), driven end-to-end by a new
`tests/browser/errorBoundary.mjs` (wired into `pnpm test:browser`) that
throws from a route component and asserts the boundary renders, the shell
(a header outside the routed `Outlet`) survives, Retry re-runs the crashed
component and recovers once the underlying bug is fixed, and a crash
outside the router takes the shell down too (the root boundary's strictly
larger blast radius). Screenshots at 1280px and 390px. Fixing this
surfaced a latent bug in `tests/browser/support.mjs`'s `serve()`: a bare
root request (`rel === '/'`) resolves to the dist directory itself, which
does not start with `dist + path.sep` (a string is never a prefix of
itself), so it was rejected as "outside the fixture output" — nobody had
navigated a fixture straight to `/` before. Fixed with an equality
short-circuit; every actual `..`-escape still fails the `startsWith` check.
`apps/api/src/routes/clientErrors.ts`'s pure truncation/defaulting logic is
unit-tested in `apps/api/src/__tests__/clientErrors.test.ts` (added to
`test:pure`).

**Implications:** Any future route crash is now contained to that route and
reported automatically; a genuinely unrecoverable crash still shows a calm,
on-brand screen instead of a blank page. `BugButton`'s new props are
available to any other future caller that wants a pre-filled report. The
`/client-errors` beacon is intentionally the smallest thing that satisfies
B11 — a schema-per-response-validation pass (QUAL-03) and a richer
maintainer-facing crash dashboard are both explicitly out of scope here.
