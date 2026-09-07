// Run: node --import tsx --test src/scan/ui/__tests__/*.test.ts
//
// THE NEEDS-INPUT ROW — where the question is asked after 2026-09-06.
//
// The owner ruling, verbatim: "I do not like the change where ones that need my
// input stay in the side. If the resolution is 'needs your input' they should
// still go down to the list."
//
// So the ask that used to hang off a stack thumbnail is now a ROW, and this file
// is the successor to the "needs-you picker" half of `stack-states.test.ts`: the
// same assertions, moved to the place the ruling moved the thing they are about.
// It renders the SHIPPING `FeedEntryCard` to static markup, because "the reducer
// settles at needs-you" and "the reader can see and answer the question" are
// different claims and only the first is testable in `identity.test.ts`.
//
// What the row owes the reader, all of it visible in the markup:
//   the capture, the amber marking, what OCR read, the candidates, and a way out.
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it } from 'node:test'

import type { ScanMatch, ScanResponse } from '../../../lib/api'
import { FeedEntryCard } from '../FeedEntryCard'
import { initialIdentity, reduceIdentity } from '../identity'
import type { FeedEntry } from '../types'

function match(cardId: string, distance: number): ScanMatch {
  return {
    cardId,
    name: `Card ${cardId}`,
    number: '161',
    setId: 'sv10',
    setName: 'Destined Rivals',
    rarity: null,
    images: { low: `${cardId}.low`, high: `${cardId}.high` },
    distance,
    confidence: 1 - distance / 64,
  }
}
function scanRes(matches: ScanMatch[]): ScanResponse {
  return { query: { algo: 'dhash', hash: 'abc' }, matched: true, threshold: 12, indexSize: 20_451, matches }
}

const TIED = [match('sve-004', 7), match('sve-003', 7), match('sve-002', 7)]

/** The state a needs-input row rides down with — from the real reducer, so it
 *  cannot describe a phase the machine never reaches. */
const SETTLED_UNNAMED = [
  { type: 'phash' as const, res: scanRes(TIED) },
  {
    type: 'read' as const,
    read: { name: null, number: '161', denominator: '182', setCode: null, pass: 'roi' as const, ms: 340 },
  },
  { type: 'resolve' as const, resolved: null },
].reduce(reduceIdentity, initialIdentity())

function row(over: Partial<FeedEntry> = {}): FeedEntry {
  return {
    id: 'cap-1',
    cardId: null,
    matched: false,
    name: 'Unidentified card',
    setName: '',
    setId: null,
    number: '',
    rarity: null,
    images: null,
    capturePreviewUrl: 'blob:cap-1',
    captureBlob: null as unknown as Blob,
    captureId: 'cap-1',
    captureTrackId: 7,
    confidence: 0,
    distance: -1,
    quantity: 1,
    variantId: null,
    variants: [],
    printingPicked: false,
    detectingPrinting: false,
    alternates: TIED,
    capturedAt: 1_000,
    verified: false,
    identity: SETTLED_UNNAMED,
    ...over,
  }
}

const NAMED = row({
  id: 'cap-2',
  cardId: 'sv10-057',
  matched: true,
  name: 'Murkrow',
  setName: 'Destined Rivals',
  setId: 'sv10',
  number: '161',
  images: { low: 'l', high: 'h' },
  confidence: 0.94,
  distance: 4,
  identity: null,
  captureTrackId: null,
})

function render(entry: FeedEntry): string {
  return renderToStaticMarkup(
    createElement(FeedEntryCard, {
      entry,
      onQuantityChange: () => {},
      onVariantChange: () => {},
      onCorrect: () => {},
      onRemove: () => {},
      onReport: async () => {},
      onOpenDetail: () => {},
      registerThumbNode: () => {},
    }),
  )
}

describe('a needs-input row is legible as a question', () => {
  it('publishes its state, and it is not the identified one', () => {
    assert.match(render(row()), /data-entry-state="needs-input"/)
    assert.match(render(NAMED), /data-entry-state="identified"/)
  })

  it('SAYS "NEEDS YOUR INPUT" — the ruling’s own words', () => {
    const html = render(row())
    assert.match(html, /Needs your input/)
    // Not the old "Needs attention", which described a row the scanner had
    // dumped on the reader rather than one it is asking them about.
    assert.equal(html.includes('Needs attention'), false)
  })

  it('is amber, on the row and on the capture', () => {
    const html = render(row())
    assert.match(html, /border-warning/)
    assert.match(html, /ring-warning/)
    assert.equal(render(NAMED).includes('ring-warning'), false)
  })

  it('SHOWS THE CAPTURE, because that is all the reader has to go on', () => {
    const html = render(row())
    assert.match(html, /blob:cap-1/)
    assert.match(html, /alt="Captured card, not yet identified"/)
  })

  it('shows what OCR read, without claiming it identified anything', () => {
    // `ocrHintLabel`'s rule: the printed key is offered because the reader can
    // check it against the card in their hand in a second.
    assert.match(render(row()), /read 161\/182/)
  })

  it('offers NO QUANTITY STEPPER — a row that is not a card cannot be two', () => {
    const html = render(row())
    assert.equal(html.includes('One more'), false)
    assert.equal(html.includes('One fewer'), false)
    // The named row has one.
    assert.match(render(NAMED), /aria-label="One more Murkrow"/)
  })

  it('draws no match meter for a claim nobody made', () => {
    // distance -1 means "no phash opinion", not "distance 64". A bar reading
    // 0% would be a measurement that was never taken.
    assert.equal(render(row()).includes('· dist'), false)
  })
})

describe('the picker, in place in the list', () => {
  it('is closed until the reader opens the row', () => {
    assert.equal(render(row()).includes('Which card is this?'), false)
  })

  it('THE CAPTURE IS THE TAP TARGET', () => {
    // "Tapping opens the same picker in place in the list." On a named row the
    // same square opens the card sheet, so only the unresolved one advertises
    // itself as a button.
    assert.match(render(row()), /aria-label="Identify this capture, or discard it"/)
    assert.equal(render(NAMED).includes('Identify this capture'), false)
  })

  it('always offers "pick a match", even with nothing to pick from', () => {
    // A capture `/scan` had no guesses for is exactly the one the reader most
    // needs a way out of, and the way out lives in the picker.
    assert.match(render(row()), /pick a match/)
    assert.match(render(row({ alternates: [] })), /pick a match/)
    // A named row only offers the swap when there is something to swap to.
    assert.equal(render({ ...NAMED, alternates: [] }).includes('wrong card?'), false)
    assert.match(render({ ...NAMED, alternates: TIED }), /wrong card\?/)
  })
})

describe('a resolved row stops asking', () => {
  it('loses the marking, the capture-as-button and the hint', () => {
    // What `feed.resolveRow` produces: `identity: null`, `matched: true`. The row
    // must read as an ordinary card from that alone — nothing else is cleared.
    const resolved = row({
      id: 'cap-3',
      cardId: 'sv10-004',
      matched: true,
      name: 'Basic Energy',
      images: { low: 'l', high: 'h' },
      identity: null,
      captureTrackId: null,
    })
    const html = render(resolved)
    assert.match(html, /data-entry-state="identified"/)
    assert.equal(html.includes('Needs your input'), false)
    assert.equal(html.includes('read 161/182'), false)
    assert.equal(html.includes('Identify this capture'), false)
    assert.match(html, /aria-label="One more Basic Energy"/)
  })

  it('and shows the printing slot at needs-pick when the card has more than one', () => {
    // The hand-off the ruling describes — "variant resolve happens there" — is
    // reached from a needs-input row exactly as it is from a confident one.
    const resolved = row({
      id: 'cap-3',
      cardId: 'sv10-004',
      matched: true,
      name: 'Basic Energy',
      images: { low: 'l', high: 'h' },
      identity: null,
      variants: [
        { variantId: 1, displayName: 'Normal', isPrimary: true, kind: 'normal', tier: null, ownedQuantity: 0 },
        { variantId: 2, displayName: 'Reverse Holo', isPrimary: false, kind: 'reverse', tier: null, ownedQuantity: 0 },
      ],
    })
    assert.match(render(resolved), /data-printing="needs-pick"/)
  })
})

// ── the row cannot be wider than the list (owner ruling, 2026-09-07) ─────────
//
// "We are able to scroll to the side in the verify list, which feels really bad
// on mobile."
//
// These assert a LAYOUT CONTRACT, not a measurement, and it is worth saying why
// rather than pretending otherwise: `renderToStaticMarkup` produces a string,
// there is no layout engine behind it, and a test here cannot tell you that the
// row fits in 390 px. What it CAN do is pin the three declarations the fix is
// made of, each of which was absent and each of which had to be there — so the
// next person who reaches for `w-auto` on the select finds out here rather than
// on a phone. The width itself was checked by hand; see the commit message.
const MANY_PRINTINGS = row({
  id: 'cap-4',
  cardId: 'sv10-004',
  matched: true,
  name: 'Basic Grass Energy',
  images: { low: 'l', high: 'h' },
  identity: null,
  variants: [
    { variantId: 1, displayName: 'Normal', isPrimary: true, kind: 'normal', tier: null, ownedQuantity: 0 },
    // The real shape of the problem: a display name long enough that the
    // select's intrinsic min-content width exceeded the row.
    { variantId: 2, displayName: 'Poké Ball Pattern Reverse Holofoil', isPrimary: false, kind: 'reverse', tier: null, ownedQuantity: 0 },
    { variantId: 3, displayName: 'Master Ball Pattern Reverse Holofoil', isPrimary: false, kind: 'reverse', tier: null, ownedQuantity: 0 },
  ],
})

describe('nothing in a row may push the list sideways', () => {
  it('THE PRINTING SELECT SHRINKS — it was the thing that was too wide', () => {
    // A `<select>`'s automatic minimum size is its longest option, so as a flex
    // item with the default `min-width: auto` it simply refused to fit. All
    // three of these are load-bearing: `min-w-0` lets it shrink at all,
    // `max-w-full` stops it claiming more than the column, `truncate` makes the
    // shrunk state readable instead of clipped mid-glyph.
    const html = render(MANY_PRINTINGS)
    const select = html.match(/<select[^>]*aria-label="Printing of [^"]*"[^>]*>/)?.[0] ?? ''
    assert.notEqual(select, '', 'the needs-pick row still renders a printing select')
    assert.match(select, /min-w-0/)
    assert.match(select, /max-w-full/)
    assert.match(select, /truncate/)
  })

  it('the chip line and the action line WRAP rather than widen', () => {
    // "pick a printing" beside the select, and "pick a match" + "report" +
    // the stepper, are each within a few pixels of the column at 390 px. They go
    // to a second line instead of taking the row past the viewport.
    const html = render(MANY_PRINTINGS)
    assert.match(html, /class="fe-chips[^"]*flex-wrap/)
    assert.match(html, /class="fe-row[^"]*flex-wrap/)
  })

  it('keeps the quantity stepper whole while everything around it gives', () => {
    // It is 84 px of tap targets with nothing to truncate — shrinking it would
    // produce two buttons the reader cannot hit.
    assert.match(render(MANY_PRINTINGS), /inline-flex h-\[28px\] shrink-0 items-center overflow-hidden rounded-full/)
  })
})
