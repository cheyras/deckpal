// Typed search params for the list detail page. Like the set page, sort/view/
// ownership/query live in the URL (FRONTEND.md §A.5). `custom` sort = the list's
// manual arrangement (list_item.position order).

export type ListSortKey = 'custom' | 'number' | 'name' | 'rarity' | 'price' | 'artist' | 'released'
export type SortDir = 'asc' | 'desc'
export type ViewMode = 'grid' | 'table' | 'binder'
export type Ownership = 'all' | 'have' | 'need' | 'dupes'

export interface ListSearch {
  sort: ListSortKey
  dir: SortDir
  view: ViewMode
  own: Ownership
  q: string
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

function pick<T extends string>(v: unknown, allowed: T[], dflt: T): T {
  return typeof v === 'string' && (allowed as string[]).includes(v) ? (v as T) : dflt
}

export function validateListSearch(raw: Record<string, unknown>): ListSearch {
  return {
    sort: pick(raw.sort, SORTS, LIST_SEARCH_DEFAULTS.sort),
    dir: pick(raw.dir, DIRS, LIST_SEARCH_DEFAULTS.dir),
    view: pick(raw.view, VIEWS, LIST_SEARCH_DEFAULTS.view),
    own: pick(raw.own, OWNS, LIST_SEARCH_DEFAULTS.own),
    q: typeof raw.q === 'string' ? raw.q : LIST_SEARCH_DEFAULTS.q,
  }
}
