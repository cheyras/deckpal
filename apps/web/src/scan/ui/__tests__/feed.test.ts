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
import { addArrival, feedTotals, foldCommitLines, isUnresolved, repeatedLabel, resolveRow, restoreRow, runningOwned, takeRow } from '../feed'
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

  it('a slow first card that settles after a fast second one still goes in in SCAN order', () => {
    // 2026-11-27 (design §4.4): rows arrive in settle order, the list is in
    // shutter order, so the newest-first bin shows the second card on top and
    // the slow one's courier homes BELOW it.
    const first = entry({ id: 'cap-1', cardId: 'sv10-161', capturedAt: 1_000 })
    const second = entry({ id: 'cap-2', cardId: 'sv10-057', capturedAt: 2_000 })
    const feed = addArrival(addArrival([], second), first)
    assert.deepEqual(feed.map((e) => e.id), ['cap-1', 'cap-2'])
    // Equal shutter times keep arrival order.
    const tie = addArrival(feed, entry({ id: 'cap-3', capturedAt: 2_000 }))
    assert.deepEqual(tie.map((e) => e.id), ['cap-1', 'cap-2', 'cap-3'])
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
    assert.deepEqual(feedTotals(rows), { cards: 6, unique: 1, repeated: [{ name: 'Card sv10-161', copies: 6 }] })
  })

  it('counts every unnamed row as its own unknown', () => {
    // They are four different unanswered questions. Collapsing them in the count
    // would tell the reader they scanned one thing.
    assert.deepEqual(feedTotals([NEEDS_YOU, NEEDS_YOU_2, entry({ id: 'cap-9' })]), { cards: 3, unique: 3, repeated: [] })
  })

  it('is zero on an empty list', () => {
    assert.deepEqual(feedTotals([]), { cards: 0, unique: 0, repeated: [] })
  })
})

describe('the chip names the repeat (owner session 2026-11-27, pin 7)', () => {
  // "9 cards · 8 unique" — "What does eight unique… Do I have 2 of the same
  // card? Oh, yes, I have 2 Durants." The chip says which card instead.
  const durant = (id: string, quantity = 1) => entry({ id, cardId: 'sv10.5w-061', name: 'Durant', quantity })
  const herdier = (id: string) => entry({ id, cardId: 'sv10.5w-075', name: 'Herdier' })
  const other = (id: string, n: string) => entry({ id, cardId: `sv10.5w-${n}`, name: `Card ${n}` })

  it('says nothing more than the count when no card is there twice', () => {
    assert.equal(repeatedLabel(feedTotals([durant('a'), herdier('b')])), null)
  })

  it('names the one card there more than once', () => {
    assert.equal(repeatedLabel(feedTotals([durant('a'), herdier('b'), other('c', '031'), durant('d')])), '2× Durant')
  })

  it('counts copies by quantity, across rows', () => {
    assert.equal(repeatedLabel(feedTotals([durant('a', 2), durant('b')])), '3× Durant')
  })

  it('names two, most copies first', () => {
    assert.equal(repeatedLabel(feedTotals([herdier('a'), herdier('b'), durant('c'), durant('d'), durant('e')])), '3× Durant, 2× Herdier')
  })

  it('counts the extra copies once more than two cards repeat', () => {
    const rows = [herdier('a'), herdier('b'), durant('c'), durant('d'), other('e', '031'), other('f', '031'), other('g', '031')]
    assert.equal(repeatedLabel(feedTotals(rows)), '4 duplicates')
  })

  it('never calls two unnamed captures copies of each other', () => {
    assert.equal(repeatedLabel(feedTotals([NEEDS_YOU, NEEDS_YOU_2])), null)
  })
})

// ── the removal rule (owner session 2026-11-27) ─────────────────────────────

describe('a removed row can be put back', () => {
  const rows = () => [entry({ id: 'a', cardId: 'x' }), entry({ id: 'b', cardId: 'y' }), entry({ id: 'c', cardId: 'z' })]

  it('takes exactly the row asked for, and says where it was in scan order', () => {
    const { feed, removed } = takeRow(rows(), 'b')
    assert.deepEqual(feed.map((e) => e.id), ['a', 'c'])
    assert.equal(removed?.row.id, 'b')
    assert.equal(removed?.index, 1)
  })

  it('is a no-op for a row already gone — the same array back', () => {
    const before = rows()
    const { feed, removed } = takeRow(before, 'gone')
    assert.equal(feed, before)
    assert.equal(removed, null)
  })

  it('UNDO PUTS IT BACK IN ITS OWN PLACE, exactly as it was', () => {
    const start = rows().map((e) => (e.id === 'b' ? { ...e, quantity: 3, variantId: 9, printingPicked: true } : e))
    const { feed, removed } = takeRow(start, 'b')
    const back = restoreRow(feed, removed!)
    assert.deepEqual(back.map((e) => e.id), ['a', 'b', 'c'])
    assert.equal(back[1], start[1], 'the same row object: quantity, printing and capture intact')
  })

  it('clamps the place to the list as it is now', () => {
    const { feed: one, removed: c } = takeRow(rows(), 'c')
    const { feed: two } = takeRow(one, 'b')
    assert.deepEqual(restoreRow(two, c!).map((e) => e.id), ['a', 'c'])
  })

  it('a second Undo cannot make two of it', () => {
    const { feed, removed } = takeRow(rows(), 'a')
    const once = restoreRow(feed, removed!)
    assert.equal(restoreRow(once, removed!), once)
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

describe('runningOwned: copies of one printing count up in scan order (owner session 2026-11-26)', () => {
  const v = (variantId: number, ownedQuantity: number) => ({ variantId, ownedQuantity }) as unknown as FeedEntry['variants'][number]
  const oricorio = (id: string, over: Partial<FeedEntry> = {}) =>
    entry({ id, cardId: 'me02-018', variantId: 501, variants: [v(501, 0), v(502, 4)], ...over })

  it('three copies say 0 -> 1, 1 -> 2, 2 -> 3, not 0 -> 1 three times', () => {
    const m = runningOwned([oricorio('a'), oricorio('b'), oricorio('c')])
    assert.deepEqual(
      ['a', 'b', 'c'].map((id) => [m.get(id)!.before, m.get(id)!.after, m.get(id)!.copy, m.get(id)!.copies]),
      [
        [0, 1, 1, 3],
        [1, 2, 2, 3],
        [2, 3, 3, 3],
      ],
    )
  })

  it('starts from what the collection already holds, and a quantity of 2 counts as 2', () => {
    const m = runningOwned([oricorio('a', { variantId: 502, quantity: 2 }), oricorio('b', { variantId: 502 })])
    assert.deepEqual([m.get('a')!.before, m.get('a')!.after, m.get('b')!.before, m.get('b')!.after], [4, 6, 6, 7])
  })

  it('different printings of one card count separately', () => {
    const m = runningOwned([oricorio('a'), oricorio('b', { variantId: 502 }), oricorio('c')])
    assert.deepEqual([m.get('a')!.after, m.get('b')!.before, m.get('c')!.before], [1, 4, 1])
  })

  it('a discarded (removed), zeroed or unprinted row drops out and the later copies count down', () => {
    const m = runningOwned([oricorio('a', { quantity: 0 }), oricorio('b', { variantId: null }), oricorio('c')])
    assert.equal(m.has('a'), false)
    assert.equal(m.has('b'), false)
    assert.deepEqual([m.get('c')!.before, m.get('c')!.copy, m.get('c')!.copies], [0, 1, 1])
  })
})
