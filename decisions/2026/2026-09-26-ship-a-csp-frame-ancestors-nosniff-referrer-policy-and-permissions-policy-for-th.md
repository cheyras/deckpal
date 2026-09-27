---
date: "2026-09-26"
title: "Ship a CSP, frame-ancestors, nosniff, Referrer-Policy and Permissions-Policy for the SPA; fix private-API cache headers to no-store"
decided_by: "Chey (via Claude)"
areas: ["security"]
supersedes: []
---
## 2026-09-26 — Ship a CSP, frame-ancestors, nosniff, Referrer-Policy and Permissions-Policy for the SPA; fix private-API cache headers to no-store

**Decided by:** Chey (via Claude)

**Decision:** Add a third `headers` rule to `vercel.json`, scoped to
`/((?!api/).*)` (everything except `/api/*`, which already gets an equivalent
set from `helmet()`), carrying an enforcing `Content-Security-Policy`,
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin` and a `Permissions-Policy`
that keeps `camera=(self)` and `microphone=(self)` allowed. Separately, fix
`apps/api/src/http.ts`'s `userCache()` (every private collection/decks/lists/
dex/insights/avatar/export response) and `apps/api/src/export/router.ts`'s
PDF headers from `private, no-cache, must-revalidate` to `private, no-store`,
matching this document's existing "all private APIs are no-store" promise.

**Why:** The security audit (2026-09-26, SEC-03/SEC-14) found that Vercel's
static layer — which serves this app's HTML directly, never through Express —
shipped none of these headers, while the Supabase session (including its
refresh token) lives in `localStorage`: a single XSS would be a persistent
account takeover, not just a stolen session, and the app could be framed by
any site (confirmed: `/authorize`, the OAuth consent screen, rendered inside
a hostile iframe in a headless-browser proof). Separately, `userCache()`'s
`no-cache` still permits a shared disk cache to hold a revalidated copy of
one account's collection JSON after that account signs out on a shared
device, which `SECURITY.md` already promises does not happen.

**Two corrections to the audit's suggested fix, found by reading the actual
code rather than shipping its policy verbatim:**
1. The audit suggested moving `apps/web/index.html`'s inline first-paint
   watchdog to a static file to avoid a CSP hash entirely ("simpler"). That
   file's own comment says the opposite is required: "IT IS INLINE, AND IT
   MUST STAY INLINE. A watchdog that needs a request of its own cannot cover
   a failure to fetch" — externalizing it would reintroduce the exact
   "blank page, no explanation" bug (issue #75) it exists to prevent. Kept it
   inline and allow-listed it by its exact `sha256-` hash instead, guarded by
   a new `scripts/check-security-headers.mjs` (wired into `test:security-headers`
   and CI) that recomputes the hash from the live file on every run and fails
   loudly if it no longer matches `vercel.json` — so a future edit to that
   script cannot silently ship a CSP that blocks it. The same check found a
   second real inline script this app ships: `/dev/scan-harness`
   (`diagnostics.view`-gated, but a real production route) embeds a
   5,800-line card-detector bakeoff tool as a single classic `<script>` via
   `<iframe srcDoc={...}>` — a srcdoc document with no CSP of its own is
   checked against the *embedding* page's `script-src` — so it gets its own
   hash in the same policy, verified the same way.
2. The audit's example policy's `frame-src` listed only Stripe's two hosts.
   `/dev/decke-compare` (same `diagnostics.view` gate) renders a same-origin
   recursive `<iframe src={window.location.pathname}?frame=...}>` to run the
   shipped Deck-E glb beside a candidate side by side — a real navigation
   that `frame-src` without `'self'` would have blocked. Added `'self'`.
3. Hardened one more spot past the audit's literal policy: `img-src` and
   `connect-src` allow `https://*.supabase.co`/`wss://*.supabase.co` as a
   wildcard rather than this deployment's one project hostname, so any
   Vercel+Supabase fork (`DEPLOYMENT.md`) is covered without editing
   `vercel.json` for its own project ref.

**Shipped enforcing, not `Content-Security-Policy-Report-Only`:** this app has
no `report-uri`/`report-to` collector, so report-only mode would collect
nothing from real users and simply delay real protection for a policy that
was going to ship unchanged regardless. Verified instead by building the real
app from this branch and crawling every route — signed out and signed in as
an owner with `decke.use`/`scanner.use`/`diagnostics.view` — in Chromium AND
WebKit against the exact literal CSP parsed live out of `vercel.json`
(`tests/browser/securityHeaders.mjs`, wired into `scripts/test-browser.mjs`
so it now runs on every `pnpm test:browser`, i.e. every PR): 0
`securitypolicyviolation` events. Also exercised, with 0 violations: the
scanner's real camera (Chromium fake-device flags, confirms a live
`MediaStream` reaches the `<video>` element), the Deck-E character bubble and
its runtime chunk, service worker registration, and a dedicated allow/deny
probe proving `script-src` allows `https://js.stripe.com/v3/` and `img-src`/
`connect-src` allow a `*.supabase.co`-shaped origin while an arbitrary
third-party host on both directives is blocked and visibly reported as a
`securitypolicyviolation` (not a silent no-op).

**Implications:** Self-host is unaffected (no `vercel.json`; already gets
helmet's headers, per `SECURITY.md`). A future contributor who edits the
watchdog script or the scan-harness tool will get a clear, specific CI
failure naming the stale hash rather than a silently-broken feature in
production. `scripts/check-security-headers.mjs` also asserts the header
rule's source regex still excludes `/api/*` while covering ordinary app,
auth and `.well-known` paths, the same "parse the real regex, don't trust the
string" approach `scripts/check-redirects.mjs` uses for the deckscout.io
redirect. If a legitimate new origin is ever needed (a new image host, a new
payment step), it has to be added to the CSP explicitly — that friction is
the point.
