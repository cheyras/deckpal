// Run: node --import tsx --test src/scan/ui/__tests__/*.test.ts
//
// WHAT THE THUMBNAIL ACTUALLY DRAWS — the reducer's states, on screen.
//
// `identity.test.ts` proves the machine reaches the right phase. That is not the
// same claim as "the reader can see which phase it is in", and the two used to
// be one thing only because the stack had a single state to draw. It has three
// now, and two of them are new, so a reducer that is right and a thumbnail that
// renders the pending spinner for all three would pass every other test in this
// directory.
//
// So this renders the SHIPPING `IncomingStack` to static markup and reads the
// result, the way `engine/__tests__/overlay-alignment.test.ts` reads geometry
// back out of the shipping `QuadOverlay`. Nothing here imports the phase
// constants to compare against themselves: the assertions are about what a
// person would see — a spinner, a tick, a tappable badge — and about the one
// thing that is a correctness property rather than a style, which is that ONLY
// the needs-you thumbnail is clickable.
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
  { type: 'read' as const, read: { name: null, number: '161', denominator: '182', setCode: null, ms: 340 } },
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

function render(items: StackItem[], picking: string | null = null): string {
  return renderToStaticMarkup(
    createElement(IncomingStack, {
      items,
      picking,
      onNodeRef: () => {},
      onNeedsYou: () => {},
      onPick: () => {},
      onRetake: () => {},
      onClosePicker: () => {},
    }),
  )
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
    assert.equal(html.includes('<button'), false, 'a capture still being worked on is not a question')
  })

  it('confident is a tick, not a spinner and not a question', () => {
    const html = render([item('b', CONFIDENT)])
    assert.equal(html.includes('<button'), false)
    assert.match(html, /change-positive/, 'the tick reads as a positive decision')
  })

  it('NEEDS-YOU IS THE ONLY TAPPABLE THUMBNAIL', () => {
    // The correctness property, not a style one. The stack column is
    // `pointer-events-none` so a capture in flight cannot swallow a tap meant
    // for the camera; exactly one phase opts back in.
    const html = render([item('a', PENDING), item('b', CONFIDENT), item('c', NEEDS_YOU)])
    const buttons = html.match(/<button/g) ?? []
    assert.equal(buttons.length, 1)
    assert.match(html, /aria-label="Pick a match for this capture, or retake it"/)
    assert.match(html, /pointer-events-auto/)
  })

  it('does not hide the capture behind a scrim when it is asking about it', () => {
    // A pending thumbnail is dimmed because there is nothing to look at yet. A
    // needs-you thumbnail is the evidence the reader is being asked to judge, so
    // covering it would be perverse.
    assert.match(render([item('a', PENDING)]), /bg-black\/45/)
    assert.equal(render([item('c', NEEDS_YOU)]).includes('bg-black/45'), false)
  })
})

describe('the needs-you picker', () => {
  it('is closed until the reader opens that thumbnail', () => {
    const html = render([item('c', NEEDS_YOU)])
    assert.equal(html.includes('Which card is this?'), false)
  })

  it('offers the tie-gated candidates, all of them live choices', () => {
    const html = render([item('c', NEEDS_YOU)], 'c')
    assert.match(html, /Which card is this\?/)
    for (const cardId of ['sve-004', 'sve-003', 'sve-002']) {
      assert.ok(html.includes(`Card ${cardId}`), `${cardId} is missing from the picker`)
    }
    // `currentCardId` is null on a capture nothing has named, so no candidate is
    // rendered as the current one — every row is pickable.
    assert.equal(html.includes('disabled'), false)
  })

  it('shows what OCR read, as a quotation beside the candidates', () => {
    assert.match(render([item('c', NEEDS_YOU)], 'c'), /read 161\/182/)
  })

  it('always offers the way out', () => {
    assert.match(render([item('c', NEEDS_YOU)], 'c'), /Discard and retake/)
  })

  it('opens for the thumbnail that was tapped and no other', () => {
    const html = render([item('c', NEEDS_YOU), item('d', NEEDS_YOU)], 'd')
    assert.equal((html.match(/Which card is this\?/g) ?? []).length, 1)
  })
})
