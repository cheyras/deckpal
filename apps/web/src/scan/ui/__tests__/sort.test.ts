// Run: node --import tsx --test src/scan/ui/__tests__/*.test.ts
//
// WHAT ORDER THE VERIFY LIST IS IN.
//
// Owner ruling, 2026-09-07, from a phone field test: "default should be first
// one scanned is on top, in order of scan" — plus a control for the other
// orders, because the flip made the question visible.
//
// The four things worth holding the shipping code to, all of them things that
// were wrong or absent before:
//
//   * the DEFAULT is first-scanned-first, and it is the array's own order
//     rather than a timestamp comparison (two captures can share a millisecond);
//   * catalog order groups a SERIES together and counts its sets 1, 2, … 10 —
//     which a plain string compare does not, and which is the only reason
//     `naturalCompare` is written out instead of borrowed from `localeCompare`;
//   * unnamed rows are pinned to the TOP of catalog order in BOTH directions,
//     because they are the rows the commit gate will stop the write over and
//     burying them is how a reader commits without them;
//   * and nothing here mutates the feed, because the feed's array order IS the
//     scan order every one of these reads from.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DEFAULT_SORT,
  naturalCompare,
  parseSortValue,
  sortRows,
  sortValue,
  SORT_OPTIONS,
  type SortableRow,
} from '../sort'

/** Only the fields the order is a function of — which is the whole signature of
 *  `sortRows`, on purpose: an order that consulted `confidence` or `verified`
 *  would be an order the reader did not ask for. */
function row(id: string, over: Partial<SortableRow> = {}): SortableRow & { id: string } {
  return { id, cardId: `card-${id}`, setId: 'sv10', setName: 'Destined Rivals', number: '1', ...over }
}
function unnamed(id: string): SortableRow & { id: string } {
  return { id, cardId: null, setId: null, setName: '', number: '' }
}
const ids = (rows: readonly { id: string }[]) => rows.map((r) => r.id)

describe('the default', () => {
  it('IS FIRST-SCANNED-ON-TOP — the ruling’s own words', () => {
    assert.deepEqual(DEFAULT_SORT, { key: 'scan', dir: 'asc' })
    const feed = [row('a'), row('b'), row('c')]
    assert.deepEqual(ids(sortRows(feed, DEFAULT_SORT)), ['a', 'b', 'c'])
  })

  it('is one of the options the control offers', () => {
    // A default the reader cannot get back to by picking it is a trap.
    assert.ok(SORT_OPTIONS.some((o) => o.value === sortValue(DEFAULT_SORT)))
  })

  it('is what an unknown or missing stored value falls back to', () => {
    // A stale localStorage entry from a build with different options must not be
    // able to break the list.
    assert.deepEqual(parseSortValue(null), DEFAULT_SORT)
    assert.deepEqual(parseSortValue('by-vibes'), DEFAULT_SORT)
    assert.deepEqual(parseSortValue('catalog-desc'), { key: 'catalog', dir: 'desc' })
  })

  it('round-trips every option through its stored value', () => {
    for (const o of SORT_OPTIONS) assert.deepEqual(parseSortValue(sortValue(o.sort)), o.sort)
  })
})

describe('scan order', () => {
  it('reads the ARRAY, not the clock', () => {
    // Two captures in one millisecond are ordered by the array `addArrival`
    // appended to; a comparison on `capturedAt` would be free to swap them on
    // any re-render.
    const feed = [row('a'), row('b'), row('c')]
    assert.deepEqual(ids(sortRows(feed, { key: 'scan', dir: 'desc' })), ['c', 'b', 'a'])
  })

  it('leaves unnamed rows exactly where they were scanned', () => {
    // Unlike catalog order: here an unnamed row's position is real information
    // (it is the second card you scanned) and the reader is entitled to it.
    const feed = [row('a'), unnamed('b'), row('c')]
    assert.deepEqual(ids(sortRows(feed, { key: 'scan', dir: 'asc' })), ['a', 'b', 'c'])
    assert.deepEqual(ids(sortRows(feed, { key: 'scan', dir: 'desc' })), ['c', 'b', 'a'])
  })

  it('never mutates the feed', () => {
    const feed = [row('a'), row('b')]
    sortRows(feed, { key: 'scan', dir: 'desc' })
    assert.deepEqual(ids(feed), ['a', 'b'])
  })
})

describe('catalog order', () => {
  it('SERIES, THEN SET, THEN COLLECTOR NUMBER', () => {
    const feed = [
      row('a', { setId: 'swsh12', setName: 'Silver Tempest', number: '5' }),
      row('b', { setId: 'sv10', setName: 'Destined Rivals', number: '161' }),
      row('c', { setId: 'sv02', setName: 'Paldea Evolved', number: '9' }),
      row('d', { setId: 'sv02', setName: 'Paldea Evolved', number: '100' }),
    ]
    // sv before swsh (series), sv02 before sv10 (set, numerically), 9 before 100
    // (collector number, numerically).
    assert.deepEqual(ids(sortRows(feed, { key: 'catalog', dir: 'asc' })), ['c', 'd', 'b', 'a'])
  })

  it('handles the half-sets the catalog actually has', () => {
    // `sv03.5`, `sv10.5w` — real TCGdex ids (see `scan/ocr/codes.ts`). A naive
    // numeric parse of the whole id would collapse these onto their parent.
    const feed = [
      row('a', { setId: 'sv04' }),
      row('b', { setId: 'sv03.5' }),
      row('c', { setId: 'sv03' }),
    ]
    assert.deepEqual(ids(sortRows(feed, { key: 'catalog', dir: 'asc' })), ['c', 'b', 'a'])
  })

  it('falls back to SCAN ORDER for rows the catalog cannot separate', () => {
    // Two scans of one card is now the everyday case, and the reader's own
    // sequence is the only tiebreak that means anything.
    const feed = [row('a'), row('b'), row('c')]
    assert.deepEqual(ids(sortRows(feed, { key: 'catalog', dir: 'asc' })), ['a', 'b', 'c'])
  })

  it('GROUPS THE UNNAMED ROWS AT THE TOP, in scan order among themselves', () => {
    // They have no set and no number, so an empty-string compare would file them
    // under "before everything" or "after everything" by accident. It is a
    // decision: they are what the reader still owes an answer to.
    const feed = [row('a', { number: '1' }), unnamed('x'), row('b', { number: '2' }), unnamed('y')]
    assert.deepEqual(ids(sortRows(feed, { key: 'catalog', dir: 'asc' })), ['x', 'y', 'a', 'b'])
  })

  it('KEEPS THEM AT THE TOP WHEN REVERSED', () => {
    // Reversing is a statement about the catalog, not a request to hide the
    // questions. This is the assertion that stops "desc" being a plain reverse.
    const feed = [row('a', { number: '1' }), unnamed('x'), row('b', { number: '2' }), unnamed('y')]
    assert.deepEqual(ids(sortRows(feed, { key: 'catalog', dir: 'desc' })), ['x', 'y', 'b', 'a'])
  })

  it('never mutates the feed', () => {
    const feed = [row('a', { number: '9' }), row('b', { number: '1' })]
    sortRows(feed, { key: 'catalog', dir: 'asc' })
    assert.deepEqual(ids(feed), ['a', 'b'])
  })
})

describe('naturalCompare', () => {
  it('counts rather than spells', () => {
    assert.ok(naturalCompare('sv2', 'sv10') < 0)
    assert.ok(naturalCompare('9', '100') < 0)
    assert.ok(naturalCompare('TG09', 'TG12') < 0)
  })

  it('orders a prefix before what extends it', () => {
    assert.ok(naturalCompare('sv03', 'sv03.5') < 0)
  })

  it('is case-insensitive, so one set id casing cannot split a series', () => {
    assert.equal(naturalCompare('SV10', 'sv10'), 0)
  })

  it('is a total order — a === b both ways, and never a stray non-zero', () => {
    assert.equal(naturalCompare('sv10', 'sv10'), 0)
    assert.equal(naturalCompare('', ''), 0)
    assert.ok(naturalCompare('sv10', 'sv2') > 0)
  })
})
