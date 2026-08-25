// Shared plumbing for the typed URL-search-param modules (setSearch, listSearch,
// globalSearch, deckSearch). Only the parts that were copy-pasted verbatim live
// here: the one `pick` validator and the unions the set and list pages share.
// Each page keeps its own sort-key union and defaults — those genuinely differ.

export type SortDir = 'asc' | 'desc'
export type ViewMode = 'grid' | 'table' | 'binder'
export type Ownership = 'all' | 'have' | 'need' | 'dupes'

export function pick<T extends string>(v: unknown, allowed: T[], dflt: T): T {
  return typeof v === 'string' && (allowed as string[]).includes(v) ? (v as T) : dflt
}
