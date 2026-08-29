// Typed search params for the list detail page. Like the set page, sort/view/
// ownership/query live in the URL (wiki: Frontend-Research §A.5). `custom` sort = the list's
// manual arrangement (list_item.position order).

import { pick, type SortDir, type ViewMode, type Ownership } from './searchParams'

export type ListSortKey = 'custom' | 'number' | 'name' | 'rarity' | 'price' | 'artist' | 'released'

export interface ListSearch {
  sort: ListSortKey
  dir: SortDir
  view: ViewMode
  own: Ownership
  q: string
  // `?card=<cardId>` opens the card-detail bottom-sheet OVER the list, the same
  // mechanism the set and species pages use. Keyed by the full card id (not the
  // number) because a list spans many sets — the species page has the same
  // property and makes the same choice. Absent unless a card is open, so it
  // never appears in a shared list URL.
  card?: string
}

export const LIST_SEARCH_DEFAULTS: ListSearch = {
  sort: 'custom',
  dir: 'asc',
  view: 'grid',
  own: 'all',
  q: '',
}

const SORTS: ListSortKey[] = ['custom', 'number', 'name', 'rarity', 'price', 'artist', 'released']
const DIRS: SortDir[] = ['asc', 'desc']
const VIEWS: ViewMode[] = ['grid', 'table', 'binder']
const OWNS: Ownership[] = ['all', 'have', 'need', 'dupes']

export function validateListSearch(raw: Record<string, unknown>): ListSearch {
  return {
    sort: pick(raw.sort, SORTS, LIST_SEARCH_DEFAULTS.sort),
    dir: pick(raw.dir, DIRS, LIST_SEARCH_DEFAULTS.dir),
    view: pick(raw.view, VIEWS, LIST_SEARCH_DEFAULTS.view),
    own: pick(raw.own, OWNS, LIST_SEARCH_DEFAULTS.own),
    q: typeof raw.q === 'string' ? raw.q : LIST_SEARCH_DEFAULTS.q,
    card: typeof raw.card === 'string' && raw.card ? raw.card : undefined,
  }
}
