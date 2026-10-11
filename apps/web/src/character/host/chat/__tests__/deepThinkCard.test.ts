import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  DEEP_THINK_PLAN_LIMIT,
  DEEP_THINK_WHY_LIMIT,
  deepThinkCard,
  parseDeepThinkOffer,
  type DeepThinkOffer,
} from '../deepThinkCard.js'

const approval = {
  name: 'deep_think',
  toolCallId: 'call_deep_1',
  input: {
    why: 'A season review can connect matchup patterns across all of your games.',
    plan: 'Compare matchups, identify repeated decisions, and build three practice goals.',
  },
}
const priced: DeepThinkOffer = { toolCallId: 'call_deep_1', token: 'dt1.offer', estimate: { low: 38, high: 72 } }
const uncharged: DeepThinkOffer = { toolCallId: 'call_deep_1', token: 'dt1.offer', estimate: null }
const wallet = (balance: number | null, canTopUp = true) => ({ balance, canTopUp })

test('builds the priced Deep Think offer from prose and the server-keyed estimate', () => {
  assert.deepEqual(deepThinkCard(approval, priced, wallet(200)), {
    title: 'Deep Think',
    why: approval.input.why,
    plan: approval.input.plan,
    cost: 'About 38–72 credits',
    approveLabel: 'Use Deep Think',
    declineLabel: 'Keep it quick',
    highEstimate: 72,
    action: 'approve',
    hint: null,
  })
})

test('a priced offer cannot be approved while the balance is still unknown', () => {
  const waiting = deepThinkCard(approval, priced, wallet(null))
  assert.equal(waiting?.action, 'wait')
  assert.equal(waiting?.hint, 'Checking your balance…')
  assert.equal(waiting?.cost, 'About 38–72 credits')
  // The default wallet is the unknown one: nothing approves by omission.
  assert.equal(deepThinkCard(approval, priced)?.action, 'wait')
})

test('a short balance tops up instead, judged against the HIGH end of the range', () => {
  assert.equal(deepThinkCard(approval, priced, wallet(71))?.action, 'top-up')
  assert.equal(deepThinkCard(approval, priced, wallet(72))?.action, 'approve')
  // Nowhere to top up: the reader may still choose to go ahead.
  assert.equal(deepThinkCard(approval, priced, wallet(10, false))?.action, 'approve')
})

test('an uncharged account sees no price line and needs no balance', () => {
  const card = deepThinkCard(approval, uncharged, wallet(null))
  assert.equal(card?.cost, null)
  assert.equal(card?.highEstimate, null)
  assert.equal(card?.action, 'approve')
  assert.equal(card?.hint, null)
})

test('without the server offer for this call the card cannot approve, and says why', () => {
  for (const offer of [null, undefined, { ...priced, toolCallId: 'another_call' }, { ...priced, token: '' }]) {
    const card = deepThinkCard(approval, offer, wallet(500))
    assert.equal(card?.action, 'unavailable', JSON.stringify(offer))
    assert.equal(card?.cost, 'Costs more than a normal answer')
    assert.equal(card?.highEstimate, null)
    assert.match(card?.hint ?? '', /can't start/)
  }
  // Numbers in model prose are displayed as prose, never promoted into price.
  const modelNumber = deepThinkCard({ ...approval, input: { why: 'This should cost 2 credits.', plan: 'Read 50 games.' } })
  assert.equal(modelNumber?.cost, 'Costs more than a normal answer')
})

test('the offer part is read strictly', () => {
  assert.deepEqual(parseDeepThinkOffer({ toolCallId: 'c', token: 't', estimate: { low: 40, high: 120 } }),
    { toolCallId: 'c', token: 't', estimate: { low: 40, high: 120 } })
  assert.deepEqual(parseDeepThinkOffer({ toolCallId: 'c', token: 't', estimate: null }),
    { toolCallId: 'c', token: 't', estimate: null })
  for (const bad of [
    null,
    'offer',
    { token: 't', estimate: null },
    { toolCallId: ' ', token: 't', estimate: null },
    { toolCallId: 'c', estimate: null },
    { toolCallId: 'c', token: 't' },
    { toolCallId: 'c', token: 't', estimate: { low: 120, high: 40 } },
    { toolCallId: 'c', token: 't', estimate: { low: -1, high: 40 } },
    { toolCallId: 'c', token: 't', estimate: { low: 1.5, high: 40 } },
    { toolCallId: 'c', token: 't', estimate: { low: '40', high: 120 } },
    { toolCallId: 'c', token: 'x'.repeat(201), estimate: null },
  ]) {
    assert.equal(parseDeepThinkOffer(bad), null, JSON.stringify(bad))
  }
})

test('clamps model prose while preserving its text verbatim below the limits', () => {
  const why = 'w'.repeat(DEEP_THINK_WHY_LIMIT + 20)
  const plan = 'p'.repeat(DEEP_THINK_PLAN_LIMIT + 20)
  const card = deepThinkCard({ ...approval, input: { why, plan } }, priced, wallet(200))

  assert.equal(card?.why.length, DEEP_THINK_WHY_LIMIT)
  assert.equal(card?.why, `${why.slice(0, DEEP_THINK_WHY_LIMIT - 1)}…`)
  assert.equal(card?.plan.length, DEEP_THINK_PLAN_LIMIT)
  assert.equal(card?.plan, `${plan.slice(0, DEEP_THINK_PLAN_LIMIT - 1)}…`)
  assert.equal(deepThinkCard(approval)?.why, approval.input.why)
})

test('the card shows every character the tool schema allows, and no more', () => {
  // One limit in two places: `deep_think`'s schema in the API, and this clamp.
  const tools = readFileSync(new URL('../../../../../../api/src/decke/tools.ts', import.meta.url), 'utf8')
  const deep = tools.slice(tools.indexOf('[DEEP_THINK_TOOL]: tool({'))
  assert.equal(Number(/why: z\.string\(\)\.trim\(\)\.min\(1\)\.max\((\d+)\)/.exec(deep)?.[1]), DEEP_THINK_WHY_LIMIT)
  assert.equal(Number(/plan: z\.string\(\)\.trim\(\)\.min\(1\)\.max\((\d+)\)/.exec(deep)?.[1]), DEEP_THINK_PLAN_LIMIT)
  const longest = deepThinkCard(
    { ...approval, input: { why: 'w'.repeat(DEEP_THINK_WHY_LIMIT), plan: 'p'.repeat(DEEP_THINK_PLAN_LIMIT) } },
    priced,
    wallet(200),
  )
  assert.equal(longest?.why.endsWith('…'), false)
  assert.equal(longest?.plan.endsWith('…'), false)
})

test('does not produce a Deep Think card for another approval tool', () => {
  assert.equal(deepThinkCard({ ...approval, name: 'log_cards' }, priced, wallet(200)), null)
})
