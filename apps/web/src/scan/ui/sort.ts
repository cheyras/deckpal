// WHAT ORDER THE VERIFY LIST IS IN, and who decides.
//
// ── THE 2026-09-07 RULING ───────────────────────────────────────────────────
//
// The owner, from a phone field test: "default should be first one scanned is
// on top, in order of scan".
//
// The list had rendered newest-first since it was built, mirroring the incoming
// stack it came off — which is the right story for the CAMERA step, where the
// thing that just landed is the thing you are looking at, and the wrong one for
// the verify step, where the reader is working through a pile in the order they
// put it there. Newest-first meant the row they were about to check kept moving
// down the screen under them.
//
// So the default flips, and because the flip makes the question visible at all,
// the reader gets to answer it themselves: scan order either way, or catalog
// order either way.
//
// ── THE TWO KEYS ────────────────────────────────────────────────────────────
//
//   scan     the order the shutter fired. NOT `capturedAt` — the array's own
//            order, which `feed.addArrival` appends to. Two captures can share
//            a millisecond and a sort that compares timestamps would be free to
//            swap them on any re-render; the array cannot.
//
//   catalog  "series then set then collector number", which is the order the
//            cards are in in the binder the reader is filling. A feed row knows
//            its `setId` and its `number` and nothing else about the catalog —
//            there is no series on a `ScanMatch` and fetching one would be a
//            round trip per row to sort a list — so the series comes out of the
//            set id's own shape: TCGdex ids are `<series><n>` (`sv10`, `swsh12`,
//            `base1`), so a NATURAL compare on the id groups every `sv` set
//            together and orders them 1, 2, … 10 rather than 1, 10, 2. That is
//            series-then-set for every id the catalog actually has, derived
//            rather than looked up, and `setName` breaks the tie if two sets
//            ever shared an id shape.
//
// ── AND WHERE THE UNNAMED ROWS GO ───────────────────────────────────────────
//
// A row with no card has no place in catalog order — no set, no number, nothing
// to compare. It could sort to the bottom as an empty string, and that is
// exactly the wrong answer: those are the rows that need the reader, they are
// the ones `commitGate` will stop the write over, and burying them under fifty
// identified cards is how a reader commits without them. THEY GROUP AT THE TOP,
// in scan order among themselves, and they stay at the top in both directions —
// reversing catalog order is a statement about the catalog, not a request to
// hide the questions.
//
// Scan order does NOT do this. There, an unnamed row's place in the sequence is
// real information (it is the third card you scanned) and the reader is entitled
// to it.
import type { FeedEntry } from './types'

export type SortKey = 'scan' | 'catalog'
export type SortDir = 'asc' | 'desc'

export interface FeedSort {
  key: SortKey
  dir: SortDir
}

/** First scanned on top — the ruling's own default. */
export const DEFAULT_SORT: FeedSort = { key: 'scan', dir: 'asc' }

/**
 * Every option the control offers, in the order it offers them.
 *
 * Here rather than in the JSX so the labels and the values cannot drift apart,
 * and so a test can assert that the default is one of them.
 */
export const SORT_OPTIONS: readonly { value: string; sort: FeedSort; label: string }[] = [
  { value: 'scan-asc', sort: { key: 'scan', dir: 'asc' }, label: 'Scan order' },
  { value: 'scan-desc', sort: { key: 'scan', dir: 'desc' }, label: 'Newest first' },
  { value: 'catalog-asc', sort: { key: 'catalog', dir: 'asc' }, label: 'Set order' },
  { value: 'catalog-desc', sort: { key: 'catalog', dir: 'desc' }, label: 'Set order, reversed' },
]

export function sortValue(sort: FeedSort): string {
  return `${sort.key}-${sort.dir}`
}

/** Parse a stored or submitted value back to a sort, defaulting rather than
 *  throwing — a stale localStorage entry from a build that offered a different
 *  option must not be able to break the list. */
export function parseSortValue(raw: string | null | undefined): FeedSort {
  const found = SORT_OPTIONS.find((o) => o.value === raw)
  return found ? found.sort : DEFAULT_SORT
}

/** The one localStorage key the choice is remembered under.
 *
 *  PERSISTED, not component state, and deliberately: the verify list is
 *  rendered by TWO `VerifyFeed`s (Step 1's collapsed bin and Step 2's full
 *  screen), the reader crosses between them constantly, and a per-component
 *  state would let the two disagree about the order of one list. The live value
 *  is owned once, in `Scan.tsx`, and this is only where it survives a reload —
 *  a preference about how to read a list is not worth re-teaching the app every
 *  session. */
export const SORT_STORAGE_KEY = 'deckpal.scan.feedSort'

export function loadSort(): FeedSort {
  try {
    return parseSortValue(window.localStorage.getItem(SORT_STORAGE_KEY))
  } catch {
    // Private mode, a blocked origin, no `window` at all. A list that cannot
    // remember its order is fine; a scanner that will not render is not.
    return DEFAULT_SORT
  }
}

export function saveSort(sort: FeedSort): void {
  try {
    window.localStorage.setItem(SORT_STORAGE_KEY, sortValue(sort))
  } catch {
    /* see loadSort */
  }
}

/**
 * Compare two strings the way a human reads an identifier that has numbers in
 * it: `sv2` before `sv10`, `4` before `11`, `TG12` after `TG9`.
 *
 * Written out rather than `localeCompare(…, { numeric: true })` because that
 * option's behaviour varies by ICU build and this decides what a list looks
 * like — a comparator whose answer depends on the device is a comparator no
 * test can hold.
 */
export function naturalCompare(a: string, b: string): number {
  const chunks = (s: string) => s.toLowerCase().match(/\d+|\D+/g) ?? []
  const ac = chunks(a)
  const bc = chunks(b)
  for (let i = 0; i < Math.max(ac.length, bc.length); i += 1) {
    const x = ac[i]
    const y = bc[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xn = /^\d/.test(x)
    const yn = /^\d/.test(y)
    if (xn && yn) {
      const d = Number(x) - Number(y)
      if (d !== 0) return d < 0 ? -1 : 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

/** The fields the order is a function of. Structural so a test can sort four
 *  literals without building four whole `FeedEntry`s. */
export type SortableRow = Pick<FeedEntry, 'cardId' | 'setId' | 'setName' | 'number'>

/**
 * The list, in the order the reader asked for.
 *
 * Returns a NEW array and never mutates the input: the feed's own array order is
 * the scan order (`feed.addArrival` appends to it), so a sort that reordered it
 * in place would destroy the very thing "scan order" is read from.
 *
 * The direction is applied by reversing a single ascending pass rather than by
 * flipping the comparator, so `desc` is exactly `asc` backwards — including for
 * rows the comparator calls equal, which a flipped comparator would leave in
 * ascending order inside each tie and produce an order that is neither.
 */
export function sortRows<T extends SortableRow>(rows: readonly T[], sort: FeedSort): T[] {
  if (sort.key === 'scan') {
    return sort.dir === 'asc' ? [...rows] : [...rows].reverse()
  }

  // Index carried alongside so an ascending pass can fall back to scan order for
  // rows the catalog cannot separate — two scans of the same card, most often.
  const indexed = rows.map((row, i) => ({ row, i }))
  indexed.sort((a, b) => {
    const d = compareCatalog(a.row, b.row)
    return d !== 0 ? d : a.i - b.i
  })
  const ordered = indexed.map((x) => x.row)
  if (sort.dir === 'asc') return ordered

  // Unnamed rows are pinned to the top in BOTH directions (see the header): the
  // reversal is a statement about catalog order, not a request to bury the rows
  // that still need an answer.
  const unnamed = ordered.filter((r) => r.cardId === null)
  const named = ordered.filter((r) => r.cardId !== null)
  return [...unnamed, ...named.reverse()]
}

function compareCatalog(a: SortableRow, b: SortableRow): number {
  const au = a.cardId === null
  const bu = b.cardId === null
  if (au !== bu) return au ? -1 : 1
  if (au && bu) return 0
  const bySet = naturalCompare(a.setId ?? '', b.setId ?? '')
  if (bySet !== 0) return bySet
  const byName = naturalCompare(a.setName, b.setName)
  if (byName !== 0) return byName
  return naturalCompare(a.number, b.number)
}
