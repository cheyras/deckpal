// The dHash claim gate, 2026-10-09: on real phone crops the hash is a weak
// witness above distance 7 (scan benchmark: 13/18 right at 8, 14/31 at 9), so
// above PHASH_SOLO_MAX its top-1 stays in the picker and the capture waits for
// the resolve leg instead of being named by the hash alone.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ScanMatch, ScanResponse } from '../../../lib/api'
import { gateScanResponse, PHASH_SOLO_MAX, TIE_MARGIN } from '../tieGate'

function match(cardId: string, distance: number): ScanMatch {
  return {
    cardId,
    name: cardId,
    number: '1',
    setId: cardId.split('-')[0]!,
    setName: '',
    rarity: null,
    images: { low: '', high: '' },
    distance,
    confidence: 1 - distance / 64,
  }
}
const res = (matches: ScanMatch[]): ScanResponse =>
  ({ query: { algo: 'dhash8v3', hash: '' }, matched: true, threshold: 9, indexSize: 100, matches }) as ScanResponse

describe('gateScanResponse — the solo-claim distance', () => {
  it('lets a clear hit at PHASH_SOLO_MAX through', () => {
    const r = gateScanResponse(res([match('a-1', PHASH_SOLO_MAX), match('b-1', PHASH_SOLO_MAX + TIE_MARGIN)]))
    assert.equal(r?.matched, true)
  })

  it('withdraws the claim one bit above it, however clear the margin', () => {
    const r = gateScanResponse(res([match('a-1', PHASH_SOLO_MAX + 1), match('b-1', PHASH_SOLO_MAX + 1 + 10)]))
    assert.equal(r?.matched, false)
  })

  it('keeps the evidence when it withdraws the claim — the picker still needs the list', () => {
    const input = res([match('a-1', 9), match('b-1', 20)])
    const r = gateScanResponse(input)
    assert.deepEqual(r?.matches, input.matches)
  })

  it('sits below the server`s own matched bar, which is what makes it a separate gate', () => {
    assert.ok(PHASH_SOLO_MAX < 9)
  })
})
