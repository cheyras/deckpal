// Typed search params for the set page. Filter/sort/goal/view/ownership state
// lives in the URL, deliberately, so a filtered view is shareable and survives a
// reload (wiki: Frontend-Research §A.5).
// Defaults are stripped so the canonical URL stays clean.

import { pick, type SortDir, type ViewMode, type Ownership } from './searchParams'

export type SortKey = 'number' | 'name' | 'rarity' | 'price' | 'artist'
export type Goal = 'complete' | 'master' | 'grandmaster'
// Re-exported so existing importers (FilterControls and friends) keep working.
export type { SortDir, ViewMode, Ownership }

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

// Shared goal copy — used by FilterControls' goal switcher tooltip (full form)
// and ProgressCluster's goal badge (short form). One map each, so the two
// call sites can't drift (GitHub #30 cleanup).
export const GOAL_TITLE: Record<Goal, string> = {
  complete: 'Complete Set',
  master: 'Master Set',
  grandmaster: 'Grandmaster Set',
}
export const GOAL_SHORT_LABEL: Record<Goal, string> = {
  complete: 'Complete',
  master: 'Master',
  grandmaster: 'Grandmaster',
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
