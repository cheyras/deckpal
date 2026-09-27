---
date: "2026-09-26"
title: "Every gated entry point carries a return path; `next` is validated by one strict parse"
decided_by: "Chey (via Claude)"
areas: ["general"]
supersedes: []
---
## 2026-09-26 — Every gated entry point carries a return path; `next` is validated by one strict parse

**Decided by:** Chey (via Claude)

**Decision:** Fix UXC-06 (sign-in walls lose the user's intent) and SEC-05 (the
`?next=` open redirect) together, since both live in the same handful of call
sites.

- `apps/web/src/lib/landingRoute.ts`'s `isSafeNextPath` (a hand-written
  blocklist — `startsWith('/')`, not `//`, not `/\`) is replaced by
  `safeNextPath`, which parses with `new URL(value, origin)` and compares
  origins — the same algorithm the eventual navigation runs, so the check and
  the navigation can never disagree. A pre-parse reject-list closes every
  control and whitespace character (tab, newline, CR, NUL, …) and `\`, which
  is what let `/\t/evil.example/phish` become `//evil.example/phish` once the
  WHATWG parser's own tab-stripping ran. It returns the parsed
  `pathname + search + hash`, never the raw string, and accepts an optional
  `origin` parameter (defaulting to `window.location.origin`) purely so the
  bypass-corpus unit tests can run under Node's plain `--test` runner with no
  DOM. `isSafeNextPath` is now a thin type-guard wrapper over it, so there is
  exactly one predicate.
- Every place that used to bounce to `/auth` without a destination now sets
  `next`: `AuthGuard.tsx`'s redirect for a page that required sign-in,
  `api.ts`'s `handle401` (a session that expired mid-page), the rail's locked
  nav rows (`AppShell.tsx`), the header's `SignInChip` and the mobile drawer's
  "Sign up free", `SignInPrompt.tsx`, and the card sheet's per-variant "Sign in
  to track" link. `Auth.tsx`'s `goTo()` (the sign-in/sign-up tab toggle) now
  preserves `next` across the switch, where it used to drop it.
- The rail's locked rows and the card sheet's "Sign in to track" link were
  both labelled "Sign in" but linked to `?mode=signup` — the visible tab and
  the actual destination disagreed. Both now open sign in, with the toggle at
  the top of `/auth` as the one-tap switch to sign up.
- The `/auth` heading names the destination when it's one of a short known
  list (lists, decks, insights, profile) — "Sign in to see your lists" instead
  of a generic "Welcome back" — the same courtesy `/authorize` already paid
  for OAuth.
- Sign-up confirmation and password reset also return to `next`.
  `signUpBounded`'s `emailRedirectTo` now points at `next` (or `/series`)
  directly, so confirming the email — which GoTrue treats as a sign-in, minting
  a session and redirecting here with it — lands on the same page sign-in
  would have; a dead or already-used link degrades to `AuthGuard`'s own
  `next`-preserving bounce back to `/auth`, never a silent drop. Password
  reset carries `next` as `/auth/reset`'s own search param (added a
  `validateSearch` for it, mirroring `/auth`'s), and its "Password updated"
  panel's primary action becomes a real navigation to `next` when one is
  present. Both ride on Supabase's existing redirect allow-list —
  `uri_allow_list = https://deckpal.app/**` (read via the Management API and
  logged 2026-08-10) — which already covers an appended query string, so no
  Supabase setting changed (AGENTS.md B9). If that allow-list is ever narrowed
  to exact-match URLs instead of a wildcard, both redirects need revisiting;
  flagging it here rather than guessing at infrastructure I did not touch.
- `tests/browser/authReturn.mjs` is a new browser-suite check. Every existing
  check in this suite signs a context in with a `localStorage` shortcut
  (`admin.mjs`'s `signIn()`), which cannot exercise this fix: the redirect to
  `next` lives in `Auth.tsx`'s submit handler, which only runs after a real
  `supabase.auth.signInWithPassword()` call resolves. The new check's fixture
  server answers `POST /auth/v1/token?grant_type=password` with a fake session
  shaped from the installed `@supabase/auth-js` 2.116.0 package's own
  `hasSession`/`_sessionResponsePassword` contract (read from the installed
  source, not assumed), still with no real account and no network egress
  (`VITE_SUPABASE_URL` points at the same loopback fixture). It drives the
  rail's locked "My Lists" row from signed out, at 1440 and 390px, and asserts
  the row opens the Sign In tab and lands on `/lists` after signing in. Wired
  into `scripts/test-browser.mjs`; `tests/browser/README.md` documents it.

**Why:** A visitor who tapped "My Lists" or a deep list link, signed out, was
shown the create-account form (the pill said "Sign in") and, after signing in,
was dropped on `/series` regardless of what they were trying to reach —
UXC-06's own evidence measured this exact path on production. Separately, the
`next` validator's blocklist and the eventual `window.location.assign(next)`
navigation used two different parsers, which is exactly the shape of bug a
blocklist produces: SEC-05 found the gap a tab character opens, and
`DECISIONS 2026-08-10` had already had to close the same family once for a
backslash. Fixing the validator without also wiring `next` through the actual
gated entry points would have left the open-redirect fixed but the UX bug
(and the audit's now-passing `next` never reaching `/auth` in most real
requests) exactly where it was.

**Implications:** `safeNextPath`/`isSafeNextPath` is the one place a `next=`
value may be judged safe; a new gated entry point should call it (or, for a
value read from the current address bar rather than user input,
`currentPathAsNext()`) rather than re-deriving a check. Deliberately left out
of this pass: consolidating the card sheet's repeated "Sign in to track" rows
into one `SignInPrompt` above the variant table (UXC-06's fuller design
proposal — a UI consolidation, not a return-path bug, and out of this PR's
scope), and threading `next` through `/signed-out`'s "Sign back in" link
(that page serves both a deliberate sign-out and an expired session, and
carrying a stale destination through a confirmation screen felt like a
separate design call rather than a mechanical fix). Landing.tsx's sign-in/
sign-up links are unchanged: a first-time marketing visitor has no specific
page they were trying to reach, so the existing default (`/series`) is
already correct there.
