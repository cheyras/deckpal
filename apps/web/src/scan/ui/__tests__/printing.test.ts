// Run: node --import tsx --test src/scan/ui/__tests__/*.test.ts
//
// THE PRINTING SLOT — and specifically the state it must NOT enter today.
//
// The 2026-09-05 ruling describes a server-side variant pass that runs after
// identity, with the row showing "detecting printing" while it thinks. That pass
// does not exist. The slot is built for it anyway — one place, three states,
// tested — and the risk of building a state ahead of the thing that drives it is
// exactly the failure this file pins: a spinner nobody is waiting on, spinning
// forever, in a list the reader is trying to read. The ruling names it: "no dead
// spinner shown today".
//
// So the assertions are mostly about ABSENCE. `detecting` is reachable only by
// setting the flag no shipping code sets, and every route a real row can take
// through the product ends somewhere else.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { printingState, type PrintingInput } from '../printing'

const NORMAL = { variantId: 1 }
const REVERSE = { variantId: 2 }
const HOLO = { variantId: 3 }

function row(over: Partial<PrintingInput> = {}): PrintingInput {
  return { detectingPrinting: false, variants: [], printingPicked: false, ...over }
}

describe('the printing slot', () => {
  it('ENTERS AT needs-pick whenever there is a real choice', () => {
    // Variant confidence in the scanner today is exactly zero: nothing in a
    // 480x670 crop separates a reverse holo from its normal printing, so a row
    // with more than one printing has not been resolved by anything and must not
    // present as though it had.
    assert.equal(printingState(row({ variants: [NORMAL, REVERSE] })), 'needs-pick')
    assert.equal(printingState(row({ variants: [NORMAL, REVERSE, HOLO] })), 'needs-pick')
  })

  it('is resolved when there is only one printing to be', () => {
    assert.equal(printingState(row({ variants: [NORMAL] })), 'resolved')
  })

  it('is resolved once the reader has picked', () => {
    assert.equal(printingState(row({ variants: [NORMAL, REVERSE], printingPicked: true })), 'resolved')
  })

  it('NEVER SHOWS A SPINNER WHILE THE CATALOG CALL IS IN FLIGHT', () => {
    // A row lands with `variants: []` and `loadVariants` fills it a moment
    // later. That IS a request in flight — but it comes back with a MENU, not a
    // decision, so "detecting printing…" would promise the reader an answer it
    // is not going to give. The slot stays quiet until it has something to say.
    assert.equal(printingState(row({ variants: [] })), 'resolved')
  })

  it('reaches detecting ONLY through the flag no shipping code sets', () => {
    // The state exists for the variant service. Until one is wired, this is the
    // only door into it, and it is deliberately not one any product path opens
    // (`FeedEntry.detectingPrinting`, always false today).
    assert.equal(printingState(row({ detectingPrinting: true, variants: [NORMAL, REVERSE] })), 'detecting')
    // And it outranks everything — a service that IS thinking is the truest
    // thing the slot can say, even about a row the reader already picked.
    assert.equal(
      printingState(row({ detectingPrinting: true, variants: [NORMAL, REVERSE], printingPicked: true })),
      'detecting',
    )
  })

  it('is total: every combination lands in exactly one of the three', () => {
    const states = new Set<string>()
    for (const detectingPrinting of [false, true]) {
      for (const variants of [[], [NORMAL], [NORMAL, REVERSE]]) {
        for (const printingPicked of [false, true]) {
          states.add(printingState({ detectingPrinting, variants, printingPicked }))
        }
      }
    }
    assert.deepEqual([...states].sort(), ['detecting', 'needs-pick', 'resolved'])
  })
})
