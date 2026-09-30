import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  EXPRESS_GRACE_MS,
  workPoseAllowedAfterExpress,
  workPoseFor,
  workingStateFor,
} from '../activityAnimation'

test('activity kinds choose poses that fit the work', () => {
  assert.equal(workingStateFor('catalog', 0), 'card_show')
  assert.equal(workingStateFor('research', 0), 'loading')
  assert.equal(workingStateFor('write', 0), 'card_stash')
  assert.equal(workingStateFor('show', 0), 'card_present')
  assert.equal(workingStateFor('move', 0), 'point')
})

test('a cycle never immediately repeats its current pose', () => {
  for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
    assert.notEqual(workPoseFor('research', 'loading', false, roll), 'loading')
    assert.notEqual(workPoseFor('catalog', 'card_show', false, roll), 'card_show')
  }
})

test('reduced motion disables work-pose cycling', () => {
  assert.equal(workPoseFor('research', null, true, 0), null)
})

test('an express move only suppresses work poses while its gesture finishes', () => {
  const expressedAt = 10_000
  assert.equal(workPoseAllowedAfterExpress(expressedAt, expressedAt + EXPRESS_GRACE_MS - 1), false)
  assert.equal(workPoseAllowedAfterExpress(expressedAt, expressedAt + EXPRESS_GRACE_MS), true)
})
