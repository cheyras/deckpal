import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { chdir, cwd, env } from 'node:process'
import test from 'node:test'
import {
  buildReport,
  formatTable,
  gatewayKey,
  midConversationResult,
  nudgeLoopEvidence,
  parseArgs,
} from '../decke-gateway-probe.mjs'

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

// ── mid_conversation_system_message ─────────────────────────────────────────

const step = (text, ...toolNames) => ({ text, toolCalls: toolNames.map((toolName) => ({ toolName })) })
const NUDGE = "The reader hasn't heard from you in a while — say in a sentence what you've found so far and what you're checking next, then continue."

test('nudged-loop evidence: text before the next lookup, after the nudge, is what counts', () => {
  const spoke = nudgeLoopEvidence([step('', 'lookup'), step('Alice is done; now Bob.', 'lookup'), step('Both found.')], 1)
  assert.deepEqual(spoke, {
    steps: [
      { index: 0, toolCalls: ['lookup'], visibleText: '', nudged: false },
      { index: 1, toolCalls: ['lookup'], visibleText: 'Alice is done; now Bob.', nudged: true },
      { index: 2, toolCalls: [], visibleText: 'Both found.', nudged: false },
    ],
    nudgedBeforeStep: 1,
    nudgeReachedModel: true,
    spokeAfterNudge: true,
    nextToolCallStep: 1,
    textBeforeNextToolCall: true,
  })

  const silent = nudgeLoopEvidence([step('', 'lookup'), step('', 'lookup'), step('Both found.')], 1)
  assert.equal(silent.spokeAfterNudge, false)
  assert.equal(silent.textBeforeNextToolCall, false)
  assert.equal(silent.nextToolCallStep, 1)

  // Answered straight after the nudge, with no further lookup: it spoke, but
  // there was no "next tool call" for the text to come before.
  const answered = nudgeLoopEvidence([step('', 'lookup'), step('Alice only.')], 1)
  assert.equal(answered.spokeAfterNudge, true)
  assert.equal(answered.nextToolCallStep, null)
  assert.equal(answered.textBeforeNextToolCall, false)

  // The model never called a tool, so the nudge was never sent.
  const never = nudgeLoopEvidence([step('Hi.')], null)
  assert.equal(never.nudgeReachedModel, false)
  assert.equal(never.nudgedBeforeStep, null)
})

test('the check passes only when the Gateway carried the nudge for BOTH models', () => {
  const ok = { succeeded: true, ...nudgeLoopEvidence([step('', 'lookup'), step('Now Bob.', 'lookup'), step('Done.')], 1) }
  const rejected = { succeeded: false, error: 'AI_APICallError: system messages are not supported here', nudgedBeforeStep: 1 }
  const unsent = { succeeded: true, ...nudgeLoopEvidence([step('Hi.')], null) }
  assert.equal(midConversationResult(NUDGE, ok, ok).pass, true)
  assert.equal(midConversationResult(NUDGE, ok, rejected).pass, false)
  assert.equal(midConversationResult(NUDGE, unsent, ok).pass, false)
  assert.deepEqual(Object.keys(midConversationResult(NUDGE, ok, ok).evidence), ['nudgeText', 'sonnet', 'haiku'])
  assert.equal(midConversationResult(NUDGE, ok, ok).evidence.nudgeText, NUDGE)
})

test('the report and table carry the nudged-loop result for each model, redacted', () => {
  const secret = 'gw_test_nudge_secret'
  const spoke = { model: 'anthropic/claude-sonnet-5.5', succeeded: true, ...nudgeLoopEvidence([step('', 'lookup'), step('Now Bob.', 'lookup'), step('Done.')], 1) }
  const silent = { model: 'anthropic/claude-haiku-5.5', succeeded: true, ...nudgeLoopEvidence([step('', 'lookup'), step('', 'lookup'), step('Done.')], 1) }
  const failed = { model: 'anthropic/claude-haiku-5.5', succeeded: false, error: `rejected for ${secret}`, nudgedBeforeStep: 1 }
  const checks = [
    { name: 'mid_conversation_system_message', ...midConversationResult(NUDGE, spoke, silent) },
    { name: 'mid_conversation_system_message', ...midConversationResult(NUDGE, spoke, failed) },
  ]
  const report = buildReport(checks, { key: secret, generatedAt: '2026-10-10T00:00:00.000Z' })
  assert.equal(JSON.stringify(report).includes(secret), false)
  assert.equal(report.checks[0].evidence.sonnet.textBeforeNextToolCall, true)
  assert.equal(report.checks[0].evidence.haiku.spokeAfterNudge, false)
  assert.match(report.checks[1].evidence.haiku.error, /\[REDACTED\]/)
  const table = formatTable(report.checks)
  assert.match(table, /mid_conversation_system_message\s+PASS\s+sonnet spoke, haiku silent/)
  assert.match(table, /mid_conversation_system_message\s+FAIL\s+sonnet spoke, haiku error/)
  assert.match(formatTable([{ name: 'mid_conversation_system_message', pass: false, evidence: {}, error: 'Error: Cannot find module progressNudge.js' }]), /FAIL\s+Error: Cannot find module/)
})
