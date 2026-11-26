// The server's vision read on the client: how its answer becomes an OCR read,
// and how that read is tagged on the way to /scan/resolve.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { ScanReadResponse } from '../../../lib/api'
import { toResolveBody } from '../resolveFields'
import { toServerRead } from '../serverRead'

const res = (over: Partial<ScanReadResponse> = {}): ScanReadResponse => ({
  isCard: true,
  isCardBack: false,
  fields: { name: 'Purrloin', number: '064', denominator: '103', setCode: 'DRI' },
  legibility: 'clear',
  model: 'anthropic/claude-sonnet-5.5',
  ms: 1800,
  ...over,
})

test('a read card becomes an OCR read with pass vlm', () => {
  assert.deepEqual(toServerRead(res()), {
    name: 'Purrloin',
    number: '064',
    denominator: '103',
    setCode: 'DRI',
    ms: 1800,
    pass: 'vlm',
  })
})

test('a card back, a non-card, or nothing legible is no read at all', () => {
  assert.equal(toServerRead(res({ isCardBack: true })), null)
  assert.equal(toServerRead(res({ isCard: false })), null)
  assert.equal(toServerRead(res({ fields: {} })), null)
})

test('body lines ride along when that is all there is', () => {
  const r = toServerRead(res({ fields: { bodyLines: ['Dig Claws'] } }))
  assert.deepEqual(r?.bodyLines, ['Dig Claws'])
  assert.equal(r?.name, null)
})

test('a vision read is tagged on the resolve body; device OCR keeps its old bytes', () => {
  const vlm = toResolveBody(toServerRead(res()), [{ cardId: 'sv01-001', distance: 12 }])
  assert.equal(vlm?.readSource, 'vlm')
  const ocr = toResolveBody(
    { name: 'Purrloin', number: '064', denominator: '103', setCode: null, ms: 900, pass: 'roi' },
    [{ cardId: 'sv01-001', distance: 12 }],
  )
  assert.equal(JSON.stringify(ocr).includes('readSource'), false)
})
