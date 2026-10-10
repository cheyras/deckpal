import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEEP_THINK_PLAN_LIMIT,
  DEEP_THINK_WHY_LIMIT,
  deepThinkCard,
} from '../deepThinkCard.js'

const approval = {
  name: 'deep_think',
  toolCallId: 'call_deep_1',
  input: {
    why: 'A season review can connect matchup patterns across all of your games.',
    plan: 'Compare matchups, identify repeated decisions, and build three practice goals.',
  },
}

test('builds the Deep Think offer from prose and a server-keyed estimate', () => {
  assert.deepEqual(deepThinkCard(approval, {
    toolCallId: 'call_deep_1',
    low: 38,
    high: 72,
  }), {
    title: 'Deep Think',
    why: approval.input.why,
    plan: approval.input.plan,
    cost: 'About 38–72 credits',
    approveLabel: 'Use Deep Think',
    declineLabel: 'Keep it quick',
    highEstimate: 72,
  })
})

test('falls back honestly when no matching server estimate arrived', () => {
  const absent = deepThinkCard(approval)
  assert.equal(absent?.cost, 'Costs more than a normal answer')
  assert.equal(absent?.highEstimate, null)

  const wrongCall = deepThinkCard(approval, { toolCallId: 'another_call', low: 1, high: 2 })
  assert.equal(wrongCall?.cost, 'Costs more than a normal answer')

  // Numbers in model prose are displayed as prose, never promoted into price.
  const modelNumber = deepThinkCard({
    ...approval,
    input: { why: 'This should cost 2 credits.', plan: 'Read 50 games.' },
  })
  assert.equal(modelNumber?.cost, 'Costs more than a normal answer')
})

test('clamps model prose while preserving its text verbatim below the limits', () => {
  const why = 'w'.repeat(DEEP_THINK_WHY_LIMIT + 20)
  const plan = 'p'.repeat(DEEP_THINK_PLAN_LIMIT + 20)
  const card = deepThinkCard({ ...approval, input: { why, plan } })

  assert.equal(card?.why.length, DEEP_THINK_WHY_LIMIT)
  assert.equal(card?.why, `${why.slice(0, DEEP_THINK_WHY_LIMIT - 1)}…`)
  assert.equal(card?.plan.length, DEEP_THINK_PLAN_LIMIT)
  assert.equal(card?.plan, `${plan.slice(0, DEEP_THINK_PLAN_LIMIT - 1)}…`)
  assert.equal(deepThinkCard(approval)?.why, approval.input.why)
})

test('does not produce a Deep Think card for another approval tool', () => {
  assert.equal(deepThinkCard({ ...approval, name: 'log_cards' }), null)
})
