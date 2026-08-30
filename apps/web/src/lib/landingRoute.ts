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
  '/auth/invite', // invitation acceptance and initial password setup
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

// A same-origin relative path, safe to hand to `navigate`/`window.location`
// as a post-sign-in redirect target (currently /auth's `next` param, set by
// /authorize). `//host/...` and `/\host/...` are both browser-recognised
// spellings of a protocol-relative URL to a DIFFERENT origin — a leading
// backslash is silently treated as a forward slash by every major browser's
// URL parser, so `/\evil.com` resolves exactly like `//evil.com` even though
// neither `startsWith('http')` nor `startsWith('//')` would catch it. One
// predicate, used everywhere `next` is both written (validateSearch) and read
// (Auth.tsx) — the whole point is that those two checks cannot drift apart.
export function isSafeNextPath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')
}
