---
date: "2026-08-27"
title: "Issue #75: the grey screen was an unbounded auth read, not a bundle"
decided_by: "Claude Opus 5 on behalf of @cheyras (issue #75, second pass)"
areas: ["security","frontend"]
supersedes: []
---
## 2026-08-27 — Issue #75: the grey screen was an unbounded auth read, not a bundle

**Decided by:** Claude Opus 5 on behalf of @cheyras (issue #75, second pass)

**Decision.** Put a deadline on every read of the Supabase auth session, make
one module the only place that reads it, gate the build on that, and add an
inline first-paint watchdog for the failures nobody has diagnosed yet.

**Why.** #87 fixed a real problem — a `<link rel="modulepreload">` for the
character chunk on the critical path, 6.3 s to first content — and the reporter
still saw an indefinite grey screen afterwards. The signature in #49's last
comment is what gave it away: *a refresh does not clear it, closing the tab and
re-navigating loads it instantly.* A bundle gets slower or faster; it does not
hang.

`supabase.auth.getSession()` is commented all over this codebase as "reads the
persisted session out of localStorage, so the common case resolves in a tick".
That is true only while the stored access token is more than `EXPIRY_MARGIN_MS`
(90 s) from expiry. Inside that window — and on every load where it has already
expired, which is every load after a couple of hours away — the client refreshes
first:

    getSession() → initializePromise → _initialize → _recoverAndRefresh
                 → _callRefreshToken → POST /auth/v1/token?grant_type=refresh_token

`@supabase/auth-js` 2.112.3 attaches no `AbortSignal` and no timeout anywhere in
that request path (read `dist/module/lib/fetch.js`: there is no `AbortController`
in it). Its retry ladder only runs for a fetch that FAILS. A fetch that never
SETTLES — a socket stranded by a network change, a sleep/resume, a captive
portal, a stalled H2 connection — never settles, and `initializePromise` never
resolves. Three places awaited it before anything could render: `main.tsx`'s
index route in `beforeLoad` (so the router rendered nothing), `AuthGuard` (an
infinite spinner) and `api.ts`'s `authHeaders()` before EVERY request (so even
the public catalog came up as chrome with no content).

**Measured, in a real browser, against a dev build with the token endpoint held
open** (`scripts/visual-harness/probe-first-paint.mjs`, a seeded session that
expired an hour ago plus a `page.route` that never answers):

| | before | after |
|---|---|---|
| `/` desktop | blank at 12 s — `#root` had **0 children**, 0 chars of text | content at 4.6 s |
| `/series` desktop | nav chrome only, catalog never arrived | full catalog at 4.9 s |
| `/` mobile | blank at 12 s, 0 children | content at 4.3 s |
| `/series` mobile | nav chrome only | full catalog at 4.8 s |
| probe exit code | 1 (4/4 FAIL) | 0 (4/4 PASS) |

**#87's inline first-paint state cannot cover this, and that is worth writing
down.** `createRoot(...).render()` replaces `#root`'s children on first commit,
so the "Loading DeckPal" card is gone by the time the hang starts — measured,
`bootPresent: false` with zero children. A loading state that lives inside the
container React owns can explain a WAIT but never a HANG.

**What shipped.**
- `lib/sessionDeadline.ts` — pure, `import.meta.env`-free (so `node --test` can
  reach it), holding `withDeadline` and `SESSION_DEADLINE_MS = 4000`.
- `lib/authSession.ts` — the only module that may call the client. `readSession`,
  `refreshSessionBounded`, a 30 s memo so a known stall is not re-waited by every
  caller on the page, and one `console.error` + `performance.mark` per stall
  episode. That console line is the thing to ask a reporter for next time.
- Eight call sites converted, each with a fallback chosen so that **a timeout is
  UNKNOWN, never "signed out"**: `/` routes to the public catalog, `AuthGuard`
  renders "Still checking your session" with a Reload rather than bouncing to
  `/auth`, `/authorize` and the password-recovery page hold their pending state
  instead of declaring the link dead, and `api.ts` sends the request
  unauthenticated so a finite 401 replaces an infinite spinner. `onLate` settles
  the UI if the answer turns up, with no reload.
- `apps/web/scripts/check-auth-deadlines.mjs`, wired into `pnpm --filter
  deckpal-web build` — fails on a raw `auth.getSession()`/`auth.refreshSession()`
  outside `lib/authSession.ts`. Proven both ways: reintroducing one call exits 1
  and names the file and line.
- An inline watchdog in `index.html`: after 12 s with `#root` still empty, log
  one console error (with whether a service worker is in control) and replace the
  blank page with "DeckPal is taking longer than usual" and a Reload button.
  Verified by blocking the entry module — fires at 12 s; does not fire on a
  healthy load.

**What this does NOT claim.** The mechanism above is measured. The reporter's
*trigger* is not: nothing here proves which stall stranded their socket, and the
"a refresh does not clear it but a new tab does" asymmetry is consistent with a
dead pooled connection surviving a reload, which was inferred rather than
observed. Ruled OUT by reading and measurement, and worth not re-investigating:
the service worker (every route in `sw.ts` is bounded — `networkTimeoutSeconds:
5` on API GETs, a precache hit for navigations — and nothing routes the auth
origin); a `navigator.locks` deadlock (auth-js 2.112.3 deprecated its locks and
the client no longer acquires them); IndexedDB (the app opens none — no query
persister, and Supabase uses localStorage); and the #87 bundle regression, which
is confirmed still fixed on production (only `jsx-runtime` and `app-lib`
preloaded, critical path 296 kB gz locally against 300 kB in production).

**Implications.**
- New auth-session call sites go through `lib/authSession.ts`. The build will
  tell you if you forget.
- Four seconds is a deliberate asymmetry, not a tuned number: overshooting costs
  one beat and a non-destructive fallback, undershooting costs nothing because a
  warm read never touches the network, and being absent cost issue #75.
- The watchdog reads "painted" off the DOM rather than a flag the app sets, so
  there is no cross-file contract to drift. If a future change makes `#root`
  legitimately empty after mount, the watchdog will fire and be right to.

---

