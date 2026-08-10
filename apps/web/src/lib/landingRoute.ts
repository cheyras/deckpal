// Is this pathname the public marketing landing (the app's index route)?
//
// Both RootComponent (which must NOT wrap the landing in AuthGuard) and
// AppShell (which must render it chrome-free) need this answer, and they each
// only have the router's pathname to hand — hence one shared predicate rather
// than two subtly different string tests.
//
// The router's `location.pathname` carries the deploy's base path in the
// self-host build (`/deckscout`) and not in the cloud build (`/`), so the base
// is stripped first and what's left has to be empty. That makes `/deckscout`,
// `/deckscout/` and `/` all landing, while `/series` and `/deckscout/series`
// are not.
export function isLandingPathname(pathname: string): boolean {
  return stripBase(pathname) === ''
}

/** Strips the deploy's base path and any trailing slash. `/deckscout/auth` → `/auth`. */
function stripBase(pathname: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '')
  let rest = pathname
  if (base && (rest === base || rest.startsWith(`${base}/`))) rest = rest.slice(base.length)
  return rest.replace(/\/+$/, '')
}

// Every route a logged-OUT visitor is allowed to see. Three call sites need the
// same answer and MUST agree, or the answer is worse than useless:
//   • RootComponent (main.tsx) — must not wrap these in AuthGuard, or a
//     logged-out visitor is bounced off the very page they were sent to.
//   • AppShell — must render these chrome-free. The nav mounts ProfileChip,
//     whose overview query 401s while signed out → handle401 →
//     location.assign('/auth') → reload → 401 … the loop that api.ts's guard
//     exists to break.
//   • api.ts handle401 — must not hard-redirect away from one of these.
// Hence one predicate, not three string tests that drift apart.
const PUBLIC_PATHS = new Set([
  '/auth', // sign in / sign up / forgot password
  '/auth/reset', // password-recovery link target
  '/signed-out', // post-sign-out confirmation
  '/overlay', // OBS browser source
])

export function isPublicPathname(pathname: string): boolean {
  const rest = stripBase(pathname)
  return rest === '' || PUBLIC_PATHS.has(rest)
}
