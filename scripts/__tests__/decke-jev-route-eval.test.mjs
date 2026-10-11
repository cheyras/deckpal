import assert from 'node:assert/strict'
import test from 'node:test'
import { hybridRows, parseArgs, summarizeRouter, USAGE } from '../decke-jev-route-eval.mjs'


test('--help is the usage, and a live run needs an explicit budget', () => {
  assert.match(USAGE, /--no-zdr/)
  assert.match(USAGE, /--budget-usd <x>\s+Required for a live run/)
  // Parsing alone never sets a budget: main() refuses a live run without one.
  assert.deepEqual(parseArgs([]), { cases: null, repeat: 1, budgetUsd: null, out: null, noZdr: false })
  assert.equal(parseArgs(['--budget-usd', '0.2']).budgetUsd, 0.2)
  assert.throws(() => parseArgs(['--budget-usd', '0']), /positive/)
  assert.equal(parseArgs(['--cases', 'a,b']).cases.length, 2)
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
