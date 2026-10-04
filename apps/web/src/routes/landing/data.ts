/* Demo data for the landing page. Plain data plus two tiny live fetches.
 *
 * THE SAMPLE DECK is a real, Standard-legal list (checked with check_deck on
 * 2026-10-03): Mega Chandelure ex / Dusknoir. It is the deck in the photographs,
 * the deck the opening-hand toy draws from, and the deck whose missing cards the
 * Build demo prices. Change it in one place and check it again.
 *
 * PRICES are fetched live from the public catalog (api.card, anonymous and
 * publicly cached) when the Build section scrolls near; the numbers below are the
 * fallback, recorded the same day, so the demo never shows an empty cart. */
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { directArtUrl } from '../../lib/cardArt'

export type Kind = 'basic' | 'stage1' | 'stage2' | 'supporter' | 'item' | 'tool' | 'stadium' | 'energy'
export type DeckLine = { id: string; name: string; qty: number; kind: Kind }

export const SAMPLE_DECK: readonly DeckLine[] = [
  { id: 'me05-036', name: 'Litwick', qty: 4, kind: 'basic' },
  { id: 'me05-037', name: 'Lampent', qty: 3, kind: 'stage1' },
  { id: 'me05-038', name: 'Mega Chandelure ex', qty: 3, kind: 'stage2' },
  { id: 'sv08.5-035', name: 'Duskull', qty: 3, kind: 'basic' },
  { id: 'sv08.5-036', name: 'Dusclops', qty: 2, kind: 'stage1' },
  { id: 'sv08.5-037', name: 'Dusknoir', qty: 2, kind: 'stage2' },
  { id: 'me02.5-192', name: "Lillie's Determination", qty: 4, kind: 'supporter' },
  { id: 'me01-114', name: "Boss's Orders", qty: 2, kind: 'supporter' },
  { id: 'sv10.5w-084', name: 'Hilda', qty: 2, kind: 'supporter' },
  { id: 'me02.5-184', name: 'Buddy-Buddy Poffin', qty: 4, kind: 'item' },
  { id: 'me02.5-213', name: 'Ultra Ball', qty: 4, kind: 'item' },
  { id: 'me01-125', name: 'Rare Candy', qty: 4, kind: 'item' },
  { id: 'me02.5-196', name: 'Night Stretcher', qty: 2, kind: 'item' },
  { id: 'me01-130', name: 'Switch', qty: 2, kind: 'item' },
  { id: 'me03-081', name: 'Poké Pad', qty: 2, kind: 'item' },
  { id: 'sv10.5b-079', name: 'Air Balloon', qty: 2, kind: 'tool' },
  { id: 'me03-082', name: 'Pokémon Catcher', qty: 1, kind: 'item' },
  { id: 'me03-077', name: 'Lumiose City', qty: 2, kind: 'stadium' },
  { id: 'mee-005', name: 'Psychic Energy', qty: 12, kind: 'energy' },
]

/** Image path for a catalog id, low (245px) or high (600px). */
export function artUrl(id: string, size: 'low' | 'high' = 'low'): string {
  const cut = id.lastIndexOf('-')
  const set = id.slice(0, cut)
  const num = id.slice(cut + 1)
  const serie = set.replace(/^([a-z]+).*$/, '$1').replace(/^mee$/, 'me')
  const path = `/deckpal/images/en/${serie}/${set}/${num}/${size}.webp`
  return directArtUrl(path) ?? path
}

/** Owned counts in the example account, for the Plan demo's ownership markers. */
export const OWNED: Record<string, number> = {
  'me05-036': 4,
  'me05-037': 3,
  'me05-038': 0,
  'sv08.5-035': 2,
  'sv08.5-036': 0,
  'sv08.5-037': 0,
  'me01-125': 1,
  'me03-077': 1,
}

/** What the example account is missing, priced at the cheapest printing. */
export type MissingLine = { id: string; name: string; qty: number; set: string; price: number }
export const MISSING: readonly MissingLine[] = [
  { id: 'me05-038', name: 'Mega Chandelure ex', qty: 3, set: 'Pitch Black', price: 0.91 },
  { id: 'sv08.5-037', name: 'Dusknoir', qty: 2, set: 'Prismatic Evolutions', price: 0.25 },
  { id: 'sv08.5-036', name: 'Dusclops', qty: 2, set: 'Prismatic Evolutions', price: 0.22 },
  { id: 'me01-125', name: 'Rare Candy', qty: 3, set: 'Mega Evolution', price: 0.26 },
  { id: 'sv08.5-035', name: 'Duskull', qty: 1, set: 'Prismatic Evolutions', price: 0.23 },
  { id: 'me03-077', name: 'Lumiose City', qty: 1, set: 'Perfect Order', price: 0.18 },
]

/** The three Pitch Black printings of Mega Chandelure ex. Same rules text, same
 *  350 HP, same regulation mark J (verified against the catalog 2026-10-03). */
export const PRINTINGS = [
  { id: 'me05-038', rarity: 'Double Rare', number: '038', price: 0.91 },
  { id: 'me05-099', rarity: 'Ultra Rare', number: '099', price: 6.42 },
  { id: 'me05-115', rarity: 'Special Illustration Rare', number: '115', price: 37.59 },
] as const

/** A PTCG Live battle log, abridged, in the format the parser reads. */
export const LOG_EXCERPT: readonly string[] = [
  'Setup',
  'Tamsin won the coin toss.',
  'Tamsin decided to go first.',
  "Chey's Turn",
  'Chey played Rare Candy.',
  '- Chey evolved Litwick to Mega Chandelure ex in the Active Spot.',
  "Tamsin's Turn",
  "Tamsin's Dragapult ex used Phantom Dive on Chey’s Mega Chandelure ex for 200 damage.",
  '…',
  "Tamsin's Dragapult ex used Phantom Dive on Chey’s Mega Chandelure ex for 200 damage.",
  "Chey's Mega Chandelure ex was Knocked Out!",
  'Tamsin took 3 Prize cards.',
  'All Prize cards taken. Tamsin wins.',
]

/* ── live catalog ─────────────────────────────────────────────────────────── */

export type Catalog = { cards: number; sets: number }
export const CATALOG_FALLBACK: Catalog = { cards: 21290, sets: 205 }

/** Card and set totals from the public series index. */
export function useLiveCatalog(): Catalog {
  const [cat, setCat] = useState<Catalog>(CATALOG_FALLBACK)
  useEffect(() => {
    const ctl = new AbortController()
    api
      .series(ctl.signal)
      .then((j) => {
        const s = j?.series
        if (!s?.length) return
        const cards = s.reduce((a, x) => a + (x.cardCount || 0), 0)
        const sets = s.reduce((a, x) => a + (x.setCount || 0), 0)
        if (cards > 1000 && sets > 10) setCat({ cards, sets })
      })
      .catch(() => {})
    return () => ctl.abort()
  }, [])
  return cat
}

/** Cheapest TCGplayer market price per id, live; ids that fail keep their fallback. */
export function useLivePrices(ids: readonly string[], enabled: boolean): Record<string, number> {
  const [prices, setPrices] = useState<Record<string, number>>({})
  const key = ids.join(',')
  useEffect(() => {
    if (!enabled) return
    const ctl = new AbortController()
    Promise.all(
      key.split(',').map((id) =>
        api
          .card(id, ctl.signal)
          .then((j) => {
            const all = (j?.variants ?? []).flatMap((v) => v.prices ?? [])
            const tcg = all.filter((p) => p.source === 'tcgcsv' && typeof p.market === 'number' && p.market > 0)
            const min = tcg.length ? Math.min(...tcg.map((p) => p.market as number)) : null
            return [id, min] as const
          })
          .catch(() => [id, null] as const),
      ),
    ).then((rows) => {
      if (ctl.signal.aborted) return
      const out: Record<string, number> = {}
      for (const [id, p] of rows) if (p != null) out[id] = p
      setPrices(out)
    })
    return () => ctl.abort()
  }, [key, enabled])
  return prices
}

/* ── photographs ──────────────────────────────────────────────────────────── */

/** The eight landing photographs (apps/web/public/marketing/landing, see its
 *  MANIFEST.json and tools/landing-photos). Widths are what was encoded. */
export const PHOTOS = {
  hero: { widths: [2560, 1600, 960], w: 3, h: 2 },
  plan: { widths: [1600, 960, 640], w: 4, h: 3 },
  playtest: { widths: [1600, 960, 640], w: 4, h: 3 },
  tune: { widths: [1600, 960, 640], w: 4, h: 3 },
  build: { widths: [1600, 960, 640], w: 4, h: 3 },
  ask: { widths: [1600, 960, 640], w: 3, h: 2 },
  github: { widths: [1600, 960], w: 3, h: 1 },
  closing: { widths: [2560, 1600, 960], w: 7, h: 3 },
} as const
export type PhotoName = keyof typeof PHOTOS

export const srcSet = (name: PhotoName, fmt: 'avif' | 'webp'): string =>
  PHOTOS[name].widths.map((w) => `/marketing/landing/${name}-${w}.${fmt} ${w}w`).join(', ')
