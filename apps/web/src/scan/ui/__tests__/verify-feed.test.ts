// Run: node --import tsx --test src/scan/ui/__tests__/*.test.ts
//
// THE LIST'S HEADER, AND THE LIST'S WIDTH — the other two 2026-09-07 rulings.
//
//   "Default should be first one scanned is on top, in order of scan."
//   "We are able to scroll to the side in the verify list, which feels really
//    bad on mobile."
//
// It renders the SHIPPING `VerifyFeed` to static markup, the way
// `feed-row.test.ts` does the row, because "the sort control exists and offers
// the reader the four orders" and "`sortRows` returns them in that order" are
// different claims and only the second is testable in `sort.test.ts`.
//
// ── WHAT A STRING TEST CAN AND CANNOT SAY ABOUT WIDTH ───────────────────────
//
// `renderToStaticMarkup` has no layout engine. It cannot tell you the header
// fits in 390 px; nothing in this repo's test harness can, and pretending
// otherwise with a hard-coded pixel budget would be worse than not testing it.
// What it pins is the set of declarations the fix is MADE of — the explicit
// `overflow-x-hidden` on the scroller, and the wrapping that stops the header
// needing it — each of which was absent, and each of which a future edit could
// quietly drop while the list still looked right on a desktop viewport. The
// widths themselves were checked by hand at 390/414/430 px; see the commit
// message.
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it } from 'node:test'

import { DEFAULT_SORT, SORT_OPTIONS, sortValue, type FeedSort } from '../sort'
import { VerifyFeed } from '../VerifyFeed'
import type { FeedEntry } from '../types'

function entry(id: string, over: Partial<FeedEntry> = {}): FeedEntry {
  return {
    id,
    cardId: 'sv10-161',
    matched: true,
    name: 'Murkrow',
    setName: 'Destined Rivals',
    setId: 'sv10',
    number: '161',
    rarity: null,
    images: { low: 'l', high: 'h' },
    capturePreviewUrl: `blob:${id}`,
    captureBlob: null as unknown as Blob,
    captureId: id,
    captureTrackId: null,
    confidence: 0.94,
    distance: 4,
    quantity: 1,
    variantId: null,
    variants: [],
    printingPicked: false,
    detectingPrinting: false,
    alternates: [],
    capturedAt: 1_000,
    verified: false,
    identity: null,
    ...over,
  }
}

function render(entries: FeedEntry[], sort: FeedSort = DEFAULT_SORT): string {
  return renderToStaticMarkup(
    createElement(VerifyFeed, {
      entries,
      sort,
      onSortChange: () => {},
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

describe('the sort control', () => {
  it('is in the header, and offers every order `sort.ts` defines', () => {
    const html = render([entry('cap-1')])
    assert.match(html, /data-feed-sort/)
    assert.match(html, /aria-label="Sort the list"/)
    for (const o of SORT_OPTIONS) {
      assert.match(html, new RegExp(`value="${o.value}"`), `offers ${o.value}`)
    }
  })

  it('shows the sort it was handed, not one of its own', () => {
    // The choice is owned by `Scan.tsx` so the two `VerifyFeed`s that render one
    // list (Step 1's bin, Step 2's screen) cannot disagree about its order. A
    // control with local state is exactly the regression to catch here.
    const html = render([entry('cap-1')], { key: 'catalog', dir: 'desc' })
    assert.match(html, new RegExp(`value="${sortValue({ key: 'catalog', dir: 'desc' })}"[^>]*selected`))
  })
})

describe('the running total', () => {
  it('says UNIQUE CARDS, not rows', () => {
    // Three scans of one card. Before 2026-09-07 a row was a card and
    // `entries.length` was a fair answer to both halves of the chip; a row is
    // one scan now, so "3 cards · 3 unique" would be a lie the reader can see.
    const html = render([entry('cap-1'), entry('cap-2'), entry('cap-3')])
    assert.match(html, />3<\/b> cards/)
    assert.match(html, />1<\/b> unique/)
  })

  it('counts quantity, so a stepped-up row is more than one card', () => {
    const html = render([entry('cap-1', { quantity: 4 })])
    assert.match(html, />4<\/b> cards/)
    assert.match(html, />1<\/b> unique/)
  })

  it('still says how many rows are waiting on the reader', () => {
    const html = render([entry('cap-1'), entry('cap-2', { cardId: null, matched: false, images: null })])
    assert.match(html, /data-needs-input-count="1"/)
  })
})

describe('the list cannot be dragged sideways', () => {
  it('CLIPS THE X AXIS EXPLICITLY — `overflow-y-auto` alone does not', () => {
    // The trap the ruling found: per CSS overflow, a box with one axis `visible`
    // and the other not computes the visible one to `auto`. Asking for a
    // vertical scroller silently asked for a horizontal one too.
    const scroller = render([entry('cap-1')]).match(/<div data-verify-feed="true" class="([^"]*)"/)?.[1] ?? ''
    assert.notEqual(scroller, '', 'the scroll container is still the one marked element')
    assert.match(scroller, /overflow-y-auto/)
    assert.match(scroller, /overflow-x-hidden/)
  })

  it('lets the header WRAP rather than overflow', () => {
    // Clipping without fixing the cause would only hide the header. The title,
    // both chips, the sort control and the bin's expand button do not fit on one
    // line at 390 px — so they take two.
    const html = render([entry('cap-1'), entry('cap-2', { cardId: null, matched: false, images: null })])
    const header = html.match(/<div class="(sticky[^"]*)"/)?.[1] ?? ''
    assert.notEqual(header, '', 'the sticky header is still there')
    assert.match(header, /flex-wrap/)
  })
})
