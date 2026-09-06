// Run: node --import tsx --test src/scan/ui/__tests__/*.test.ts
//
// WHAT THE THUMBNAIL ACTUALLY DRAWS — the reducer's states, on screen.
//
// `identity.test.ts` proves the machine reaches the right phase. That is not the
// same claim as "the reader can see which phase it is in", so this renders the
// SHIPPING `IncomingStack` to static markup and reads the result, the way
// `engine/__tests__/overlay-alignment.test.ts` reads geometry back out of the
// shipping `QuadOverlay`.
//
// ── WHAT THE 2026-09-06 REVERSAL CHANGED HERE ───────────────────────────────
//
// This file used to assert that a needs-you thumbnail STAYS: undimmed, tappable,
// with its own picker hanging off the camera box. The owner ruled against that —
// "if the resolution is 'needs your input' they should still go down to the
// list" — so those assertions are not deleted, they are inverted. The stack is
// transient again and the properties worth pinning are:
//
//   * all three phases are still distinguishable, because a stack that draws
//     the pending spinner for a settled capture would pass every other test in
//     this directory;
//   * needs-you gets a MARKER, not a question — the same beat as the confident
//     tick, in the warning colour, because the reader is watching a decision
//     being taken, not being asked one;
//   * and NOTHING IN THE STACK IS TAPPABLE. That is the correctness property:
//     the column is `pointer-events-none` so a capture in flight can never
//     swallow a tap meant for the camera, and after the reversal there is no
//     longer an exception to it. The question is asked on the row
//     (`feed-row.test.ts`).
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it } from 'node:test'

import type { ScanMatch, ScanResponse } from '../../../lib/api'
import { IncomingStack } from '../IncomingStack'
import { initialIdentity, reduceIdentity, type IdentityState } from '../identity'
import { TIE_MARGIN } from '../tieGate'
import type { StackItem } from '../types'

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

// Every fixture is produced by the real reducer — a hand-written state could
// describe a phase the machine never actually produces.
const PENDING = initialIdentity()
const CONFIDENT = reduceIdentity(PENDING, {
  type: 'phash',
  res: scanRes([match('sv10-057', 4), match('sv10-058', 4 + TIE_MARGIN)]),
})
const NEEDS_YOU = [
  { type: 'phash' as const, res: scanRes([match('sve-004', 7), match('sve-003', 7), match('sve-002', 7)]) },
  { type: 'read' as const, read: { name: null, number: '161', denominator: '182', setCode: null, pass: 'roi' as const, ms: 340 } },
  { type: 'resolve' as const, resolved: null },
].reduce(reduceIdentity, initialIdentity())

function item(id: string, identity: IdentityState): StackItem {
  return {
    id,
    trackId: 7,
    previewUrl: `blob:${id}`,
    // `renderToStaticMarkup` never touches it; a Blob is not constructible in
    // every node here and the component only ever passes it along.
    blob: null as unknown as Blob,
    capturedAt: 0,
    identity,
  }
}

function render(items: StackItem[]): string {
  return renderToStaticMarkup(createElement(IncomingStack, { items, onNodeRef: () => {} }))
}

/** The one attribute this file leans on: the phase, published on the slot so a
 *  test (and a devtools inspection, and a future screenshot diff) can read it
 *  without matching on Tailwind classes that are free to change. */
function phasesIn(html: string): string[] {
  return [...html.matchAll(/data-stack-phase="([a-z-]+)"/g)].map((m) => m[1])
}

describe('the incoming stack renders each phase distinctly', () => {
  it('publishes the phase it is drawing', () => {
    const html = render([item('a', PENDING), item('b', CONFIDENT), item('c', NEEDS_YOU)])
    assert.deepEqual(phasesIn(html), ['pending', 'confident', 'needs-you'])
  })

  it('pending is the spinner, and nothing else', () => {
    const html = render([item('a', PENDING)])
    assert.match(html, /role="status"|animate-spin|<svg/, 'a waiting thumbnail shows a spinner')
  })

  it('confident is a tick, in the positive colour', () => {
    assert.match(render([item('b', CONFIDENT)]), /change-positive/)
  })

  it('NEEDS-YOU IS THE TICK’S MIRROR — same beat, warning colour', () => {
    // Not a scrim-free undimmed picture waiting to be studied, which is what it
    // was between the two rulings. It is a departure notice: the scanner gave up,
    // the thumbnail says so for the same `DURATION.confirmTick` a success does,
    // and then it flies down like every other capture.
    const html = render([item('c', NEEDS_YOU)])
    assert.match(html, /bg-warning\/75/, 'the marker washes the thumbnail the way the tick does')
    assert.equal(html.includes('change-positive'), false, 'and it is not mistakable for a success')
  })

  it('both settled markers cover the capture; only pending dims it', () => {
    // A pending thumbnail is dimmed because there is nothing to look at yet.
    // Both verdicts replace that dim with their own full-bleed wash, so the
    // reader's eye reads "decided" from the same place either way — and neither
    // is the other's scrim.
    assert.match(render([item('a', PENDING)]), /bg-black\/45/)
    for (const settled of [CONFIDENT, NEEDS_YOU]) {
      const html = render([item('x', settled)])
      assert.equal(html.includes('bg-black/45'), false)
      assert.match(html, /absolute inset-0 flex items-center justify-center/)
    }
  })
})

describe('nothing in the stack is tappable', () => {
  it('NOT EVEN NEEDS-YOU — the reversal’s correctness property', () => {
    // The column is `pointer-events-none` so a stack of captures can never
    // swallow a tap meant for the camera behind it. Between 2026-09-05 and
    // 2026-09-06 exactly one phase opted back in; none does now, because the
    // capture the reader wants to act on is downstairs by the time they can.
    const html = render([item('a', PENDING), item('b', CONFIDENT), item('c', NEEDS_YOU)])
    assert.equal(html.includes('<button'), false)
    assert.equal(html.includes('pointer-events-auto'), false)
    assert.match(html, /pointer-events-none/)
  })

  it('opens no picker of its own, for any phase', () => {
    // The picker moved to the row. A second one here would be a second place the
    // same question gets asked, free to drift from the first.
    const html = render([item('c', NEEDS_YOU), item('d', NEEDS_YOU)])
    assert.equal(html.includes('Which card is this?'), false)
    assert.equal(html.includes('Discard and retake'), false)
    // …including the OCR hint, which this fixture has (`read 161/182`).
    assert.equal(html.includes('read 161'), false)
  })
})

describe('the column itself', () => {
  it('DOES NOT SCROLL any more', () => {
    // The scroll and its `max-h` cap were added for the parked thumbnails of
    // 2026-09-05: those waited for the reader and could pile up past the camera's
    // height. Nothing waits now — every capture leaves within a beat of settling
    // — so a scrollable region inside a `pointer-events-none` overlay is a
    // gesture trap with nothing left to reach.
    const html = render([item('a', PENDING), item('b', CONFIDENT)])
    assert.equal(html.includes('overflow-y-auto'), false)
    assert.equal(html.includes('overscroll-contain'), false)
  })
})
