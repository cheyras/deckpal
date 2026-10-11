import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JEV_VAR } from '../jev.js'
import {
  JEV_ROUTE_CONFIDENCE, jevRouteConfidence, jevRouteEnabled, jevRouteQuestions, jevRouteState, jevRouteTriage, readJevRoute,
} from '../jevRoute.js'
import { PATHWAY_META, PATHWAY_NAMES } from '../pathways/names.js'

const choice = (pick: string, probabilities: Record<string, number>, confidence: number | null = null) =>
  ({ type: 'choice' as const, choice: pick, probabilities, confidence })
const yes = (probability: number) => ({ type: 'boolean' as const, probability })
const answers = (o: Partial<Record<string, unknown>> = {}) => ({
  pathway: choice('card_rules', { card_rules: 0.9, price_value: 0.05 }, 0.9),
  correction: yes(0.1), dissatisfied: yes(0.1), wants_depth: yes(0.1), large_analysis: yes(0.1), asks_why: yes(0.1),
  ...o,
}) as never

const respond = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as never

async function withJev<T>(fn: () => Promise<T>): Promise<T> {
  const before = process.env[JEV_VAR]
  process.env[JEV_VAR] = 'on'
  try { return await fn() } finally {
    if (before === undefined) delete process.env[JEV_VAR]
    else process.env[JEV_VAR] = before
  }
}

test('the pathway question offers every pathway, each with its own summary', () => {
  const q = jevRouteQuestions()
  assert.equal(q.pathway.type, 'choice')
  assert.deepEqual(Object.keys((q.pathway as { criteria: object }).criteria), [...PATHWAY_NAMES])
  for (const name of PATHWAY_NAMES) assert.equal((q.pathway as { criteria: Record<string, string> }).criteria[name], PATHWAY_META[name].summary)
  assert.deepEqual(Object.keys(q), ['pathway', 'correction', 'dissatisfied', 'wants_depth', 'large_analysis', 'asks_why'])
})

test('Jev reads the same clipped fields the reflex does, plus what code already knows', () => {
  const state = jevRouteState({ message: 'x'.repeat(3_000), previousReply: 'y'.repeat(1_000), page: '/decks', pasted: true, answering: { about: 'battle_log' } })
  assert.equal(state.reader_latest_message.length, 2_000)
  assert.equal(state.deckes_previous_reply.length, 800)
  assert.equal(state.pasted_game_log, true)
  assert.equal(state.answering_questions_about, 'battle_log')
})

test("Jev's answers become a Triage with the code rules Haiku's get", () => {
  const base = { message: 'what does it do', answering: null }
  assert.deepEqual(jevRouteTriage(answers(), base), {
    pathway: 'card_rules', also: null, signals: [], missing: [], wantsDeep: 'no', source: 'jev',
  })
  // A likely second pathway joins; signals count from one half.
  const mixed = jevRouteTriage(answers({
    pathway: choice('card_rules', { card_rules: 0.55, price_value: 0.4 }), correction: yes(0.8), wants_depth: yes(0.6),
  }), base)
  assert.equal(mixed.also, 'price_value')
  assert.deepEqual(mixed.signals, ['correction'])
  assert.equal(mixed.wantsDeep, 'requested')
  // A decline is never a correction.
  assert.deepEqual(jevRouteTriage(answers({ correction: yes(0.95) }), { message: "wait no, don't log that one", answering: null }).signals, [])
  // An ask card's own pathway wins.
  assert.equal(jevRouteTriage(answers(), { message: 'Standard', answering: { about: 'deck_build' } }).pathway, 'deck_build')
  // Asking why a logged game went wrong is a review, and still logs it.
  const why = jevRouteTriage(answers({ pathway: choice('battle_log', { battle_log: 0.9 }), asks_why: yes(0.8) }), base)
  assert.equal(why.pathway, 'battle_review')
  assert.equal(why.also, 'battle_log')
  assert.ok(why.signals.includes('asks_why'))
})

test("confidence is Jev's own for the pathway, else its top probability", () => {
  assert.equal(jevRouteConfidence(answers({ pathway: choice('lists', { lists: 0.7 }, 0.4) })), 0.4)
  assert.equal(jevRouteConfidence(answers({ pathway: choice('lists', { lists: 0.7, general: 0.3 }) })), 0.7)
  assert.equal(jevRouteConfidence(undefined), 0)
})

test('a sure answer is a route; an unsure one is only a candidate, and Haiku decides', async () => {
  await withJev(async () => {
    const input = { message: 'what does Cursed Blast do', pasted: false }
    const sure = await readJevRoute(input, { key: 'k', fetchImpl: respond({ answers: answers() }) })
    assert.equal(sure.route?.pathway, 'card_rules')
    assert.equal(sure.confidence, 0.9)
    const unsure = await readJevRoute(input, {
      key: 'k', fetchImpl: respond({ answers: answers({ pathway: choice('card_rules', { card_rules: 0.5, general: 0.5 }, 0.5) }) }),
    })
    assert.equal(unsure.route, null)
    assert.equal(unsure.candidate?.pathway, 'card_rules')
    assert.ok(JEV_ROUTE_CONFIDENCE > 0.5)
  })
})

test('every failure is "no route": Jev off, no key, an HTTP error, a malformed answer, an empty message', async () => {
  const input = { message: 'hi', pasted: false }
  const before = process.env[JEV_VAR]
  delete process.env[JEV_VAR]
  try {
    assert.equal((await readJevRoute(input, { key: 'k', fetchImpl: respond({ answers: answers() }) })).route, null, 'Jev is off by default')
  } finally { if (before !== undefined) process.env[JEV_VAR] = before }
  await withJev(async () => {
    assert.equal((await readJevRoute(input, { key: null, fetchImpl: respond({ answers: answers() }) })).route, null)
    assert.equal((await readJevRoute(input, { key: 'k', fetchImpl: respond({ error: 'x' }, 500) })).route, null)
    assert.equal((await readJevRoute(input, { key: 'k', fetchImpl: respond({ answers: { pathway: choice('nope', {}) } }) })).route, null)
    assert.equal((await readJevRoute({ message: '   ', pasted: false }, { key: 'k', fetchImpl: respond({ answers: answers() }) })).route, null)
  })
})

test('a large analysis is an offer; an explicit ask for depth stays a request', () => {
  const base = { message: 'regionals in 2 weeks, what is winning?', answering: null }
  assert.equal(jevRouteTriage(answers({ pathway: choice('research', { research: 0.95 }, 0.95), large_analysis: yes(0.8) }), base).wantsDeep, 'offer')
  assert.equal(jevRouteTriage(answers({ large_analysis: yes(0.8), wants_depth: yes(0.9) }), base).wantsDeep, 'requested')
  assert.equal(jevRouteTriage(answers({ large_analysis: yes(0.2) }), base).wantsDeep, 'no')
  assert.ok(Object.keys(jevRouteQuestions()).includes('large_analysis'))
})

test("an ask card's pathway brings no runner-up, and an ask card without one is still an answer", () => {
  const t = jevRouteTriage(answers({ pathway: choice('card_rules', { card_rules: 0.5, price_value: 0.45 }) }), { message: 'Standard', answering: { about: 'deck_build' } })
  assert.equal(t.pathway, 'deck_build')
  assert.equal(t.also, null)
  assert.equal(jevRouteState({ message: 'x', pasted: false, answering: {} }).answering_deckes_questions, true)
  assert.equal(jevRouteState({ message: 'x', pasted: false, answering: null }).answering_deckes_questions, false)
})

test('DECKE_JEV_ROUTE: unset or on routes, off does not, anything else is off', () => {
  assert.equal(jevRouteEnabled({}), true)
  assert.equal(jevRouteEnabled({ DECKE_JEV_ROUTE: 'on' }), true)
  assert.equal(jevRouteEnabled({ DECKE_JEV_ROUTE: 'off' }), false)
  assert.equal(jevRouteEnabled({ DECKE_JEV_ROUTE: 'yes' }), false)
})
