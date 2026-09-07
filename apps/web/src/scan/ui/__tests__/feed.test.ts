// Run: node --import tsx --test src/scan/ui/__tests__/*.test.ts
//
// WHAT A ROW IS — and, since 2026-09-07, what it is NOT.
//
// The owner ruling, verbatim, from a phone field test: "When I scan a normal,
// then scan a reverse holofoil of the same card, there is currently no way to
// then say that one of them was one printing and one of them is another.
// Probably makes sense to separate every scan into different inline items in
// the list."
//
// This file used to be the dedupe rule's test — "a card scanned twice is one
// row with quantity 2", asserted from four directions. That rule is gone, and
// rewriting rather than deleting is deliberate: the assertions that replace it
// are the same claims turned around, and the thing they now have to protect is
// the case the merge destroyed.
//
//   * two captures of one card are TWO ROWS, each with its own thumbnail, its
//     own printing selector and its own quantity — which is what makes "that
//     one was the reverse holo" sayable at all;
//   * the reader answering an unresolved row does NOT get merged into a row
//     that already holds that card, for exactly the same reason, and because
//     two paths that disagree about what a row is are how a screen ends up
//     lying to itself;
//   * and the aggregation the list gave up happens ONCE, at commit time, over
//     resolved printings — where identical printings fold and different ones
//     never do (`foldCommitLines`).
//
// That last one is the load-bearing half. Separating the rows is only safe if
// something puts them back together for the write; without it a reader who
// scanned one printing ten times sends ten `+1` lines of a 250-line budget.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ScanMatch } from '../../../lib/api'
import { addArrival, feedTotals, foldCommitLines, isUnresolved, resolveRow } from '../feed'
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
 *  given, a needs-input row when it is not. `id` is the CAPTURE's id in the
 *  shipping code, so the fixtures never derive one from `cardId`. */
function entry(over: Partial<FeedEntry> & { id: string }): FeedEntry {
  const cardId = over.cardId ?? null
  return {
    cardId,
    matched: cardId !== null,
    name: cardId ? `Card ${cardId}` : 'Unidentified card',
    setName: cardId ? 'Destined Rivals' : '',
    setId: cardId ? 'sv10' : null,
    number: cardId ? '161' : '',
    rarity: null,
    images: cardId ? { low: 'l', high: 'h' } : null,
    capturePreviewUrl: `blob:${over.id}`,
    captureBlob: null as unknown as Blob,
    captureId: over.id,
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

const NEEDS_YOU = entry({ id: 'cap-1' })
const NEEDS_YOU_2 = entry({ id: 'cap-2' })
const MURKROW = entry({ id: 'cap-3', cardId: 'sv10-161' })

// ── arrivals ────────────────────────────────────────────────────────────────

describe('a capture arriving in the list', () => {
  it('is a new row, and lands at the END — the list is in scan order', () => {
    // 2026-09-07: "default should be first one scanned is on top, in order of
    // scan". The array IS that order; `sort.ts` is a view over it.
    const feed = addArrival([MURKROW], entry({ id: 'cap-4', cardId: 'sv10-057' }))
    assert.deepEqual(
      feed.map((e) => e.id),
      ['cap-3', 'cap-4'],
    )
    assert.equal(feed[1].quantity, 1)
  })

  it('IS ITS OWN ROW EVEN WHEN THE LIST ALREADY HOLDS THAT CARD', () => {
    // The 2026-09-07 ruling, and the reversal of what this file used to assert.
    // A second capture of Murkrow is a second physical card the reader is
    // holding, and it needs its own printing selector or the reverse holo has
    // nowhere to be said.
    const feed = addArrival([MURKROW], entry({ id: 'cap-9', cardId: 'sv10-161' }))
    assert.equal(feed.length, 2)
    assert.deepEqual(feed.map((e) => e.quantity), [1, 1])
    assert.deepEqual(feed.map((e) => e.cardId), ['sv10-161', 'sv10-161'])
  })

  it('keeps ITS OWN capture on its own row — the thumbnail is that scan’s evidence', () => {
    const feed = addArrival([MURKROW], entry({ id: 'cap-9', cardId: 'sv10-161' }))
    assert.deepEqual(feed.map((e) => e.capturePreviewUrl), ['blob:cap-3', 'blob:cap-9'])
    assert.deepEqual(feed.map((e) => e.captureId), ['cap-3', 'cap-9'])
  })

  it('gives every row a distinct id, which a card id could not have done', () => {
    // The reason the row key had to stop being `cardId`: React cannot be handed
    // two children with one key, and two rows of one card is now the normal case.
    const feed = addArrival([MURKROW], entry({ id: 'cap-9', cardId: 'sv10-161' }))
    assert.equal(new Set(feed.map((e) => e.id)).size, feed.length)
  })

  it('an unresolved arrival is its own row too, and so is every other one', () => {
    // Unchanged in effect and no longer a special case: `cardId: null` was never
    // an identity two captures could share, and now nothing is.
    const feed = addArrival([NEEDS_YOU], NEEDS_YOU_2)
    assert.equal(feed.length, 2)
    assert.deepEqual(feed.map((e) => e.quantity), [1, 1])
    assert.ok(feed.every(isUnresolved))
  })

  it('never mutates the list it was handed', () => {
    const before = [MURKROW]
    addArrival(before, entry({ id: 'cap-9', cardId: 'sv10-161' }))
    assert.equal(before.length, 1)
  })
})

// ── resolutions ─────────────────────────────────────────────────────────────

describe('the reader resolving a needs-input row', () => {
  it('turns it into an ordinary named row', () => {
    const feed = resolveRow([NEEDS_YOU], 'cap-1', match('sv10-161', 'Murkrow'))
    assert.equal(feed.length, 1)
    const row = feed[0]
    assert.equal(row.cardId, 'sv10-161')
    assert.equal(row.matched, true)
    assert.equal(row.name, 'Murkrow')
    assert.equal(isUnresolved(row), false)
  })

  it('KEEPS ITS OWN ID — the capture’s, not the card’s', () => {
    // It took the card's id until 2026-09-07 so the merge could find it. Taking
    // one now would collide with any other row of the same card.
    const feed = resolveRow([NEEDS_YOU, MURKROW], 'cap-1', match('sv10-161'))
    assert.deepEqual(feed.map((e) => e.id), ['cap-1', 'cap-3'])
  })

  it('KEEPS THE READER’S OWN CAPTURE on the row', () => {
    // The picture is the evidence the reader judged by, and the per-row "report"
    // affordance uploads it. A resolution is not a reason to lose it.
    const feed = resolveRow([NEEDS_YOU], 'cap-1', match('sv10-161'))
    assert.equal(feed[0].capturePreviewUrl, 'blob:cap-1')
    assert.equal(feed[0].captureId, 'cap-1')
  })

  it('DROPS THE RACE IT CARRIED — the row is not asking any more', () => {
    // `FeedEntry.identity` rides down only so the row can draw the OCR hint and
    // attribute the reader's answer to the capture. Left attached it would keep
    // the row amber (`FeedEntryCard` reads it) forever.
    assert.equal(resolveRow([NEEDS_YOU], 'cap-1', match('sv10-161'))[0].identity, null)
  })

  it('DOES NOT MERGE INTO A ROW THAT ALREADY HOLDS THAT CARD', () => {
    // The case the ruling turned around. The matcher named row one and gave up
    // on row two and they were the same card — but they are two cards on the
    // reader's desk, and merging them would take away the printing selector the
    // reader opened the picker to reach.
    const before = [MURKROW, NEEDS_YOU]
    const feed = resolveRow(before, 'cap-1', match('sv10-161'))
    assert.equal(feed.length, 2)
    assert.deepEqual(feed.map((e) => e.quantity), [1, 1])
    assert.deepEqual(feed.map((e) => e.cardId), ['sv10-161', 'sv10-161'])

    // …and it is the same answer the arrival path gives, asserted against that
    // path rather than against a number written here. The two must not drift:
    // one rule for "this row is now that card", whichever way it got there.
    const viaArrival = addArrival([MURKROW], entry({ id: 'cap-9', cardId: 'sv10-161' }))
    assert.equal(feed.length, viaArrival.length)
    assert.deepEqual(feed.map((e) => e.quantity), viaArrival.map((e) => e.quantity))
  })

  it('leaves the row where it was in scan order', () => {
    // A resolution is not a re-scan. Naming the second of three rows must not
    // shuffle it to an end, or the reader loses their place in the pile.
    const feed = resolveRow([MURKROW, NEEDS_YOU, NEEDS_YOU_2], 'cap-1', match('sv10-057'))
    assert.deepEqual(feed.map((e) => e.id), ['cap-3', 'cap-1', 'cap-2'])
  })

  it('keeps the row’s own quantity — the reader’s stepper is not a casualty', () => {
    // "wrong card?" on a row the reader stepped to 3 is still 3 of the new card.
    const three = entry({ id: 'cap-7', cardId: 'sv10-057', quantity: 3 })
    const feed = resolveRow([three, MURKROW], 'cap-7', match('sv10-161'))
    assert.equal(feed.length, 2)
    assert.equal(feed[0].quantity, 3)
  })

  it('SENDS THE PRINTING SLOT BACK TO NEEDS-PICK, and carries the new setId', () => {
    // A different card has different printings, so whatever was chosen before
    // means nothing — the slot reopens once the new card's variants land
    // (`printing.ts`). `setId` comes along because catalog sort reads it.
    const picked = entry({
      id: 'cap-7',
      cardId: 'sv10-057',
      setId: 'sv04',
      printingPicked: true,
      variantId: 12,
      variants: [{ variantId: 12, displayName: 'Normal', isPrimary: true, kind: 'normal', tier: null, ownedQuantity: 0 }],
    })
    const feed = resolveRow([picked], 'cap-7', match('sv10-161'))
    assert.equal(feed[0].printingPicked, false)
    assert.equal(feed[0].variantId, null)
    assert.deepEqual(feed[0].variants, [])
    assert.equal(feed[0].setId, 'sv10')
  })

  it('leaves `verified` alone unless swipe review says otherwise', () => {
    // "Verified" means confirmed BY SWIPE. The list's own pickers are edits.
    assert.equal(resolveRow([NEEDS_YOU], 'cap-1', match('sv10-161'))[0].verified, false)
    assert.equal(resolveRow([NEEDS_YOU], 'cap-1', match('sv10-161'), true)[0].verified, true)
  })

  it('touches no other row', () => {
    const feed = resolveRow([MURKROW, NEEDS_YOU], 'cap-1', match('sv10-057'))
    assert.equal(feed[0], MURKROW, 'the untouched row is the same object')
  })

  it('is a no-op for a row that is no longer there', () => {
    // The reader can pick from a popover on a row that was discarded a frame ago.
    const before = [MURKROW]
    const feed = resolveRow(before, 'gone', match('sv10-057'))
    assert.equal(feed, before, 'the SAME array back, so nothing re-renders')
  })
})

// ── what the header chip says ───────────────────────────────────────────────

describe('the running total', () => {
  it('counts cards by quantity and unique by CARD, not by row', () => {
    // Three scans of one card: three cards, one unique. `entries.length` was the
    // old answer to both and stopped being either on 2026-09-07.
    const rows = [
      entry({ id: 'cap-1', cardId: 'sv10-161' }),
      entry({ id: 'cap-2', cardId: 'sv10-161' }),
      entry({ id: 'cap-3', cardId: 'sv10-161', quantity: 4 }),
    ]
    assert.deepEqual(feedTotals(rows), { cards: 6, unique: 1 })
  })

  it('counts every unnamed row as its own unknown', () => {
    // They are four different unanswered questions. Collapsing them in the count
    // would tell the reader they scanned one thing.
    assert.deepEqual(feedTotals([NEEDS_YOU, NEEDS_YOU_2, entry({ id: 'cap-9' })]), { cards: 3, unique: 3 })
  })

  it('is zero on an empty list', () => {
    assert.deepEqual(feedTotals([]), { cards: 0, unique: 0 })
  })
})

// ── and the aggregation the list gave up ────────────────────────────────────

describe('folding the rows back together for the write', () => {
  it('IDENTICAL PRINTINGS BECOME ONE LINE', () => {
    // Ten scans of one printing must not spend ten of the API's 250 items, and
    // the write is the only place it is safe to collapse them.
    assert.deepEqual(
      foldCommitLines([
        { variantId: 7, delta: 1 },
        { variantId: 7, delta: 1 },
        { variantId: 7, delta: 3 },
      ]),
      [{ variantId: 7, delta: 5 }],
    )
  })

  it('DIFFERENT PRINTINGS OF ONE CARD STAY APART — the whole point of the ruling', () => {
    // A normal and a reverse holo of the same card are two variant ids. If these
    // folded, the ruling would have bought the reader a selector whose answer the
    // write threw away.
    assert.deepEqual(
      foldCommitLines([
        { variantId: 7, delta: 1 },
        { variantId: 8, delta: 1 },
      ]),
      [
        { variantId: 7, delta: 1 },
        { variantId: 8, delta: 1 },
      ],
    )
  })

  it('makes "scanned twice" and "stepped to 2" the identical request', () => {
    // Which is what keeps the idempotency key honest: `commit.ts` builds it from
    // these lines, and two spellings of one intent must not be two keys.
    assert.deepEqual(
      foldCommitLines([
        { variantId: 7, delta: 1 },
        { variantId: 7, delta: 1 },
      ]),
      foldCommitLines([{ variantId: 7, delta: 2 }]),
    )
  })

  it('keeps first-appearance order, matching the server’s own fold', () => {
    assert.deepEqual(
      foldCommitLines([
        { variantId: 9, delta: 1 },
        { variantId: 4, delta: 1 },
        { variantId: 9, delta: 1 },
      ]).map((l) => l.variantId),
      [9, 4],
    )
  })

  it('never mutates the lines it was handed', () => {
    const lines = [{ variantId: 7, delta: 1 }, { variantId: 7, delta: 1 }]
    foldCommitLines(lines)
    assert.deepEqual(lines.map((l) => l.delta), [1, 1])
  })

  it('folds nothing to nothing', () => {
    assert.deepEqual(foldCommitLines([]), [])
  })
})
