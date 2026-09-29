import assert from 'node:assert/strict'
import test from 'node:test'
import { costLabel, eventOffset, sharingLabel } from '../DeckeChats.helpers.ts'

test('labels unknown and partial improvement costs without treating unknown as zero', () => {
  assert.equal(costLabel(null, 'unknown'), 'Unknown cost')
  assert.equal(costLabel('0.0042', 'partial'), '$0.0042 USD (partial)')
})

test('labels consent sources and animation offsets', () => {
  assert.equal(sharingLabel('decke_ask'), 'Asked')
  assert.equal(sharingLabel('feedback'), 'Feedback')
  assert.equal(eventOffset({ at: '2026-09-28T10:00:00.250Z' }, '2026-09-28T10:00:00.000Z'), '+250 ms')
})
