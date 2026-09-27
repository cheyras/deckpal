import { useRouterState } from '@tanstack/react-router'

/** Strips the deploy's base path and any trailing slash. `/deckpal/auth` → `/auth`. */
function stripBase(pathname: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '')
  let rest = pathname
  if (base && (rest === base || rest.startsWith(`${base}/`))) rest = rest.slice(base.length)
  return rest.replace(/\/+$/, '')
}

// Routes that render with NO app chrome at all: the marketing landing and
// every auth surface. AppShell returns bare children for these.
// The nav mounts ProfileChip, whose overview query 401s while signed out →
// handle401 → location.assign('/auth') → reload → 401 … the loop this list
// exists to break. (The catalog below fixes that differently — it renders the
// nav but never mounts an authenticated query while signed out.)
const CHROMELESS_PATHS = new Set([
  '/auth', // sign in / sign up / forgot password
  '/auth/reset', // password-recovery link target
  '/signed-out', // post-sign-out confirmation
  '/authorize', // OAuth "Connect" consent screen — must render signed-out, see Authorize.tsx
  '/design', // design-system editor — no app chrome; owner-only in prod (gated in main.tsx via /me.designEditor)
  '/dev/decke', // Deck-E three.js preview — full-viewport canvas; owner-only in prod (gated in main.tsx via /me.owner)
  '/dev/decke-compare', // shipped glb vs an optimized one, side by side; owner-only in prod, same gate

  '/dev/chat-ui', // every chat surface at once, for review — no app chrome, owner-only in prod
])

export function isChromelessPathname(pathname: string): boolean {
  const rest = stripBase(pathname)
  // rest === '' is the public marketing landing (the app's index route): the
  // base path is stripped first, so `/deckpal`, `/deckpal/` and `/` all count.
  return rest === '' || CHROMELESS_PATHS.has(rest)
}

// The public catalog: the shop window a logged-out visitor may browse in full.
// These render WITH the app chrome and WITHOUT AuthGuard. Everything per-user —
// /lists, /decks, /insights, /scan, /profile — is absent from this list and
// still bounces to /auth.
//
// Matching is prefix-with-a-boundary, not startsWith: '/series' must cover
// '/series/sword-shield/swsh1/4' but a hypothetical '/seriesadmin' must not.
const CATALOG_PREFIXES = ['/series', '/pokedex', '/search']

export function isCatalogPathname(pathname: string): boolean {
  const rest = stripBase(pathname)
  return CATALOG_PREFIXES.some((p) => rest === p || rest.startsWith(`${p}/`))
}

// Every route a logged-OUT visitor is allowed to sit on. Three call sites need
// the same answer and MUST agree, or the answer is worse than useless:
//   • RootComponent (main.tsx) — must not wrap these in AuthGuard, or a
//     logged-out visitor is bounced off the very page they were sent to.
//   • AppShell — decides chrome from isChromelessPathname, but must not mount
//     authenticated queries on any of these.
//   • api.ts handle401 — must not hard-redirect away from one of these, or a
//     single stray 401 turns into an assign → reload → 401 loop.
// Hence one predicate, not three string tests that drift apart.
export function isPublicPathname(pathname: string): boolean {
  return isChromelessPathname(pathname) || isCatalogPathname(pathname)
}

/**
 * The one place `?next=` is turned into something safe to navigate to.
 *
 * SEC-05: the previous version was a hand-written blocklist — `startsWith('/')`,
 * not `//`, not `/\` — and `/\t/evil.example/phish` walked straight through
 * it: `startsWith` sees a tab, not a slash, so none of those three rules
 * fired. `window.location.assign()` then handed the same string to the
 * WHATWG URL parser, which strips tab/newline/CR *before* resolving, so
 * `/\t/evil.example/phish` became `//evil.example/phish` and then a real
 * `https://evil.example` navigation. DECISIONS 2026-08-10 closed `/\` the
 * same way this predicate now closes the tab — one more character the
 * blocklist hadn't met yet, and there will always be another.
 *
 * A blocklist is a queue of the next bypass. Parsing with the platform's
 * own resolver and comparing origins is not: `new URL(value, location.origin)`
 * runs the exact algorithm the eventual navigation runs, so this function and
 * its caller can never disagree about where a string points. Every character
 * below 0x20 (tab, newline, CR, NUL, …), every whitespace character, and `\`
 * are rejected up front — that is exactly what the parser's own
 * pre-processing would otherwise turn into a slash or a swallowed segment,
 * so rejecting them before the parse ever runs closes the whole family, not
 * just the one payload that was caught.
 *
 * Returns the origin-verified value as `pathname + search + hash` — never
 * the raw string a caller passed in — so a caller that assigns the result
 * can never end up carrying something this function did not itself resolve.
 *
 * `origin` defaults to `window.location.origin` and every real call site
 * leaves it at that default; it is a parameter (rather than reading `window`
 * directly in the body) only so the unit tests covering the bypass corpus can
 * run under Node's test runner, which has no `window`, without reaching for a
 * DOM shim just for this one function.
 */
export function safeNextPath(value: unknown, origin: string = window.location.origin): string | null {
  if (typeof value !== 'string' || value === '') return null
  if (/[\s\u0000-\u001f\u007f\\]/.test(value)) return null
  if (!value.startsWith('/') || value.startsWith('//')) return null
  let url: URL
  try {
    url = new URL(value, origin)
  } catch {
    return null
  }
  if (url.origin !== origin) return null
  return `${url.pathname}${url.search}${url.hash}`
}

// One predicate, used everywhere `next` is both written (validateSearch) and
// read (Auth.tsx, ResetPassword.tsx) — the whole point is that those checks
// cannot drift apart the way the rail's sign-in pill and AuthGuard's redirect
// already had (UXC-06).
export function isSafeNextPath(value: unknown, origin?: string): value is string {
  return safeNextPath(value, origin) !== null
}

/**
 * The current page as a `next=` value — read from the router's own location
 * state, not from user input, so it needs no validation before being handed
 * to `/auth`. Shared so every "sign in to unlock this" spot (the rail's
 * locked rows, the card sheet's per-variant prompt, the header's sign-in
 * chip) agrees on the shape: `pathname + search`, no hash. A hash on the
 * CURRENT page is scroll position or a client-only UI flag, never something
 * worth restoring through a full sign-in round trip.
 *
 * A HOOK, not a plain `window.location` read, because a `<Link search={{
 * next }}>` captures whatever this returned at its LAST render — a
 * search-only navigation (paging, sorting, filtering) that doesn't remount
 * the component carrying the link would otherwise leave it holding the
 * search string from before that change, so signing in would return to a
 * page whose query has since moved on. Subscribing through `useRouterState`
 * re-renders on exactly the change that matters (Astra review, PR #212).
 */
export function useCurrentPathAsNext(): string {
  return useRouterState({ select: (s) => `${s.location.pathname}${s.location.searchStr}` })
}
