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
 * A page that failed to find its record passes `noindex`, so a mistyped card
 * URL (which the SPA still answers with 200) is not indexed as a page.
 *
 * On unmount everything returns to index.html's values, captured once at load,
 * so a page without this hook never inherits the previous page's title.
 * ───────────────────────────────────────────────────────────────────────────── */
import { useEffect } from 'react'
import { isCloudMode } from './supabase'

export const SITE_ORIGIN = 'https://deckpal.app'
export const SITE_NAME = 'DeckPal'

export type PageMeta = {
  /** The page's own title; " | DeckPal" is appended unless it already ends with it. */
  title: string
  /** One or two plain sentences that are true of what the page shows. */
  description?: string
  /** The path to canonicalize to. Defaults to the current pathname. */
  path?: string
  /** Keep this page out of search results (not-found states, search results, auth). */
  noindex?: boolean
}

type Defaults = { title: string; description: string; ogTitle: string; ogDescription: string }

let defaults: Defaults | null = null

function meta(selector: string): HTMLMetaElement | null {
  return document.head.querySelector<HTMLMetaElement>(selector)
}

function captureDefaults(): Defaults {
  defaults ??= {
    title: document.title,
    description: meta('meta[name="description"]')?.content ?? '',
    ogTitle: meta('meta[property="og:title"]')?.content ?? '',
    ogDescription: meta('meta[property="og:description"]')?.content ?? '',
  }
  return defaults
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

export function fullTitle(title: string): string {
  return title.endsWith(`| ${SITE_NAME}`) || title === SITE_NAME ? title : `${title} | ${SITE_NAME}`
}

/** Apply a page's metadata now. Exported for tests; pages use `usePageMeta`. */
export function applyPageMeta(m: PageMeta, pathname: string): void {
  const d = captureDefaults()
  const title = fullTitle(m.title)
  const description = m.description ?? d.description
  document.title = title
  upsertMeta('name', 'description', description)
  upsertMeta('property', 'og:title', title)
  upsertMeta('property', 'og:description', description)
  upsertMeta('name', 'twitter:title', title)
  upsertMeta('name', 'twitter:description', description)
  upsertMeta('name', 'robots', m.noindex ? 'noindex' : null)
  const url = isCloudMode && !m.noindex ? SITE_ORIGIN + (m.path ?? pathname) : null
  upsertCanonical(url)
  upsertMeta('property', 'og:url', url)
}

export function resetPageMeta(): void {
  const d = captureDefaults()
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
  useEffect(() => {
    if (title === undefined) return
    applyPageMeta({ title, description, path, noindex }, window.location.pathname)
  }, [title, description, path, noindex])
  useEffect(() => resetPageMeta, [])
}
