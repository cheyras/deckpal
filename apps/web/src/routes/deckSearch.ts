// URL search state for the deck builder. Keeps the deck-list filter + sort in the
// URL (FRONTEND §A.5 idiom) so a view is shareable/bookmarkable.

export type DeckSortKey = 'section' | 'name' | 'quantity' | 'price'

export interface DeckSearch {
  q: string
  sort: DeckSortKey
}

export const DECK_SEARCH_DEFAULTS: DeckSearch = { q: '', sort: 'section' }

const SORTS: DeckSortKey[] = ['section', 'name', 'quantity', 'price']

export function validateDeckSearch(raw: Record<string, unknown>): DeckSearch {
  const q = typeof raw.q === 'string' ? raw.q : ''
  const sort = SORTS.includes(raw.sort as DeckSortKey) ? (raw.sort as DeckSortKey) : 'section'
  return { q, sort }
}
