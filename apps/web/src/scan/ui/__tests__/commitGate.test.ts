// Run: node --import tsx --test src/scan/ui/__tests__/*.test.ts
//
// COMMITTING WITH CAPTURES STILL ON THE CAMERA.
//
// The 2026-09-05 ruling: "batch commit reminds [about unresolved ones]". The
// reminder is load-bearing in a way it would not have been before that ruling,
// because the captures it is about ARE NOT IN THE LIST any more — an unnamed
// capture stays on the camera as a needs-you thumbnail, and Step 2 does not
// render the camera at all. So the reader presses "Add 12 cards" looking at a
// list of twelve, and two more captures they cannot see go in the bin with the
// session.
//
// That is the property here: the drop is possible, it is invisible, and it is
// therefore only allowed to happen after somebody has said so out loud.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { commitGate, initialIdentity, reduceIdentity, type IdentityState } from '../identity'
import type { ScanMatch, ScanResponse } from '../../../lib/api'
import { TIE_MARGIN } from '../tieGate'

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

// Built by driving the real reducer, not by hand-writing an `IdentityState`:
// "unresolved" has to mean what the shipping machine means by it.
const PENDING: IdentityState = initialIdentity()
const NEEDS_YOU: IdentityState = [
  { type: 'phash' as const, res: scanRes([match('sve-004', 7), match('sve-003', 7)]) },
  { type: 'resolve' as const, resolved: null },
].reduce(reduceIdentity, initialIdentity())
const CONFIDENT: IdentityState = reduceIdentity(initialIdentity(), {
  type: 'phash',
  res: scanRes([match('sv10-057', 4), match('sv10-058', 4 + TIE_MARGIN)]),
})

describe('committing with unresolved scans', () => {
  it('goes straight through when the camera is clear', () => {
    const gate = commitGate([], false)
    assert.equal(gate.proceed, true)
    assert.equal(gate.unresolved, 0)
    assert.equal(gate.prompt, null)
  })

  it('REFUSES TO PROCEED unacknowledged, and says exactly how many', () => {
    const gate = commitGate([{ identity: NEEDS_YOU }, { identity: NEEDS_YOU }], false)
    assert.equal(gate.proceed, false)
    assert.equal(gate.unresolved, 2)
    assert.equal(gate.prompt, '2 scans unresolved — commit without them?')
  })

  it('proceeds once acknowledged — the answer "yes" is a real answer', () => {
    // Two card backs that got in the way is a perfectly good reason to commit
    // without them. The ruling asks for a reminder, not a blocker, and it is
    // explicit elsewhere that unresolved captures never block the reader.
    const gate = commitGate([{ identity: NEEDS_YOU }, { identity: NEEDS_YOU }], true)
    assert.equal(gate.proceed, true)
    assert.equal(gate.unresolved, 2)
  })

  it('counts one as one', () => {
    assert.equal(commitGate([{ identity: NEEDS_YOU }], false).prompt, '1 scan unresolved — commit without them?')
  })

  it('does not nag about captures that are still working or already named', () => {
    // A pending thumbnail has answers in flight and will resolve itself or flip;
    // a confident one is on its way to the list. Neither is waiting on a reader,
    // and a confirm that fires for them teaches the reader to dismiss the one
    // that matters.
    const gate = commitGate([{ identity: PENDING }, { identity: CONFIDENT }, { identity: PENDING }], false)
    assert.equal(gate.proceed, true)
    assert.equal(gate.unresolved, 0)
  })

  it('a needs-you the reader then resolved stops counting', () => {
    const picked = reduceIdentity(NEEDS_YOU, { type: 'pick', match: NEEDS_YOU.candidates[0] })
    assert.equal(commitGate([{ identity: picked }], false).proceed, true)
    // …and so does one they binned.
    const binned = reduceIdentity(NEEDS_YOU, { type: 'retake' })
    assert.equal(commitGate([{ identity: binned }], false).proceed, true)
  })
})
