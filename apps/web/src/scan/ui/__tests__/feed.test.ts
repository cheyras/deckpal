// Run: node --import tsx --test src/scan/ui/__tests__/*.test.ts
//
// WHEN TWO ROWS ARE ONE ROW — and the case the 2026-09-06 reversal created.
//
// "If the resolution is 'needs your input' they should still go down to the
// list." So the list now holds two kinds of row, and the dedupe rule that was
// obvious while it held one is not obvious any more:
//
//   * a card scanned twice is one row with quantity 2 (unchanged);
//   * a capture NOTHING NAMED merges with nothing at all, in either direction —
//     `cardId: null` is not an identity two captures can share, and collapsing
//     two unanswered questions into "2× Unidentified card" would destroy the
//     only thing the reader has to answer them with, which is the picture;
//   * and the moment the reader answers one, it must merge exactly as a
//     confident capture of that card would have. Not approximately: the reader
//     naming the fourteenth row as a card already in row three has to end with
//     one row of quantity 2, the same as if the matcher had got it right.
//
// That last one is why `addArrival` and `resolveRow` live in the same file and
// are tested in the same one. They were two `setFeed` callbacks in a 1,400-line
// route until now, and two copies of a merge rule is how a scan session ends
// with the same card in two rows.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ScanMatch } from '../../../lib/api'
import { addArrival, isUnresolved, resolveRow } from '../feed'
import { initialIdentity, reduceIdentity } from '../identity'
import type { FeedEntry } from '../types'

// ── fixtures ────────────────────────────────────────────────────────────────

function match(cardId: string, name = `Card ${cardId}`): ScanMatch {
  return {
    cardId,
    name,
    number: '161',
    setId: 'sv10',
    setName: 'Destined Rivals',
    rarity: 'Rare',
    images: { low: `${cardId}.low`, high: `${cardId}.high` },
    distance: 4,
    confidence: 0.94,
  }
}

/** A row as `Scan.tsx`'s `addFeedEntry` builds one — named when `cardId` is
 *  given, a needs-input row when it is not. */
function entry(over: Partial<FeedEntry> & { id: string }): FeedEntry {
  const cardId = over.cardId ?? null
  return {
    cardId,
    matched: cardId !== null,
    name: cardId ? `Card ${cardId}` : 'Unidentified card',
    setName: cardId ? 'Destined Rivals' : '',
    number: cardId ? '161' : '',
    rarity: null,
    images: cardId ? { low: 'l', high: 'h' } : null,
    capturePreviewUrl: `blob:${over.id}`,
    captureBlob: null as unknown as Blob,
    captureId: `cap-${over.id}`,
    captureTrackId: cardId ? null : 7,
    confidence: cardId ? 0.94 : 0,
    distance: cardId ? 4 : -1,
    quantity: 1,
    variantId: null,
    variants: [],
    printingPicked: false,
    detectingPrinting: false,
    alternates: [],
    capturedAt: 1_000,
    mergeTick: 0,
    verified: false,
    // Produced by the real reducer, because a hand-written state could describe
    // a phase the machine never reaches.
    identity: cardId
      ? null
      : [{ type: 'phash' as const, res: null }, { type: 'resolve' as const, resolved: null }].reduce(
          reduceIdentity,
          initialIdentity(),
        ),
    ...over,
  }
}

const NEEDS_YOU = entry({ id: 'unmatched-1' })
const NEEDS_YOU_2 = entry({ id: 'unmatched-2' })
const MURKROW = entry({ id: 'sv10-161', cardId: 'sv10-161' })

// ── arrivals ────────────────────────────────────────────────────────────────

describe('a capture arriving in the list', () => {
  it('is a new row when nothing there is that card', () => {
    const feed = addArrival([MURKROW], entry({ id: 'sv10-057', cardId: 'sv10-057' }))
    assert.deepEqual(
      feed.map((e) => e.id),
      ['sv10-057', 'sv10-161'],
      'newest first, mirroring the stack it came off',
    )
    assert.equal(feed[0].quantity, 1)
  })

  it('MERGES INTO THE ROW THAT ALREADY HOLDS THE CARD, and says so', () => {
    const feed = addArrival([MURKROW], entry({ id: 'sv10-161', cardId: 'sv10-161' }))
    assert.equal(feed.length, 1)
    assert.equal(feed[0].quantity, 2)
    // `mergeTick`, not `quantity`, is what FeedEntryCard plays the duplicate
    // bump off — the reader's own +/- must never replay it.
    assert.equal(feed[0].mergeTick, 1)
  })

  it('AN UNRESOLVED ARRIVAL MERGES WITH NOTHING — not even another one', () => {
    // Two captures nothing could name are two different unanswered questions.
    // "2× Unidentified card" would throw away one of the two pictures the reader
    // has to answer them with.
    const feed = addArrival([NEEDS_YOU], NEEDS_YOU_2)
    assert.equal(feed.length, 2)
    assert.deepEqual(feed.map((e) => e.quantity), [1, 1])
    assert.ok(feed.every(isUnresolved))
  })

  it('and does not attach itself to a named row either', () => {
    // The other direction: null is not "the card this list already has", it is
    // "not known to be any card".
    const feed = addArrival([MURKROW], entry({ id: 'unmatched-9' }))
    assert.equal(feed.length, 2)
    assert.equal(feed.find((e) => e.id === 'sv10-161')?.quantity, 1)
  })

  it('a confident arrival never merges into an unresolved row', () => {
    const feed = addArrival([NEEDS_YOU], entry({ id: 'sv10-161', cardId: 'sv10-161' }))
    assert.equal(feed.length, 2)
    assert.equal(feed[0].cardId, 'sv10-161')
    assert.equal(feed[1].cardId, null)
  })
})

// ── resolutions ─────────────────────────────────────────────────────────────

describe('the reader resolving a needs-input row', () => {
  it('turns it into an ordinary named row', () => {
    const feed = resolveRow([NEEDS_YOU], 'unmatched-1', match('sv10-161', 'Murkrow'))
    assert.equal(feed.length, 1)
    const row = feed[0]
    assert.equal(row.id, 'sv10-161', 'the row takes the card’s id, like every named row')
    assert.equal(row.cardId, 'sv10-161')
    assert.equal(row.matched, true)
    assert.equal(row.name, 'Murkrow')
    assert.equal(isUnresolved(row), false)
  })

  it('KEEPS THE READER’S OWN CAPTURE on the row', () => {
    // The picture is the evidence the reader judged by, and the per-row "report"
    // affordance uploads it. A resolution is not a reason to lose it.
    const feed = resolveRow([NEEDS_YOU], 'unmatched-1', match('sv10-161'))
    assert.equal(feed[0].capturePreviewUrl, 'blob:unmatched-1')
    assert.equal(feed[0].captureId, 'cap-unmatched-1')
  })

  it('DROPS THE RACE IT CARRIED — the row is not asking any more', () => {
    // `FeedEntry.identity` rides down only so the row can draw the OCR hint and
    // attribute the reader's answer to the capture. Left attached it would keep
    // the row amber (`FeedEntryCard` reads it) forever.
    assert.equal(resolveRow([NEEDS_YOU], 'unmatched-1', match('sv10-161'))[0].identity, null)
  })

  it('RESOLVES INTO AN EXISTING ROW BY MERGING, exactly as an arrival would', () => {
    // The case the reversal created: the matcher named row one and gave up on
    // row two, and they were the same card all along. One row, quantity 2 —
    // identical to what a second confident capture would have produced.
    const before = [NEEDS_YOU, MURKROW]
    const feed = resolveRow(before, 'unmatched-1', match('sv10-161'))
    assert.equal(feed.length, 1)
    assert.equal(feed[0].id, 'sv10-161')
    assert.equal(feed[0].quantity, 2)
    assert.equal(feed[0].mergeTick, 1)

    // …and it is the same answer the arrival path gives, asserted against that
    // path rather than against a number written here.
    const viaArrival = addArrival([MURKROW], entry({ id: 'sv10-161', cardId: 'sv10-161' }))
    assert.equal(feed[0].quantity, viaArrival[0].quantity)
    assert.equal(feed[0].mergeTick, viaArrival[0].mergeTick)
  })

  it('carries the whole quantity over, not one of it', () => {
    // A needs-input row is always quantity 1 today, but "wrong card?" on a
    // merged row is the same call, and that row can be several.
    const three = entry({ id: 'sv10-057', cardId: 'sv10-057', quantity: 3 })
    const feed = resolveRow([three, MURKROW], 'sv10-057', match('sv10-161'))
    assert.equal(feed.length, 1)
    assert.equal(feed[0].quantity, 4)
  })

  it('SENDS THE PRINTING SLOT BACK TO NEEDS-PICK on the replace path', () => {
    // A different card has different printings, so whatever was chosen before
    // means nothing — the slot reopens once the new card's variants land
    // (`printing.ts`).
    const picked = entry({ id: 'sv10-057', cardId: 'sv10-057', printingPicked: true, variantId: 12, variants: [{ variantId: 12, displayName: 'Normal', isPrimary: true, kind: 'normal', tier: null, ownedQuantity: 0 }] })
    const feed = resolveRow([picked], 'sv10-057', match('sv10-161'))
    assert.equal(feed[0].printingPicked, false)
    assert.equal(feed[0].variantId, null)
    assert.deepEqual(feed[0].variants, [])
  })

  it('leaves `verified` alone unless swipe review says otherwise', () => {
    // "Verified" means confirmed BY SWIPE. The list's own pickers are edits.
    assert.equal(resolveRow([NEEDS_YOU], 'unmatched-1', match('sv10-161'))[0].verified, false)
    assert.equal(resolveRow([NEEDS_YOU], 'unmatched-1', match('sv10-161'), true)[0].verified, true)
    // And a merge never UNSETS it on the row that survives.
    const confirmed = entry({ id: 'sv10-161', cardId: 'sv10-161', verified: true })
    assert.equal(resolveRow([NEEDS_YOU, confirmed], 'unmatched-1', match('sv10-161'))[0].verified, true)
  })

  it('is a no-op for a row that is no longer there', () => {
    // The reader can pick from a popover on a row a merge removed a frame ago.
    const feed = resolveRow([MURKROW], 'gone', match('sv10-057'))
    assert.deepEqual(feed.map((e) => e.id), ['sv10-161'])
  })
})
