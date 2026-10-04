/* ─────────────────────────────────────────────────────────────────────────────
 * Per-page <title>, description, canonical and robots for the public pages.
 *
 * Every route is served the same index.html, so without this every set, card
 * and species page shared the landing's title and description: one title for
 * twenty thousand pages, which search engines read as duplicates. Google runs
 * the page's JavaScript before indexing, so values set here are what it sees.
 * (Crawlers that do not run JavaScript get the prerendered documents written by
 * vite-plugins/landing-prerender.ts, for `/` and `/connect` only.)
 *
 * The canonical is the cloud origin plus the path, never the query string, so a
 * set page with filters or a card sheet open still points at the one page. It
 * is cloud-only: a self-hosted DeckPal is not deckpal.app and is not crawled.
 * A real 404 passes `noindex` (`errorMeta`), so a mistyped card URL, which the
 * SPA still answers with 200, is not indexed as a page.
 *
 * On unmount everything returns to SITE_DEFAULTS (lib/siteMeta.ts), so a page
 * without this hook never inherits the previous page's title. The defaults are
 * not read back from the document, because the first document of a visit may
 * be a prerendered one with another page's title (connect.html).
 * ───────────────────────────────────────────────────────────────────────────── */
import { useEffect } from 'react'
import { cleanPath, fullTitle, SITE_DEFAULTS, SITE_ORIGIN, type PageMeta } from './siteMeta'
import { isCloudMode } from './supabase'

export { catalogPath, errorMeta, fullTitle, SITE_DEFAULTS, SITE_NAME, SITE_ORIGIN, type PageMeta } from './siteMeta'

function meta(selector: string): HTMLMetaElement | null {
  return document.head.querySelector<HTMLMetaElement>(selector)
}

function upsertMeta(attr: 'name' | 'property', key: string, content: string | null): void {
  let el = meta(`meta[${attr}="${key}"]`)
  if (content === null) {
    el?.remove()
    return
  }
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.content = content
}

function upsertCanonical(href: string | null): void {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (href === null) {
    el?.remove()
    return
  }
  if (!el) {
    el = document.createElement('link')
    el.rel = 'canonical'
    document.head.appendChild(el)
  }
  el.href = href
}

/** Apply a page's metadata now. Exported for tests; pages use `usePageMeta`. */
export function applyPageMeta(m: PageMeta, pathname: string): void {
  const title = fullTitle(m.title)
  const description = m.description ?? SITE_DEFAULTS.description
  document.title = title
  upsertMeta('name', 'description', description)
  upsertMeta('property', 'og:title', title)
  upsertMeta('property', 'og:description', description)
  upsertMeta('name', 'twitter:title', title)
  upsertMeta('name', 'twitter:description', description)
  upsertMeta('name', 'robots', m.noindex ? 'noindex' : null)
  const url = isCloudMode && !m.noindex && m.canonical !== false ? SITE_ORIGIN + cleanPath(m.path ?? pathname) : null
  upsertCanonical(url)
  upsertMeta('property', 'og:url', url)
}

export function resetPageMeta(): void {
  const d = SITE_DEFAULTS
  document.title = d.title
  upsertMeta('name', 'description', d.description)
  upsertMeta('property', 'og:title', d.ogTitle)
  upsertMeta('property', 'og:description', d.ogDescription)
  upsertMeta('name', 'twitter:title', d.ogTitle)
  upsertMeta('name', 'twitter:description', d.ogDescription)
  upsertMeta('name', 'robots', null)
  upsertCanonical(null)
  upsertMeta('property', 'og:url', null)
}

/**
 * Set this page's metadata while it is mounted. Pass `null` while the page's
 * data is still loading, so the previous values are not briefly mislabelled.
 */
export function usePageMeta(m: PageMeta | null): void {
  const title = m?.title
  const description = m?.description
  const path = m?.path
  const noindex = m?.noindex
  const canonical = m?.canonical
  useEffect(() => {
    if (title === undefined) return
    applyPageMeta({ title, description, path, noindex, canonical }, window.location.pathname)
  }, [title, description, path, noindex, canonical])
  useEffect(() => resetPageMeta, [])
}
