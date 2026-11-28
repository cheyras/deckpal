// Run: node --import tsx --test src/scan/ui/__tests__/*.test.ts
//
// EVERY REMOVE NAMES WHAT IT TOOK AND CAN BE UNDONE (owner session 2026-11-27:
// "Verify (9). I had 10 before. Why am I down to nine?"). Drives the shipping
// `removeWithUndo` against a list held the way `Scan.tsx` holds it — a state
// updater over an array — and the app's real toast store.
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

import { currentToast, dismissToast } from '../../../lib/toast'
import { dismissRemovalUndo, removalMessage, removeWithUndo } from '../undoRemove'
import type { FeedEntry } from '../types'

function row(id: string, name: string | null): FeedEntry {
  return {
    id, cardId: name ? `sv10.5w-${id}` : null, matched: !!name, name: name ?? 'Unidentified card', setName: 'White Flare', setId: 'sv10.5w',
    number: '001', rarity: null, images: null, capturePreviewUrl: `blob:${id}`, captureBlob: null as unknown as Blob, captureId: id,
    captureTrackId: null, identity: null, confidence: 0.81, distance: 12, quantity: 1, variantId: null, variants: [], printingPicked: false,
    detectingPrinting: false, alternates: [], capturedAt: 0, verified: false,
  }
}

/** The route's list: state plus a `setFeed` that applies updaters in order. */
function list(rows: FeedEntry[]) {
  let feed = rows
  return { get: () => feed, set: (update: (prev: FeedEntry[]) => FeedEntry[]) => (feed = update(feed)) }
}

const batch = () => [row('1', 'Herdier'), row('2', 'Herdier'), row('3', 'Galvantula'), row('4', 'Cheren')]

describe('removeWithUndo', () => {
  beforeEach(() => dismissToast())

  it('takes the row and says which card it was', () => {
    const l = list(batch())
    removeWithUndo(l.get(), '3', l.set)
    assert.deepEqual(l.get().map((e) => e.id), ['1', '2', '4'])
    assert.equal(currentToast()?.message, 'Removed Galvantula')
    assert.equal(currentToast()?.action?.label, 'Undo')
  })

  it('Undo puts it back in its place', () => {
    const l = list(batch())
    removeWithUndo(l.get(), '3', l.set)
    currentToast()!.action!.run()
    assert.deepEqual(l.get().map((e) => e.id), ['1', '2', '3', '4'])
  })

  it('a second remove of a row already gone does nothing and says nothing', () => {
    const l = list(batch())
    removeWithUndo(l.get(), '1', l.set)
    const shown = currentToast()
    assert.equal(removeWithUndo(l.get(), '1', l.set), null)
    assert.equal(currentToast(), shown)
  })

  it('names an unidentified capture as one, and a discard as a discard', () => {
    assert.equal(removalMessage(row('9', null)), 'Removed a capture')
    assert.equal(removalMessage(row('9', 'Joltik'), 'Discarded'), 'Discarded Joltik')
  })

  it('tells the caller when a row comes back', () => {
    const l = list(batch())
    const back: string[] = []
    removeWithUndo(l.get(), '2', l.set, { onRestored: (r) => back.push(r.row.id) })
    currentToast()!.action!.run()
    assert.deepEqual(back, ['2'])
  })

  it('leaving the scanner takes its Undo with it, and nobody else’s toast', () => {
    const l = list(batch())
    removeWithUndo(l.get(), '4', l.set)
    dismissRemovalUndo()
    assert.equal(currentToast(), null)
  })
})
