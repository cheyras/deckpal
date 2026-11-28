// Same card or not, after the fact (repeat.ts): the design's §2.3 table row by
// row, and the two cases from the owner's 2026-11-27 session it names.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { OcrRead } from '../../ocr/pipeline'
import { initialIdentity, type Identity, type IdentityState } from '../identity'
import {
  captureLookDistance,
  DRIFT_DISCARD_LOOK_MAX,
  identityKeyOf,
  normName,
  normNumber,
  resolveRepeat,
  SAME_AFTER_BREAK,
  sameCard,
} from '../repeat'
import { capturedTurned, lookOf } from './lookScenes'
import { captureLook } from '../../engine/look'

function card(cardId: string, name: string, number: string): Identity {
  return { cardId, name, number, setName: 'White Flare', setId: 'sv10.5w', rarity: null, images: { low: '', high: '' }, distance: 4, confidence: 0.9, similarity: null }
}
const confident = (c: Identity): IdentityState => ({ ...initialIdentity(), phase: 'confident', match: c })
const read = (name: string | null, number: string | null = null): IdentityState => ({
  ...initialIdentity(),
  phase: 'needs-you',
  read: { name, number, denominator: null, setCode: null, ms: 800, pass: 'fast' } as unknown as OcrRead,
})

const HERDIER = card('sv10.5w-075', 'Herdier', '075')
const LILLIPUP = card('sv10.5w-074', 'Lillipup', '074')
const CHEREN = card('sv10.5w-084', "Cheren's Care", '084')

describe('repeat — who is the same card', () => {
  it('names and numbers are normalised: case, accents, padding', () => {
    assert.equal(normName('Poké Ball'), 'poke ball')
    assert.equal(normName('  ENERGY   retrieval '), 'energy retrieval')
    assert.equal(normName('Mew'), null, 'three letters is too weak to call two cards the same')
    assert.equal(normNumber('082'), '82')
    assert.equal(normNumber('TG07'), 'TG07')
  })

  it('two confident cards are the same only by card id', () => {
    assert.equal(sameCard(identityKeyOf(confident(HERDIER)), identityKeyOf(confident(HERDIER))), true)
    assert.equal(sameCard(identityKeyOf(confident(HERDIER)), identityKeyOf(confident(CHEREN))), false)
    // Same name, different printing: different ids, so not the same card here.
    assert.equal(sameCard(identityKeyOf(confident(HERDIER)), identityKeyOf(confident({ ...HERDIER, cardId: 'sv01-147' }))), false)
  })

  it('otherwise by the read name, and the number where both have one', () => {
    assert.equal(sameCard(identityKeyOf(read('Energy Retrieval')), identityKeyOf(read('ENERGY RETRIEVAL'))), true)
    assert.equal(sameCard(identityKeyOf(read('Energy Retrieval', '082')), identityKeyOf(read('Energy Retrieval', '82'))), true)
    assert.equal(sameCard(identityKeyOf(read('Energy Retrieval', '082')), identityKeyOf(read('Energy Retrieval', '160'))), false)
    assert.equal(sameCard(identityKeyOf(confident(HERDIER)), identityKeyOf(read('Herdier'))), true, 'a confident card against a read: by name')
    assert.equal(sameCard(identityKeyOf(confident(HERDIER)), identityKeyOf(read('Lillipup'))), false)
  })

  it('nothing usable on either side is "cannot say", never "same"', () => {
    assert.equal(identityKeyOf(read(null)), null)
    assert.equal(identityKeyOf(read('Mew')), null)
    assert.equal(identityKeyOf(initialIdentity()), null, 'a pending capture')
    assert.equal(sameCard(identityKeyOf(read(null)), identityKeyOf(confident(HERDIER))), null)
    assert.equal(sameCard(null, null), null)
  })
})

describe('repeat — the §2.3 table, row by row', () => {
  it('the default is keep-flagged', () => {
    assert.equal(SAME_AFTER_BREAK, 'keep-flagged')
  })

  it('first and manual: always a plain row', () => {
    for (const same of [true, false, null]) {
      assert.deepEqual(resolveRepeat({ kind: 'first', same }), { action: 'row', promoted: false })
      assert.deepEqual(resolveRepeat({ kind: 'manual', same }), { action: 'row', promoted: false })
    }
  })

  it('"Scan again" is a manual capture that is flagged like any other when it names the same card', () => {
    assert.deepEqual(resolveRepeat({ kind: 'manual', same: true, scanAgain: true }), { action: 'flagged', promoted: false })
    assert.deepEqual(resolveRepeat({ kind: 'manual', same: true, scanAgain: true, mode: 'ask' }), { action: 'flagged', promoted: false }, 'never asked: the reader just asked for it')
    assert.deepEqual(resolveRepeat({ kind: 'manual', same: false, scanAgain: true }), { action: 'row', promoted: false })
  })

  it('disturbed: different is a row, same is a flagged row, unknown is a row', () => {
    assert.deepEqual(resolveRepeat({ kind: 'disturbed', same: false }), { action: 'row', promoted: false })
    assert.deepEqual(resolveRepeat({ kind: 'disturbed', same: true }), { action: 'flagged', promoted: false })
    assert.deepEqual(resolveRepeat({ kind: 'disturbed', same: null }), { action: 'row', promoted: false })
  })

  it("disturbed, SAME_AFTER_BREAK 'ask': the same card is held to ask, never dropped", () => {
    assert.deepEqual(resolveRepeat({ kind: 'disturbed', same: true, mode: 'ask' }), { action: 'ask', promoted: false })
    assert.deepEqual(resolveRepeat({ kind: 'disturbed', same: false, mode: 'ask' }), { action: 'row', promoted: false })
  })

  it('drift: different is promoted; same and close is the one silent drop; the rest promoted and flagged', () => {
    assert.deepEqual(resolveRepeat({ kind: 'drift', same: false, lookDistance: 0.2 }), { action: 'row', promoted: true })
    assert.deepEqual(resolveRepeat({ kind: 'drift', same: true, lookDistance: DRIFT_DISCARD_LOOK_MAX }), { action: 'discard', promoted: false })
    assert.deepEqual(resolveRepeat({ kind: 'drift', same: true, lookDistance: DRIFT_DISCARD_LOOK_MAX + 0.01 }), { action: 'flagged', promoted: true })
    assert.deepEqual(resolveRepeat({ kind: 'drift', same: true, lookDistance: null }), { action: 'flagged', promoted: true }, 'no look to say it is close')
    assert.deepEqual(resolveRepeat({ kind: 'drift', same: null, lookDistance: 0.1 }), { action: 'flagged', promoted: true })
  })

  it('the drift drop is judged on the two captures’ looks, through their quarter turns', () => {
    const a = captureLook(capturedTurned(1, 0))
    const turned = captureLook(capturedTurned(1, 1))
    assert.ok(captureLookDistance(a, turned)! <= DRIFT_DISCARD_LOOK_MAX, 'the same card captured sideways is still close')
    assert.ok(captureLookDistance(a, captureLook(capturedTurned(2, 0)))! > DRIFT_DISCARD_LOOK_MAX)
    assert.equal(captureLookDistance(a, null), null)
    assert.ok(lookOf(1))
  })
})

describe('repeat — the owner’s 2026-11-27 session', () => {
  it('Energy Retrieval twice, both unnamed and both reading "Energy Retrieval": the second is flagged', () => {
    const same = sameCard(identityKeyOf(read('Energy Retrieval')), identityKeyOf(read('Energy Retrieval')))
    assert.equal(same, true)
    assert.equal(resolveRepeat({ kind: 'disturbed', same }).action, 'flagged')
  })

  it('Lillipup read as Herdier after a Herdier: a flagged row — the row he would look at — not a drop', () => {
    // The identity ladder named Lillipup "Herdier" (S4). Same id as the Herdier
    // before it, so the flag says "Same as last scan": wrong, and loud, and one
    // tap to fix. What it must not do is lose the card.
    const herdier = identityKeyOf(confident(HERDIER))
    const misread = identityKeyOf(confident(HERDIER))
    const r = resolveRepeat({ kind: 'disturbed', same: sameCard(misread, herdier) })
    assert.deepEqual(r, { action: 'flagged', promoted: false })
    assert.notEqual(r.action, 'discard')
    // Read right, it is a plain row.
    assert.equal(resolveRepeat({ kind: 'disturbed', same: sameCard(identityKeyOf(confident(LILLIPUP)), herdier) }).action, 'row')
  })

  it('Cheren after Herdier, flipped in place: a plain row (the design’s whole point)', () => {
    const r = resolveRepeat({ kind: 'disturbed', same: sameCard(identityKeyOf(confident(CHEREN)), identityKeyOf(confident(HERDIER))) })
    assert.deepEqual(r, { action: 'row', promoted: false })
  })
})
