import assert from 'node:assert/strict'
import test from 'node:test'
import { hybridRows, jevConfidence, jevTriage, parseArgs, routeQuestions, summarizeRouter, USAGE } from '../decke-jev-route-eval.mjs'

const choice = (choice, probabilities, confidence = null) => ({ type: 'choice', choice, probabilities, confidence })
const yes = (p) => ({ type: 'boolean', probability: p })

test('--help is the usage, and a bare run needs no flags to parse', () => {
  assert.match(USAGE, /--no-zdr/)
  assert.deepEqual(parseArgs([]), { cases: null, repeat: 1, budgetUsd: 0.5, out: null, noZdr: false })
  assert.throws(() => parseArgs(['--budget-usd', '0']), /positive/)
  assert.equal(parseArgs(['--cases', 'a,b']).cases.length, 2)
})

test('the pathway question offers every pathway with its own summary', () => {
  const q = routeQuestions({ a: { summary: 'A job' }, b: { summary: 'B job' } }, ['a', 'b'])
  assert.deepEqual(q.pathway.criteria, { a: 'A job', b: 'B job' })
  assert.deepEqual(Object.keys(q), ['pathway', 'correction', 'dissatisfied', 'wants_depth'])
})

test("Jev's answers become a Triage: a second pathway only when likely, signals above half, the decline rule applied", () => {
  const answers = {
    pathway: choice('card_rules', { card_rules: 0.6, price_value: 0.35, general: 0.05 }),
    correction: yes(0.9), dissatisfied: yes(0.2), wants_depth: yes(0.7),
  }
  const t = jevTriage(answers, { isDecline: () => false, message: 'x' })
  assert.deepEqual(t, { pathway: 'card_rules', also: 'price_value', signals: ['correction'], missing: [], wantsDeep: 'requested', source: 'jev' })
  assert.deepEqual(jevTriage(answers, { isDecline: () => true, message: 'never mind' }).signals, [])
  const lone = jevTriage({ ...answers, pathway: choice('lists', { lists: 0.9, general: 0.1 }) }, { isDecline: () => false, message: 'x' })
  assert.equal(lone.also, null)
})

test('confidence is Jev\'s own when given, else the top probability', () => {
  assert.equal(jevConfidence({ pathway: choice('a', { a: 0.7 }, 0.4) }), 0.4)
  assert.equal(jevConfidence({ pathway: choice('a', { a: 0.7, b: 0.3 }) }), 0.7)
  assert.equal(jevConfidence(undefined), 0)
})

test('the hybrid takes Jev only above the threshold, and waits for the slower call otherwise', () => {
  const pair = (conf, jevOk, haikuOk) => ({
    jev: { confidence: conf, ms: 250, score: { primary: jevOk, acceptable: jevOk, tierOk: jevOk, tierMiss: jevOk ? null : 'under' } },
    haiku: { ms: 1100, score: { primary: haikuOk, acceptable: haikuOk, tierOk: haikuOk, tierMiss: haikuOk ? null : 'over' } },
  })
  const rows = hybridRows([pair(0.9, true, false), pair(0.5, false, true)], 0.8)
  assert.deepEqual(rows.map((r) => [r.usedJev, r.ms, r.tierOk]), [[true, 250, true], [false, 1100, true]])
  const s = summarizeRouter(rows)
  assert.equal(s.tier.n, 2)
  assert.equal(s.p50, 250)
})
