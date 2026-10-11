import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  Budget,
  DEFAULT_CASES,
  buildInputs,
  confusions,
  fileLogReader,
  gatewayCost,
  loadSut,
  main,
  materializeMessage,
  parseArgs,
  percentile,
  runModelPass,
  safeError,
  scoreCase,
  selectCases,
  summarize,
  unstableCases,
  validateCases,
} from '../decke-triage-eval.mjs'

const triage = (pathway, extra = {}) => ({ pathway, also: null, signals: [], missing: [], wantsDeep: 'no', source: 'model', ...extra })
const decision = (pathways, tier) => ({ pathways, tier, effort: 'medium', reasons: [] })
const kase = (extra) => ({ id: 'c', family: 'f', message: 'm', expectedPathways: ['battle_log'], expectedTier: 'quick', ...extra })

test('--help never parses into a run, and a live run demands a cap', async () => {
  const lines = []
  const code = await main(['--budget-usd', '1', '--help'], {
    log: (l) => lines.push(l),
    loadSut: () => { throw new Error('help started a run') },
  })
  assert.equal(code, 0)
  assert.match(lines.join('\n'), /Usage:/)
  assert.throws(() => parseArgs([]), /--budget-usd/)
  assert.throws(() => parseArgs(['--budget-usd', '0']), /--budget-usd/)
  assert.throws(() => parseArgs(['--budget-usd', 'lots']), /--budget-usd/)
  assert.throws(() => parseArgs(['--mock', '--wat']), /unknown option/)
  assert.equal(parseArgs(['--mock']).budgetUsd, null)
  assert.deepEqual(parseArgs(['--mock', '--cases', 'a, b,,c']).cases, ['a', 'b', 'c'])
})

test('primary, acceptable and tier direction are scored from the routed decision', () => {
  const exact = scoreCase(kase({}), triage('battle_log'), decision(['battle_log'], 'quick'))
  assert.equal(exact.primary, true)
  assert.equal(exact.acceptable, true)
  assert.equal(exact.tierOk, true)

  const alternate = scoreCase(kase({ acceptable: ['battle_review'], acceptableTiers: ['standard'] }),
    triage('battle_review'), decision(['battle_review'], 'standard'))
  assert.equal(alternate.primary, false)
  assert.equal(alternate.acceptable, true)
  assert.equal(alternate.tierOk, true)

  const over = scoreCase(kase({}), triage('battle_review'), decision(['battle_review'], 'standard'))
  assert.equal(over.acceptable, false)
  assert.equal(over.tierMiss, 'over')
  const under = scoreCase(kase({ expectedTier: 'standard' }), triage('battle_log'), decision(['battle_log'], 'quick'))
  assert.equal(under.tierMiss, 'under')
})

test('the routed primary counts, so general beside a real pathway is not a miss', () => {
  // decideTier drops `general` when a second pathway is named.
  const s = scoreCase(kase({ expectedPathways: ['deck_build'], expectedTier: 'standard' }),
    triage('general', { also: 'deck_build' }), decision(['deck_build'], 'standard'))
  assert.equal(s.primary, true)
})

test('a mixed request is covered only when every expected pathway is routed', () => {
  const c = kase({ expectedPathways: ['price_value', 'navigate'] })
  assert.equal(scoreCase(c, triage('price_value'), decision(['price_value'], 'quick')).covered, false)
  const both = scoreCase(c, triage('navigate', { also: 'price_value' }), decision(['navigate', 'price_value'], 'quick'))
  assert.equal(both.covered, true)
  assert.equal(both.primary, false)
  assert.equal(both.acceptable, true, 'any expected pathway is an acceptable primary')
  assert.equal(scoreCase(kase({}), triage('battle_log'), decision(['battle_log'], 'quick')).covered, true)
})

test('expected and forbidden signals are checked separately', () => {
  const c = kase({ expectedSignals: ['correction'], forbiddenSignals: ['asks_for_depth'] })
  const s = scoreCase(c, triage('battle_log', { signals: ['asks_for_depth'] }), decision(['battle_log'], 'quick'))
  assert.deepEqual(s.missingSignals, ['correction'])
  assert.deepEqual(s.forbiddenSignals, ['asks_for_depth'])
  assert.equal(s.signalsOk, false)
  assert.equal(scoreCase(kase({}), triage('battle_log'), decision(['battle_log'], 'quick')).signalsLabelled, false)
})

test('summaries count rates, fallbacks, latency percentiles and cost', () => {
  const row = (ok, extra = {}) => ({
    case: kase({}),
    score: scoreCase(kase({}), triage(ok ? 'battle_log' : 'general'), decision([ok ? 'battle_log' : 'general'], 'quick')),
    result: { source: 'model', ms: 100, costUsd: 0.0001, pathways: [ok ? 'battle_log' : 'general'], tier: 'quick', ...extra },
  })
  const s = summarize([row(true), row(true), row(false, { source: 'heuristic', ms: 2500, costUsd: null }), row(true, { ms: 300 })])
  assert.equal(s.n, 4)
  assert.equal(s.primary.hits, 3)
  assert.equal(s.primary.rate, 0.75)
  assert.equal(s.fallback.hits, 1)
  assert.equal(s.latencyMs.p50, 100)
  assert.equal(s.latencyMs.p95, 2500)
  assert.ok(Math.abs(s.reportedCostUsd - 0.0003) < 1e-12)
  assert.equal(percentile([], 0.5), null)
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2)
  assert.equal(confusions([row(false), row(false), row(true)]).length, 1)
  assert.equal(confusions([row(false), row(false)])[0].times, 2)
})

test('unstable cases are the ones whose route changed between runs', () => {
  const r = (id, pathways, tier) => ({ case: { id }, result: { pathways, tier } })
  const runs = [[r('a', ['lists'], 'quick'), r('b', ['deck_build'], 'standard')], [r('a', ['lists'], 'quick'), r('b', ['research'], 'quick')]]
  assert.deepEqual(unstableCases(runs), [{ id: 'b', routes: ['deck_build/standard', 'research/quick'] }])
})

test('the budget refuses a call that could cross the cap and counts unknown costs at the estimate', () => {
  const b = new Budget(0.009, { alreadySpentUsd: 0.004, priorCallUsd: 0.003 })
  const first = b.tryReserve()
  assert.equal(first, 0.003)
  assert.equal(b.tryReserve(), null, 'prior 0.004 + reserved 0.003 + 0.003 crosses 0.009')
  b.settle(first, 0.0001)
  assert.equal(b.estimate(), 0.0002)
  const second = b.tryReserve()
  b.settle(second, null)
  assert.equal(b.unknownCost, 1)
  assert.ok(Math.abs(b.spentUsd - 0.0003) < 1e-12)
  assert.ok(Math.abs(b.reportedUsd - 0.0001) < 1e-12)
  assert.equal(gatewayCost({ gateway: { cost: '0.00011573' } }), 0.00011573)
  assert.equal(gatewayCost({}), null)
  assert.equal(gatewayCost({ gateway: { cost: 'free' } }), null)
})

test('error records never carry a key-shaped string', () => {
  const e = safeError(Object.assign(new Error('401 for key vck_abcdefghijklmnopqrstuvwxyz0123456789'), { statusCode: 401 }))
  assert.equal(e.status, 401)
  assert.doesNotMatch(e.message, /abcdefghijklmnop/)
})

test('cases select by id, family and held-out marker, and an unknown id fails loudly', () => {
  const cases = [{ id: 'a', family: 'x' }, { id: 'b', family: 'y', heldOut: true }, { id: 'c', family: 'x' }]
  assert.deepEqual(selectCases(cases, ['family:x']).map((c) => c.id), ['a', 'c'])
  assert.deepEqual(selectCases(cases, ['@heldout']).map((c) => c.id), ['b'])
  assert.deepEqual(selectCases(cases, ['@tuned', 'b']).map((c) => c.id), ['a', 'b', 'c'])
  assert.throws(() => selectCases(cases, ['zzz']), /nothing matches/)
  assert.equal(materializeMessage('a\n\n{{log:x}}\n\nb', () => 'L1\r\nL2\r\n'), 'a\n\nL1\nL2\n\nb')
})

test('the shipped set is valid, covers every pathway five times and its logs read as pastes', async () => {
  const sut = await loadSut()
  const { cases } = JSON.parse(fs.readFileSync(DEFAULT_CASES, 'utf8'))
  assert.deepEqual(validateCases(cases, { pathways: sut.PATHWAY_NAMES, signals: sut.TRIAGE_SIGNALS }), [])
  for (const name of sut.PATHWAY_NAMES) {
    const n = cases.filter((c) => c.expectedPathways[0] === name && c.heldOut !== true).length
    assert.ok(n >= 5, `${name} is the expected primary of only ${n} tuned cases`)
  }
  const readLog = fileLogReader(DEFAULT_CASES)
  for (const c of cases) {
    const inputs = buildInputs(sut, c, materializeMessage(c.message, readLog))
    assert.equal(inputs.pasted, c.message.includes('{{log:'), `${c.id}: extractPastedLog disagrees with the case`)
    assert.ok(inputs.previousReply.length <= 800)
    if (c.ask) assert.notEqual(inputs.answering, null, `${c.id}: the ask card was not seen`)
  }
  const invalid = validateCases([{ id: 'x', family: 'f', message: 'm', expectedPathways: ['nope'], expectedTier: 'deep', extra: 1 }],
    { pathways: sut.PATHWAY_NAMES, signals: sut.TRIAGE_SIGNALS })
  assert.equal(invalid.length, 3)
})

test('a 402 from the Gateway stops the pass instead of failing every later call', async () => {
  const sut = await loadSut()
  const { MockLanguageModelV3 } = await import('ai/test')
  let calls = 0
  const base = new MockLanguageModelV3({
    doGenerate: async () => {
      calls += 1
      throw Object.assign(new Error('A positive credit balance is required'), { statusCode: 402 })
    },
  })
  const { cases } = JSON.parse(fs.readFileSync(DEFAULT_CASES, 'utf8'))
  const readLog = fileLogReader(DEFAULT_CASES)
  const prepared = cases.slice(0, 5).map((c) => ({ case: c, inputs: buildInputs(sut, c, materializeMessage(c.message, readLog)) }))
  const pass = await runModelPass(sut, prepared, { base, mock: false, timeoutMs: 2_500, concurrency: 1, budget: new Budget(1) })
  assert.equal(calls, 1)
  assert.equal(pass.rows.length, 1)
  assert.match(pass.stopped, /refused with 402/)
  assert.equal(pass.rows[0].result.outcome, 'provider_error')
})

test('--mock runs the real pipeline and spends nothing', async () => {
  const lines = []
  const code = await main(['--mock', '--cases', 'nv-binder,li-yes-do-it'], { log: (l) => lines.push(l), error: () => {} })
  assert.equal(code, 0)
  const report = lines.join('\n')
  assert.match(report, /mode=mock/)
  assert.match(report, /Gateway-reported \$0\.00000 over 0 calls/)
})
