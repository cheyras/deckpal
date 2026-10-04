/* ─────────────────────────────────────────────────────────────────────────────
 * The pure half of lib/seo.ts: the site's default metadata and the helpers that
 * build a page's. No imports, no DOM, no Vite env, so tests can load it as is.
 * ───────────────────────────────────────────────────────────────────────────── */

export const SITE_ORIGIN = 'https://deckpal.app'
export const SITE_NAME = 'DeckPal'

export type PageMeta = {
  /** The page's own title; " | DeckPal" is appended unless it already ends with it. */
  title: string
  /** One or two plain sentences that are true of what the page shows. */
  description?: string
  /** The path to canonicalize to. Defaults to the current pathname. */
  path?: string
  /** Keep this page out of search results (a real 404, search results, auth). */
  noindex?: boolean
  /**
   * False for a passing error state (a 5xx, a timeout): no canonical, but no
   * noindex either, so a crawl that hit a bad moment does not drop the page.
   */
  canonical?: boolean
}

/**
 * What every page shows when it sets nothing: the landing copy's `meta`, the
 * same words index.html carries. landingCopy.test.ts pins all three together.
 * Written out rather than imported, so the landing copy module stays off every
 * page that only needs a title.
 */
export const SITE_DEFAULTS = {
  title: 'AI Deck Builder for the Pokémon TCG | DeckPal',
  description:
    'Plan, playtest and tune Pokémon TCG decks with the AI you already use. It knows your whole collection. Pay what you want, $0 included.',
  ogTitle: 'DeckPal: plan, playtest and tune your Pokémon TCG decks with AI',
  ogDescription:
    'Connect your AI to your cards, decks and PTCG Live battle logs. Then work on the deck together and show up to league night confident.',
}

/** `/series/` and `/series` are one page. */
export function cleanPath(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

/**
 * A catalog path built from the record itself, encoded the way the sitemaps
 * build it (apps/api/src/sitemaps.ts). The router renders a card under any
 * series segment, so a canonical taken from the address bar would bless
 * `/series/anything/base1/4`; this one names the real series.
 */
export function catalogPath(...segments: string[]): string {
  return '/' + segments.map(encodeURIComponent).join('/')
}

/**
 * A record page's metadata when its read failed. A 404 is a page that does not
 * exist, so it is noindex. Anything else (a 5xx, a timeout, a cold start
 * mid-crawl) is passing: drop the canonical, but do not tell search engines to
 * forget a page they may already have.
 */
export function errorMeta(error: unknown, thing: string): PageMeta {
  const status = (error as { status?: unknown } | null)?.status
  return status === 404 ? { title: `${thing} not found`, noindex: true } : { title: `${thing} unavailable`, canonical: false }
}

export function fullTitle(title: string): string {
  return title.endsWith(`| ${SITE_NAME}`) || title === SITE_NAME ? title : `${title} | ${SITE_NAME}`
}
