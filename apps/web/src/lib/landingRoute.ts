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
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '')
  let rest = pathname
  if (base && (rest === base || rest.startsWith(`${base}/`))) rest = rest.slice(base.length)
  return rest.replace(/\/+$/, '') === ''
}
