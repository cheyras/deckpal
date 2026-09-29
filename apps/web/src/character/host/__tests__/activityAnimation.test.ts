import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ACTIVITY_BEAT_COOLDOWN_MS,
  SLEEP_IDLE_MS,
  TYPING_IDLE_MS,
  createActivityAnimator,
  stepBeat,
  workingStateFor,
} from '../activityAnimation'

const animator = (reducedMotion = false) => {
  let time = 100_000
  return {
    policy: createActivityAnimator({ now: () => time, reducedMotion }),
    advance: (ms: number) => { time += ms },
  }
}

test('a completed step returns its accent to the current working state', () => {
  const { policy } = animator()
  policy.turnStarted()
  assert.deepEqual(policy.stepStarted('research'), { state: 'loading', mode: 'sustain', talk: false })
  assert.deepEqual(policy.stepFinished('research', 'ok'), {
    state: 'nod_yes', mode: 'once', then: 'loading', talk: false,
  })
})

test('consecutive steps vary the sustained work pose', () => {
  const { policy } = animator()
  policy.turnStarted()
  const first = policy.stepStarted('catalog')
  const second = policy.stepStarted('catalog')
  assert.equal(first?.state, 'curious')
  assert.equal(second?.state, 'thinking')
  assert.notEqual(workingStateFor('research', 0), workingStateFor('research', 1))
})

test('bad outcomes have no completion accent', () => {
  const { policy } = animator()
  policy.turnStarted()
  policy.stepStarted('check')
  assert.equal(policy.stepFinished('check', 'error'), null)
  assert.equal(policy.stepFinished('check', 'partial'), null)
  assert.equal(policy.stepFinished('check', 'declined'), null)
  assert.equal(stepBeat('check', 'error'), null)
})

test('research-source and price accents are each used at most once per turn', () => {
  const { policy, advance } = animator()
  policy.turnStarted()
  policy.stepStarted('research')
  assert.equal(policy.stepFinished('research', 'ok', { hasSources: true })?.state, 'alert_star')
  advance(ACTIVITY_BEAT_COOLDOWN_MS)
  policy.stepStarted('research')
  assert.equal(policy.stepFinished('research', 'ok', { hasSources: true }), null)
  policy.stepStarted('prices')
  assert.equal(policy.stepFinished('prices', 'ok')?.state, 'alert_money')
  advance(ACTIVITY_BEAT_COOLDOWN_MS)
  policy.stepStarted('prices')
  assert.equal(policy.stepFinished('prices', 'ok'), null)
})

test('completion accents respect the cooldown', () => {
  const { policy, advance } = animator()
  policy.turnStarted()
  policy.stepStarted('check')
  assert.ok(policy.stepFinished('check', 'ok'))
  policy.stepStarted('check')
  assert.equal(policy.stepFinished('check', 'ok'), null)
  advance(ACTIVITY_BEAT_COOLDOWN_MS)
  assert.ok(policy.stepFinished('check', 'ok'))
})

test('a new tool step stops the talk overlay', () => {
  const { policy } = animator()
  policy.turnStarted()
  assert.deepEqual(policy.textStarted(), { talk: true })
  assert.equal(policy.stepStarted('check')?.talk, false)
})

test('approval gestures at the card and returns to thinking when answered', () => {
  const { policy } = animator()
  policy.turnStarted()
  assert.deepEqual(policy.approvalShown(), { state: 'point', mode: 'sustain', talk: false })
  assert.deepEqual(policy.approvalAnswered(), { state: 'thinking', mode: 'sustain', talk: false })
})

test('typing listens, then idles after the composer settles', () => {
  const { policy } = animator()
  assert.deepEqual(policy.composerTyping(true), { state: 'listening', mode: 'sustain' })
  assert.equal(policy.composerTyping(false), null)
  assert.deepEqual(policy.idleFor(TYPING_IDLE_MS), { state: 'idle', mode: 'sustain' })
})

test('an open, inactive panel sleeps after ninety seconds', () => {
  const { policy } = animator()
  assert.deepEqual(policy.idleFor(SLEEP_IDLE_MS), { state: 'sleep', mode: 'sustain' })
})

test('reduced motion leaves only the turn thinking and idle transitions', () => {
  const { policy } = animator(true)
  assert.deepEqual(policy.turnStarted(), { state: 'thinking', mode: 'sustain', talk: false })
  assert.equal(policy.stepStarted('research'), null)
  assert.equal(policy.textStarted(), null)
  assert.equal(policy.composerTyping(true), null)
  assert.equal(policy.idleFor(SLEEP_IDLE_MS), null)
  assert.deepEqual(policy.turnEnded(false), { state: 'idle', mode: 'sustain', talk: false })
})

test('a model-selected pose is not overwritten at turn end', () => {
  const { policy } = animator()
  policy.turnStarted()
  assert.equal(policy.turnEnded(true), null)
})
