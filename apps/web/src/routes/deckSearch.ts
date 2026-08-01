// URL search state for the deck builder. Keeps the deck-list filter + sort and
// the active tab in the URL (FRONTEND §A.5 idiom) so a view is shareable/
// bookmarkable. Defaults are stripped by the route's search middleware.

export type DeckSortKey = 'section' | 'name' | 'quantity' | 'price'
export type DeckTab = 'cards' | 'strategy' | 'battles' | 'history'

export interface DeckSearch {
  q: string
  sort: DeckSortKey
  tab: DeckTab
  /** Narrow the deck list to cards where owned < quantity. Off by default. */
  missing: boolean
}

export const DECK_SEARCH_DEFAULTS: DeckSearch = { q: '', sort: 'section', tab: 'cards', missing: false }

const SORTS: DeckSortKey[] = ['section', 'name', 'quantity', 'price']
const TABS: DeckTab[] = ['cards', 'strategy', 'battles', 'history']

export function validateDeckSearch(raw: Record<string, unknown>): DeckSearch {
  const q = typeof raw.q === 'string' ? raw.q : ''
  const sort = SORTS.includes(raw.sort as DeckSortKey) ? (raw.sort as DeckSortKey) : 'section'
  const tab = TABS.includes(raw.tab as DeckTab) ? (raw.tab as DeckTab) : 'cards'
  const missing = raw.missing === true || raw.missing === 'true'
  return { q, sort, tab, missing }
}
