// Run: node --import tsx --test src/scan/voice/__tests__/*.test.ts
//
// WHAT A HEARD COMMAND DOES TO THE LIST: pending first, applied after a hold,
// undoable after that — and never applied to the wrong card.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { FeedEntry, FeedVariant } from '../../ui/types'
import {
  applyAction,
  cancel,
  EMPTY_QUEUE,
  enqueue,
  HOLD_MS,
  namedRows,
  propose,
  remember,
  revert,
  revertible,
  settleAll,
  tick,
  undoLatest,
  WAIT_FOR_ROW_MS,
  type VoiceAction,
  type VoiceQueue,
} from '../actions'
import { parseUtterance } from '../grammar'
import { pickVariant } from '../printings'

const v = (variantId: number, kind: string, displayName: string, isPrimary = false): FeedVariant => ({
  variantId, kind, displayName, isPrimary, tier: null, ownedQuantity: 0,
})
// Real printings, from deckpal.app on 2026-09-26.
const EXEGGCUTE = [
  v(1, 'normal', 'Normal', true),
  v(2, 'reverse', 'Reverse Holofoil'),
  v(3, 'reverse-foil-pokeball', 'Poke Ball Pattern Reverse Holofoil'),
  v(4, 'reverse-foil-masterball', 'Master Ball Pattern Reverse Holofoil'),
]
const CHARIZARD = [
  v(11, 'holo-unlimited', 'Holofoil', true),
  v(12, 'holo-shadowless-stamp-1st-edition', '1st Edition Holofoil Shadowless'),
  v(13, 'holo-shadowless', 'Unlimited Holofoil Shadowless'),
  v(14, 'holo-1999-2000-copyright', 'Holofoil 1999-2000 Copyright'),
]
const CHARIZARD_EX = [v(21, 'holo', 'Holofoil', true)]

function row(id: string, over: Partial<FeedEntry> = {}): FeedEntry {
  return {
    id, cardId: `card-${id}`, matched: true, name: `Card ${id}`, setName: 'Set', setId: 'sv1', number: '001', rarity: null,
    images: null, capturePreviewUrl: '', captureBlob: new Blob(), captureId: id, captureTrackId: null, identity: null,
    confidence: 1, distance: 0, quantity: 1, variantId: 1, variants: EXEGGCUTE, printingPicked: false,
    detectingPrinting: false, alternates: [], capturedAt: 0, verified: false, ...over,
  }
}

let seq = 0
const mint = () => `a${++seq}`
const spec = (text: string) => {
  const c = parseUtterance(text).command
  assert.ok(c?.kind === 'edit')
  return c
}

describe('printing choice', () => {
  it('picks the plain printing the reader named, not a pattern of it', () => {
    assert.equal(pickVariant(spec('reverse holo').printing!, EXEGGCUTE)?.variantId, 2)
    assert.equal(pickVariant(spec('poke ball').printing!, EXEGGCUTE)?.variantId, 3)
    assert.equal(pickVariant(spec('master ball reverse').printing!, EXEGGCUTE)?.variantId, 4)
    assert.equal(pickVariant(spec('normal').printing!, EXEGGCUTE)?.variantId, 1)
  })

  it('breaks a tie with the primary printing and honours every modifier said', () => {
    assert.equal(pickVariant(spec('holo').printing!, CHARIZARD)?.variantId, 11)
    assert.equal(pickVariant(spec('first edition').printing!, CHARIZARD)?.variantId, 12)
    assert.equal(pickVariant(spec('shadowless').printing!, CHARIZARD)?.variantId, 13)
    assert.equal(pickVariant(spec('first edition shadowless holo').printing!, CHARIZARD)?.variantId, 12)
  })

  it('has no answer for a printing the card does not come in', () => {
    assert.equal(pickVariant(spec('reverse holo').printing!, CHARIZARD_EX), null)
    assert.equal(pickVariant(spec('normal').printing!, CHARIZARD), null)
  })
})

describe('proposing', () => {
  it('turns one breath into one pending change per slot, waiting for its row', () => {
    const { actions, outcome } = propose(spec('two reverse holos'), 'r1', [row('r1', { name: 'Exeggcute' })], 0, mint)
    assert.deepEqual(actions.map((a) => a.kind), ['printing', 'quantity'])
    assert.ok(actions.every((a) => a.settleAt === null && a.cardId === 'card-r1'))
    assert.equal(outcome.message, 'Exeggcute → Reverse Holofoil × 2')
    assert.equal(propose(spec('three'), 'in-air', [], 0, mint).outcome.message, 'This card × 3')
  })

  it('refuses an edit for a row nobody has identified', () => {
    const r = propose(spec('holo'), 'u', [row('u', { cardId: null, matched: false, variants: [] })], 0, mint)
    assert.equal(r.actions.length, 0)
    assert.equal(r.outcome.ok, false)
  })

  it('refuses a printing the card does not come in, as soon as it can tell', () => {
    const r = propose(spec('reverse holo'), 'c', [row('c', { name: 'Charizard ex', variants: CHARIZARD_EX })], 0, mint)
    assert.deepEqual(r.outcome, { ok: false, message: 'Charizard ex has no Reverse Holo printing' })
  })

  it('accepts a command for a capture whose row has not landed yet', () => {
    const r = propose({ kind: 'remove' }, 'in-flight', [], 0, mint)
    assert.equal(r.actions.length, 1)
    assert.equal(r.actions[0].cardId, null)
  })
})

describe('the queue', () => {
  const at = (q: VoiceQueue) => q.pending.map((a) => `${a.rowId}:${a.kind}`)

  it('keeps one pending change per row and kind', () => {
    let q = enqueue(EMPTY_QUEUE, propose(spec('holo'), 'r1', [], 0, mint).actions)
    q = enqueue(q, propose(spec('reverse'), 'r1', [], 0, mint).actions)
    assert.deepEqual(at(q), ['r1:printing'])
    assert.equal((q.pending[0] as Extract<VoiceAction, { kind: 'printing' }>).printing.finish, 'reverse')
  })

  it('lets a removal replace the row’s edits, and a later edit withdraw the removal', () => {
    let q = enqueue(EMPTY_QUEUE, propose(spec('two reverse holos'), 'r1', [], 0, mint).actions)
    q = enqueue(q, propose({ kind: 'remove' }, 'r1', [], 0, mint).actions)
    assert.deepEqual(at(q), ['r1:remove'])
    q = enqueue(q, propose(spec('two of those'), 'r1', [], 0, mint).actions)
    assert.deepEqual(at(q), ['r1:quantity'])
  })

  it('starts the hold only when the row lands, then comes due', () => {
    const feed: FeedEntry[] = []
    const q = enqueue(EMPTY_QUEUE, propose(spec('reverse holo'), 'r1', feed, 0, mint).actions)
    let t = tick(q, feed, 1_000, () => true)
    assert.equal(t.queue.pending[0].settleAt, null, 'still in the air')
    const landed = [row('r1')]
    t = tick(t.queue, landed, 2_000, () => false)
    assert.equal(t.queue.pending[0].settleAt, 2_000 + HOLD_MS.printing)
    assert.equal(t.queue.pending[0].cardId, 'card-r1')
    t = tick(t.queue, landed, 2_000 + HOLD_MS.printing - 1, () => false)
    assert.equal(t.due.length, 0)
    t = tick(t.queue, landed, 2_000 + HOLD_MS.printing, () => false)
    assert.equal(t.due.length, 1)
    assert.equal(t.queue.pending.length, 0)
  })

  it('lets go of a command whose capture was discarded or never arrived', () => {
    const q = enqueue(EMPTY_QUEUE, propose({ kind: 'remove' }, 'gone', [], 0, mint).actions)
    assert.equal(tick(q, [], 10, () => false).dropped[0].message, 'That scan didn’t make it to the list')
    assert.equal(tick(q, [], WAIT_FOR_ROW_MS + 1, () => true).dropped.length, 1)
    assert.equal(tick(q, [], WAIT_FOR_ROW_MS - 1, () => true).dropped.length, 0)
  })

  it('keeps the card a command was spoken about, even if the row is corrected before its hold starts', () => {
    const spoken = [row('r1')]
    const q = enqueue(EMPTY_QUEUE, propose(spec('reverse holo'), 'r1', spoken, 0, mint).actions)
    const corrected = [row('r1', { cardId: 'another-card', name: 'Another' })]
    const t = tick(q, corrected, 100, () => false)
    assert.equal(t.queue.pending[0].cardId, 'card-r1')
    const [a] = tick(t.queue, corrected, 60_000, () => false).due
    assert.equal(applyAction(corrected, a).record, null, 'refused, not re-aimed at the corrected card')
  })

  it('drops an edit whose row landed unidentified', () => {
    const q = enqueue(EMPTY_QUEUE, propose(spec('holo'), 'u', [], 0, mint).actions)
    const t = tick(q, [row('u', { cardId: null, matched: false })], 10, () => false)
    assert.equal(t.queue.pending.length, 0)
    assert.equal(t.dropped[0].ok, false)
  })

  it('settles everything with a row when the scan step ends, and lets the rest go', () => {
    let q = enqueue(EMPTY_QUEUE, propose(spec('holo'), 'r1', [], 0, mint).actions)
    q = enqueue(q, propose(spec('holo'), 'r2', [], 0, mint).actions)
    q = tick(q, [row('r1')], 0, () => true).queue
    const s = settleAll(q)
    assert.deepEqual(s.due.map((a) => a.rowId), ['r1'])
    assert.equal(s.queue.pending.length, 0)
  })

  it('cancels one pending change', () => {
    const q = enqueue(EMPTY_QUEUE, propose(spec('two reverse holos'), 'r1', [], 0, mint).actions)
    assert.deepEqual(at(cancel(q, q.pending[0].id)), ['r1:quantity'])
  })
})

describe('applying and undoing', () => {
  const due = (text: string | { kind: 'remove' }, rowId: string, feed: FeedEntry[]) => {
    const command = typeof text === 'string' ? spec(text) : text
    const q = tick(enqueue(EMPTY_QUEUE, propose(command, rowId, feed, 0, mint).actions), feed, 0, () => false).queue
    return tick(q, feed, 60_000, () => false).due
  }

  it('sets the printing as the reader’s own pick, and undo restores the default', () => {
    const feed = [row('r1', { name: 'Exeggcute' })]
    const [a] = due('reverse holo', 'r1', feed)
    const r = applyAction(feed, a)
    assert.equal(r.outcome.message, 'Exeggcute → Reverse Holofoil')
    assert.deepEqual([r.feed[0].variantId, r.feed[0].printingPicked], [2, true])
    const back = revert(r.feed, r.record!)
    assert.deepEqual([back[0].variantId, back[0].printingPicked], [1, false])
  })

  it('sets and restores a quantity', () => {
    const feed = [row('r1', { name: 'Exeggcute', quantity: 1 })]
    const r = applyAction(feed, due('three copies', 'r1', feed)[0])
    assert.equal(r.feed[0].quantity, 3)
    assert.equal(revert(r.feed, r.record!)[0].quantity, 1)
  })

  it('removes a row and puts it back in its place in scan order', () => {
    const feed = [row('r1'), row('r2', { name: 'Venonat' }), row('r3')]
    const r = applyAction(feed, due({ kind: 'remove' }, 'r2', feed)[0])
    assert.deepEqual(r.feed.map((e) => e.id), ['r1', 'r3'])
    assert.equal(r.outcome.message, 'Removed Venonat')
    assert.deepEqual(revert(r.feed, r.record!).map((e) => e.id), ['r1', 'r2', 'r3'])
    // Undoing twice cannot duplicate it.
    assert.deepEqual(revert(revert(r.feed, r.record!), r.record!).map((e) => e.id), ['r1', 'r2', 'r3'])
  })

  it('never applies a printing to a card the row has since been corrected into', () => {
    const feed = [row('r1')]
    const [a] = due('reverse holo', 'r1', feed)
    const corrected = [row('r1', { cardId: 'something-else', name: 'Other' })]
    const r = applyAction(corrected, a)
    assert.equal(r.record, null)
    assert.equal(r.feed, corrected)
    assert.equal(r.outcome.ok, false)
  })

  it('refuses to undo a printing onto a card the row has since been corrected into', () => {
    const feed = [row('r1', { name: 'Exeggcute' })]
    const r = applyAction(feed, due('reverse holo', 'r1', feed)[0])
    const corrected = r.feed.map((e) => ({ ...e, cardId: 'other', name: 'Other', variantId: 99 }))
    assert.equal(revertible(corrected, r.record!), false)
    assert.equal(revert(corrected, r.record!), corrected)
    assert.equal(revertible(r.feed, r.record!), true)
  })

  it('says so, and changes nothing, when the printings never loaded', () => {
    const feed = [row('r1', { name: 'Venonat', variants: [] })]
    const r = applyAction(feed, due('reverse holo', 'r1', feed)[0])
    assert.equal(r.record, null)
    assert.equal(r.outcome.message, 'Couldn’t load Venonat’s printings')
  })

  it('undo withdraws the newest pending change first, then walks back applied ones', () => {
    const feed = [row('r1')]
    const applied = applyAction(feed, due('two of those', 'r1', feed)[0])
    let q = remember(EMPTY_QUEUE, applied.record!)
    q = enqueue(q, propose(spec('reverse holo'), 'r1', applied.feed, 0, mint).actions)
    const first = undoLatest(q)
    assert.equal(first.cancelled?.kind, 'printing')
    assert.equal(first.reverted, null)
    const second = undoLatest(first.queue)
    assert.equal(second.reverted?.kind, 'quantity')
    assert.equal(undoLatest(second.queue).reverted, null)
  })
})

describe('naming', () => {
  it('offers identified rows, newest first, and never an unidentified one', () => {
    const feed = [row('r1', { name: 'Old' }), row('u', { cardId: null, name: 'Unidentified card' }), row('r2', { name: 'New' })]
    assert.deepEqual(namedRows(feed), [{ id: 'r2', name: 'New' }, { id: 'r1', name: 'Old' }])
  })

  it('orders by when the card was SCANNED, not when its row landed', () => {
    // Two Charizards identified out of order: the later scan landed first.
    const feed = [row('late', { name: 'Charizard', capturedAt: 2_000 }), row('early', { name: 'Charizard', capturedAt: 1_000 })]
    assert.deepEqual(namedRows(feed).map((r) => r.id), ['late', 'early'])
  })
})
