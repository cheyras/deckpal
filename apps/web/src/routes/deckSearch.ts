// URL search state for the deck builder. Keeps the deck-list filter + sort and
// the active tab in the URL (FRONTEND §A.5 idiom) so a view is shareable/
// bookmarkable. Defaults are stripped by the route's search middleware.

import { pick } from './searchParams'

type DeckSortKey = 'section' | 'name' | 'quantity' | 'price'
export type DeckTab = 'cards' | 'strategy' | 'battles' | 'history'

export interface DeckSearch {
  q: string
  sort: DeckSortKey
  tab: DeckTab
  /** Narrow the deck list to cards where owned < quantity. Off by default. */
  missing: boolean
  /**
   * Open the deck-scoped card sheet over the builder. Holds a full cardId (deck
   * cards span many sets, unlike the set page's bare number). Not in the
   * stripped defaults, so it only appears while a sheet is open — toggling it
   * never unmounts DeckBuilder, preserving scroll and filter state.
   */
  card?: string
}

export const DECK_SEARCH_DEFAULTS: DeckSearch = { q: '', sort: 'section', tab: 'cards', missing: false }

const SORTS: DeckSortKey[] = ['section', 'name', 'quantity', 'price']
const TABS: DeckTab[] = ['cards', 'strategy', 'battles', 'history']

export function validateDeckSearch(raw: Record<string, unknown>): DeckSearch {
  const q = typeof raw.q === 'string' ? raw.q : ''
  const sort = pick(raw.sort, SORTS, 'section')
  const tab = pick(raw.tab, TABS, 'cards')
  const missing = raw.missing === true || raw.missing === 'true'
  const card = typeof raw.card === 'string' && raw.card ? raw.card : undefined
  return { q, sort, tab, missing, card }
}
