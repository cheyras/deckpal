/**
 * Vercel Routing Middleware: serve the prerendered documents for `/` and
 * `/connect`.
 *
 * Every route is a client-rendered React page, so a crawler that does not run
 * JavaScript used to get only the boot skeleton. The build writes the landing
 * and the connect page as real HTML (`landing.html` and `connect.html`, by
 * apps/web/vite-plugins/landing-prerender.ts), each with its own title,
 * description, canonical and JSON-LD. A vercel.json rewrite cannot route `/` to
 * one of them, because Vercel serves the real `index.html` before it applies
 * rewrites (checked on a preview, 2026-10-04). Middleware runs before that file
 * check, so it can.
 *
 * Both documents are the same SPA shell with the page's words added inside
 * `#root`. React replaces them on its first render, so a person gets the same
 * app as on every other route.
 *
 * The matcher is only these two exact paths, so nothing else pays for a
 * middleware invocation, and the documents themselves are never matched, so a
 * rewrite can never loop. A direct request for `/landing.html` still works, and
 * its canonical points at `/`. The query string is kept, because sign-in and
 * referral links carry one.
 */
import { rewrite } from '@vercel/functions'

export const config = { matcher: ['/', '/connect'] }

const PRERENDERED: Record<string, string> = {
  '/': '/landing.html',
  '/connect': '/connect.html',
}

export default function middleware(request: Request): Response | undefined {
  const url = new URL(request.url)
  const doc = PRERENDERED[url.pathname]
  if (!doc) return undefined
  return rewrite(new URL(doc + url.search, url))
}
