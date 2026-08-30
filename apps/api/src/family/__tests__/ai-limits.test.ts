import assert from 'node:assert/strict'
import { test } from 'node:test'

import { FAMILY_AI_MODEL, familyAiGateStatus, nextMalaysiaMidnight } from '../../routes/familyAi.js'

test('quota resets at the next Malaysia midnight', () => {
  assert.equal(nextMalaysiaMidnight(new Date('2026-08-30T15:59:00.000Z')), '2026-08-30T16:00:00.000Z')
  assert.equal(nextMalaysiaMidnight(new Date('2026-08-30T16:01:00.000Z')), '2026-08-31T16:00:00.000Z')
})

test('AI health names the supported low-cost model but no key', () => {
  const status = familyAiGateStatus()
  assert.equal(status.model, FAMILY_AI_MODEL)
  assert.equal(Object.hasOwn(status, 'key'), false)
})
