// Typed search params for the global (cross-set) search page. Mirrors the
// conventions in setSearch.ts: state lives in the URL, defaults are stripped so
// the canonical URL only carries deviations.

import { pick } from './searchParams'

export type GlobalSortKey = 'name' | 'number' | 'price' | 'rarity' | 'released'
type GlobalSortDir = 'asc' | 'desc'

export interface GlobalSearch {
  q: string
  sort: GlobalSortKey
  dir: GlobalSortDir
  page: number
}

export const GLOBAL_SEARCH_DEFAULTS: GlobalSearch = {
  q: '',
  sort: 'name',
  dir: 'asc',
  page: 1,
}

// Must stay a subset of the API's SORT_COLUMNS (apps/api/src/routes/search.ts).
const SORTS: GlobalSortKey[] = ['name', 'number', 'price', 'rarity', 'released']
const DIRS: GlobalSortDir[] = ['asc', 'desc']

export function validateGlobalSearch(raw: Record<string, unknown>): GlobalSearch {
  const pageNum = Number(raw.page)
  return {
    q: typeof raw.q === 'string' ? raw.q : GLOBAL_SEARCH_DEFAULTS.q,
    sort: pick(raw.sort, SORTS, GLOBAL_SEARCH_DEFAULTS.sort),
    dir: pick(raw.dir, DIRS, GLOBAL_SEARCH_DEFAULTS.dir),
    page: Number.isInteger(pageNum) && pageNum > 0 ? pageNum : 1,
  }
}
