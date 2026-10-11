import assert from 'node:assert/strict'
import test from 'node:test'
import { hybridRows, parseArgs, summarizeRouter, USAGE } from '../decke-jev-route-eval.mjs'


test('--help is the usage, and a bare run needs no flags to parse', () => {
  assert.match(USAGE, /--no-zdr/)
  assert.deepEqual(parseArgs([]), { cases: null, repeat: 1, budgetUsd: 0.5, out: null, noZdr: false })
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
