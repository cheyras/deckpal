// Typed search params for the set page. Filter/sort/goal/view/ownership state
// lives in the URL (a deliberate divergence from pkmn.gg — FRONTEND.md §A.5).
// Defaults are stripped so the canonical URL stays clean.

export type SortKey = 'number' | 'name' | 'rarity' | 'price' | 'artist'
export type SortDir = 'asc' | 'desc'
export type ViewMode = 'grid' | 'table' | 'binder'
export type Goal = 'complete' | 'master' | 'grandmaster'
export type Ownership = 'all' | 'have' | 'need' | 'dupes'

export interface CardSearch {
  sort: SortKey
  dir: SortDir
  view: ViewMode
  goal: Goal
  own: Ownership
  q: string
  page: number
  // Open card detail as a bottom-sheet over the set page. Not part of the
  // stripped defaults, so it only appears in the URL while a card is open;
  // toggling it is a search-param change that never unmounts SetDetail, which
  // is what preserves scroll/filter state when the sheet closes.
  card?: string
}

export const CARD_SEARCH_DEFAULTS: CardSearch = {
  sort: 'number',
  dir: 'asc',
  view: 'grid',
  goal: 'complete',
  own: 'all',
  q: '',
  page: 1,
}

const SORTS: SortKey[] = ['number', 'name', 'rarity', 'price', 'artist']
const DIRS: SortDir[] = ['asc', 'desc']
const VIEWS: ViewMode[] = ['grid', 'table', 'binder']
const GOALS: Goal[] = ['complete', 'master', 'grandmaster']
const OWNS: Ownership[] = ['all', 'have', 'need', 'dupes']

function pick<T extends string>(v: unknown, allowed: T[], dflt: T): T {
  return typeof v === 'string' && (allowed as string[]).includes(v) ? (v as T) : dflt
}

// validateSearch: returns fully-typed, defaulted search. TanStack Router feeds
// raw parsed params in; we normalise. Combined with stripping in the component,
// only deviations from default appear in the URL.
export function validateCardSearch(raw: Record<string, unknown>): CardSearch {
  const pageNum = Number(raw.page)
  return {
    sort: pick(raw.sort, SORTS, CARD_SEARCH_DEFAULTS.sort),
    dir: pick(raw.dir, DIRS, CARD_SEARCH_DEFAULTS.dir),
    view: pick(raw.view, VIEWS, CARD_SEARCH_DEFAULTS.view),
    goal: pick(raw.goal, GOALS, CARD_SEARCH_DEFAULTS.goal),
    own: pick(raw.own, OWNS, CARD_SEARCH_DEFAULTS.own),
    q: typeof raw.q === 'string' ? raw.q : CARD_SEARCH_DEFAULTS.q,
    page: Number.isInteger(pageNum) && pageNum > 0 ? pageNum : 1,
    card: typeof raw.card === 'string' && raw.card ? raw.card : undefined,
  }
}

// Strip default-valued params → clean canonical URL (equivalent of
// stripSearchParams). Returns only the deviating keys.
export function stripDefaults(s: CardSearch): Partial<CardSearch> {
  const out: Partial<CardSearch> = {}
  ;(Object.keys(CARD_SEARCH_DEFAULTS) as (keyof CardSearch)[]).forEach((k) => {
    if (s[k] !== CARD_SEARCH_DEFAULTS[k]) (out as Record<string, unknown>)[k] = s[k]
  })
  return out
}
