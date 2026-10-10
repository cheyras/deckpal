import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { chdir, cwd, env } from 'node:process'
import test from 'node:test'
import { buildReport, formatTable, gatewayKey, parseArgs } from '../decke-gateway-probe.mjs'

test('parseArgs resolves output paths and rejects malformed arguments', () => {
  const original = cwd()
  try {
    chdir('/tmp')
    // resolve() so the expectation holds on Windows (E:\tmp\…) as well as Linux CI.
    assert.deepEqual(parseArgs([]), { out: resolve('/tmp/tmp/gateway-probe.json'), help: false })
    assert.deepEqual(parseArgs(['--out', 'observations.json']), { out: resolve('/tmp/observations.json'), help: false })
    assert.deepEqual(parseArgs(['--out=/tmp/report.json']), { out: resolve('/tmp/report.json'), help: false })
    assert.deepEqual(parseArgs(['--help']), { out: resolve('/tmp/tmp/gateway-probe.json'), help: true })
    assert.throws(() => parseArgs(['--out']), /requires a path/)
    assert.throws(() => parseArgs(['--wat']), /Unknown argument/)
  } finally {
    chdir(original)
  }
})

test('gatewayKey prefers Deck-E dedicated credentials and supports the generic fallback', () => {
  assert.equal(gatewayKey({ DECKE_VERCEL_AI_GATEWAY_KEY: 'dedicated', AI_GATEWAY_API_KEY: 'generic' }), 'dedicated')
  assert.equal(gatewayKey({ AI_GATEWAY_API_KEY: 'generic' }), 'generic')
  assert.equal(gatewayKey({}), null)
})

test('buildReport keeps fake results and redacts the key everywhere', () => {
  const secret = 'gw_test_super_secret'
  const oldGeneric = env.AI_GATEWAY_API_KEY
  env.AI_GATEWAY_API_KEY = secret
  try {
    const report = buildReport([
      { name: 'works', pass: true, evidence: { note: `response for ${secret}` } },
      { name: 'fails', pass: false, evidence: {}, error: `request used ${secret}` },
    ], {
      key: secret,
      generatedAt: '2026-10-10T00:00:00.000Z',
      callRecords: [{ label: 'works', success: false, error: secret }],
    })
    const output = `${JSON.stringify(report)}\n${formatTable(report.checks)}`
    assert.equal(output.includes(secret), false)
    assert.match(output, /\[REDACTED\]/)
    assert.equal(report.checks[0].pass, true)
  } finally {
    if (oldGeneric === undefined) delete env.AI_GATEWAY_API_KEY
    else env.AI_GATEWAY_API_KEY = oldGeneric
  }
})

test('formatTable produces a compact, aligned summary for fake checks', () => {
  const table = formatTable([
    { name: 'effort_passthrough_haiku', pass: true, evidence: { low: { reasoningTokens: 2 }, high: { reasoningTokens: 7 } } },
    { name: 'message_cache_haiku', pass: false, evidence: { cacheReadTokens: 0 } },
    { name: 'gateway_cost', pass: true, evidence: { successfulCalls: 4, withCost: 4 } },
  ])
  assert.match(table, /^CHECK\s+RESULT\s+EVIDENCE/m)
  assert.match(table, /effort_passthrough_haiku\s+PASS\s+reasoning 2 -> 7/)
  assert.match(table, /message_cache_haiku\s+FAIL\s+cache read 0/)
  assert.match(table, /gateway_cost\s+PASS\s+4\/4 calls/)
})
