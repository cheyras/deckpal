// Run: node --import tsx --test src/scan/ui/__tests__/*.test.ts
//
// COMMITTING WITH ROWS STILL UNANSWERED.
//
// The 2026-09-05 ruling: "batch commit reminds [about unresolved ones]". What
// it is reminding ABOUT moved on 2026-09-06 — "if the resolution is 'needs your
// input' they should still go down to the list" — and moving it changed what the
// gate has to count.
//
// It used to count needs-you thumbnails on the CAMERA, and the reminder was
// load-bearing because Step 2 does not render the camera: the reader pressed
// "Add 12 cards" looking at twelve rows while two more went in the bin with the
// session, invisibly. Those captures are rows now. The drop is smaller and it is
// still a drop — "Add 12" over a list of fourteen — so the reminder stays, and
// the thing this file pins is that it counts THE LIST. A gate still looking at
// the stack would find an empty one every time and never fire at all, which is
// the regression the reversal makes available.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { commitGate, firstUnresolvedId, unresolvedCount } from '../feed'
import type { FeedEntry } from '../types'

/** Only the fields the gate reads. The gate's own signature asks for exactly
 *  these, which is the point: "unresolved" is `cardId === null` and nothing
 *  about a race, a phase or a thumbnail. */
function row(id: string, cardId: string | null): Pick<FeedEntry, 'id' | 'cardId'> {
  return { id, cardId }
}

const NAMED = row('sv10-057', 'sv10-057')
const NAMED_2 = row('sv10-116', 'sv10-116')
const NEEDS_YOU = row('unmatched-1', null)
const NEEDS_YOU_2 = row('unmatched-2', null)

describe('committing with unresolved rows', () => {
  it('goes straight through when every row is named', () => {
    const gate = commitGate([NAMED, NAMED_2], false)
    assert.equal(gate.proceed, true)
    assert.equal(gate.unresolved, 0)
    assert.equal(gate.prompt, null)
  })

  it('goes straight through on an empty list', () => {
    assert.deepEqual(commitGate([], false), { proceed: true, unresolved: 0, prompt: null })
  })

  it('REFUSES TO PROCEED unacknowledged, and says exactly how many', () => {
    const gate = commitGate([NAMED, NEEDS_YOU, NEEDS_YOU_2], false)
    assert.equal(gate.proceed, false)
    assert.equal(gate.unresolved, 2)
    assert.equal(gate.prompt, '2 scans unresolved — commit without them?')
  })

  it('proceeds once acknowledged — the answer "yes" is a real answer', () => {
    // Two card backs that got in the way is a perfectly good reason to commit
    // without them. The ruling asks for a reminder, not a blocker, and it is
    // explicit elsewhere that unresolved captures never block the reader.
    const gate = commitGate([NEEDS_YOU, NEEDS_YOU_2], true)
    assert.equal(gate.proceed, true)
    assert.equal(gate.unresolved, 2)
  })

  it('counts one as one', () => {
    assert.equal(commitGate([NEEDS_YOU], false).prompt, '1 scan unresolved — commit without them?')
  })

  it('IS THE SAME QUESTION `commit.ts` WILL ASK', () => {
    // The gate's test and the write's test have to be one test, or the screen can
    // show a row as ready and the write skip it. `commit.ts` filters on
    // `cardId !== null`; so does this, through `feed.isUnresolved`, and neither
    // consults `matched`, `name` or anything a row could disagree with itself
    // about.
    const halfNamed = { ...row('odd', null), matched: true, name: 'Looks named' }
    assert.equal(commitGate([halfNamed], false).unresolved, 1)
  })
})

describe('what "Go back to them" goes back to', () => {
  it('names the first unresolved row IN LIST ORDER', () => {
    // The list renders newest-first and the reader is about to be scrolled to
    // this id, so "first" has to mean first the way the screen means it — not
    // the oldest capture.
    assert.equal(firstUnresolvedId([NAMED, NEEDS_YOU_2, NEEDS_YOU]), 'unmatched-2')
  })

  it('has nothing to go back to when the list is clean', () => {
    assert.equal(firstUnresolvedId([NAMED, NAMED_2]), null)
    assert.equal(firstUnresolvedId([]), null)
  })
})

describe('unresolvedCount', () => {
  it('counts only the rows still waiting on the reader', () => {
    assert.equal(unresolvedCount([NAMED, NEEDS_YOU, NAMED_2, NEEDS_YOU_2]), 2)
    assert.equal(unresolvedCount([]), 0)
    assert.equal(unresolvedCount([NAMED]), 0)
  })
})
