// Run: node --import tsx --test src/scan/ui/__tests__/*.test.ts
//
// WHAT GOES ON THE WIRE, AND WHAT HAPPENS WHEN THE OTHER END HAS NOT SHIPPED.
//
// Two properties, and the second is the one that decides whether this branch can
// be merged before the API lane's:
//
//  1. THE PAYLOAD IS A SET OF CLAIMS, and an absent field is not the same claim
//     as a null one. CROSSWALK §7.1: the energy and promo sets print no
//     denominator, so `SVE 017` is told apart from `SVI 017` BY THE ABSENCE —
//     which makes `denominator: null` on the wire an assertion we have no
//     grounds for. `bodyLines` inherits the rule: an empty array would be the
//     claim that this card has no readable text printed on it.
//
//  2. AN OLDER BACKEND MUST DEGRADE TO TODAY. `pnpm dev` talks to the LIVE
//     backend (CLAUDE.md), the API lane ships independently of this one, and
//     `/scan/resolve` has been deployed without a family-text rung for as long
//     as it has existed. So "this app has the code and that server does not" is
//     the ORDINARY case during development, not an edge one. A server that
//     ignores `bodyLines` answers `prior-only` and unconfident; the tests below
//     put that answer through the shipping judgement and check it changes
//     nothing.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ScanResolveResponse } from '../../../lib/api'
import type { OcrRead } from '../../ocr/pipeline'
import { resolvedIdentity } from '../identity'
import { hasAnySignal, toResolveFields } from '../resolveFields'

function read(over: Partial<OcrRead> = {}): OcrRead {
  return { name: null, number: null, denominator: null, setCode: null, pass: 'roi', ms: 340, ...over }
}

describe('the resolve payload', () => {
  it('omits every field it did not read', () => {
    assert.deepEqual(toResolveFields(read()), {})
    assert.deepEqual(toResolveFields(read({ number: '161' })), { number: '161' })
  })

  it('sends the whole printed key when the bands read one', () => {
    assert.deepEqual(
      toResolveFields(read({ name: "Arven's Sandwich", number: '161', denominator: '182', setCode: 'DRI' })),
      { name: "Arven's Sandwich", number: '161', denominator: '182', setCode: 'DRI' },
    )
  })

  it('CARRIES bodyLines, and only as the escalation produced them', () => {
    const lines = ['Ability Rocket Brain', 'often as you like during your turn,you may move']
    assert.deepEqual(toResolveFields(read({ pass: 'escalated', bodyLines: lines })), { bodyLines: lines })
  })

  it('never sends an EMPTY bodyLines — that would be a claim', () => {
    // Same rule as the denominator's, one field along: "we read no text" and "we
    // never got that far" are different statements and only one of them is true.
    assert.deepEqual(toResolveFields(read({ pass: 'escalated', bodyLines: [] })), {})
    assert.equal('bodyLines' in toResolveFields(read({ pass: 'escalated', bodyLines: [] })), false)
  })

  it('spends a round trip on bodyLines alone', () => {
    // The crop the shipped recipe reads nothing off is precisely the crop the
    // narrowing call exists for, so declining here would switch the feature off
    // in the case it was built for.
    assert.equal(hasAnySignal(read()), false)
    assert.equal(hasAnySignal(read({ pass: 'escalated', bodyLines: [] })), false)
    assert.equal(hasAnySignal(read({ pass: 'escalated', bodyLines: ['Deceit'] })), true)
    assert.equal(hasAnySignal(read({ number: '161' })), true)
  })
})

describe('a backend without the family-text rung', () => {
  /** What `/scan/resolve` answers today when it is handed fields it cannot
   *  resolve on: it re-ranks the priors and says so. */
  const priorOnly: ScanResolveResponse = {
    matched: true,
    confident: false,
    resolvedBy: 'prior-only',
    matches: [
      {
        cardId: 'sv10-127',
        name: "Team Rocket's Murkrow",
        number: '127',
        setId: 'sv10',
        setName: 'Destined Rivals',
        rarity: 'Common',
        images: { low: 'l', high: 'h' },
        distance: 7,
        confidence: 0.89,
      },
    ],
  }

  it('changes nothing — the capture stays where it was', () => {
    // `resolvedIdentity` is the single place both callers ask whether the ladder
    // may present its answer as the card (`identity.ts`). Unconfident is
    // unconfident whether the server understood `bodyLines` or dropped it.
    assert.equal(resolvedIdentity(priorOnly), null)
  })

  it('is indistinguishable from the answer it gave before bodyLines existed', () => {
    assert.equal(resolvedIdentity({ ...priorOnly, matched: false, matches: [] }), null)
  })

  it('and a rung that DOES understand them names the card', () => {
    // The contract this branch codes against: same response shape, a new value
    // in `resolvedBy` is not required for the client to work, and `confident` +
    // `matched` remain the whole test.
    const named = { ...priorOnly, confident: true }
    assert.equal(resolvedIdentity(named)?.cardId, 'sv10-127')
  })
})
