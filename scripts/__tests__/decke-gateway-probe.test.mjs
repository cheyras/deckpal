import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { chdir, cwd, env } from 'node:process'
import test from 'node:test'
import {
  MIN_NUDGE_TOKENS,
  buildReport,
  fallbackResult,
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

// A step as ai@7 reports it: text, tool calls with input, per-step usage.
const step = (text, lookups = [], usage = {}) => ({
  text,
  toolCalls: lookups.map((name) => ({ toolName: 'lookup', input: { name } })),
  usage,
})
const NUDGE = "The reader hasn't heard from you in a while. In one short line, tell them what you've found so far. Only if you're not done, add what you're checking next, then continue."

// Token shapes measured live on 2026-10-10 (Sonnet 5.5): the nudged step added
// 55 tokens beyond the previous step's input and output, the next step 15 —
// the tool result alone. A dropped nudge would add 15 on both.
const carriedLoop = (speech = 'So far Alice; now Bob.') => [
  step('', ['Alice'], { inputTokens: 450, outputTokens: 49 }),
  step(speech, ['Bob'], { inputTokens: 554, outputTokens: 79 }),
  step('Both found.', [], { inputTokens: 648, outputTokens: 31 }),
]
const droppedLoop = () => [
  step('', ['Alice'], { inputTokens: 450, outputTokens: 49 }),
  step('', ['Bob'], { inputTokens: 514, outputTokens: 40 }),
  step('Both found.', [], { inputTokens: 569, outputTokens: 31 }),
]

test('nudged-loop evidence: the follow-up lookup, the carried tokens, and any line before it', () => {
  const spoke = nudgeLoopEvidence(carriedLoop(), 1)
  assert.deepEqual(spoke.steps.map(({ index, toolCalls, lookups, visibleText, nudged }) => ({ index, toolCalls, lookups, visibleText, nudged })), [
    { index: 0, toolCalls: ['lookup'], lookups: ['Alice'], visibleText: '', nudged: false },
    { index: 1, toolCalls: ['lookup'], lookups: ['Bob'], visibleText: 'So far Alice; now Bob.', nudged: true },
    { index: 2, toolCalls: [], lookups: [], visibleText: 'Both found.', nudged: false },
  ])
  assert.equal(spoke.stepAfterNudgeRan, true)
  assert.equal(spoke.bobLookedUpAfterNudge, true)
  assert.equal(spoke.spokeAfterNudge, true)
  assert.equal(spoke.textBeforeNextToolCall, true)
  assert.equal(spoke.nextToolCallStep, 1)
  assert.equal(spoke.nudgedStepAddedTokens, 55)
  assert.equal(spoke.nextStepAddedTokens, 15)
  assert.equal(spoke.nudgeInputTokens, 40)

  const silent = nudgeLoopEvidence(carriedLoop(''), 1)
  assert.equal(silent.spokeAfterNudge, false)
  assert.equal(silent.textBeforeNextToolCall, false)
  assert.equal(silent.bobLookedUpAfterNudge, true)

  // Spoke straight after the nudge and never looked Bob up: the step ran, and
  // that is all — the reader got a progress line and no answer.
  const stopped = nudgeLoopEvidence([step('', ['Alice'], { inputTokens: 450, outputTokens: 49 }), step('Alice only so far; Bob next.', [], { inputTokens: 554, outputTokens: 20 })], 1)
  assert.equal(stopped.stepAfterNudgeRan, true)
  assert.equal(stopped.spokeAfterNudge, true)
  assert.equal(stopped.bobLookedUpAfterNudge, false)
  assert.equal(stopped.nextToolCallStep, null)
  assert.equal(stopped.nudgeInputTokens, null, 'no next step, nothing to compare the growth with')

  // The model never called a tool, so the nudge was never sent.
  const never = nudgeLoopEvidence([step('Hi.')], null)
  assert.equal(never.stepAfterNudgeRan, false)
  assert.equal(never.nudgedBeforeStep, null)
  assert.equal(never.nudgeInputTokens, null)

  // Usage missing on a step: no number is invented.
  assert.equal(nudgeLoopEvidence([step('', ['Alice']), step('', ['Bob']), step('Done.')], 1).nudgeInputTokens, null)
})

test('PASS needs the follow-up lookup AND the carried nudge on BOTH models', () => {
  const ok = { succeeded: true, ...nudgeLoopEvidence(carriedLoop(), 1) }
  const dropped = { succeeded: true, ...nudgeLoopEvidence(droppedLoop(), 1) }
  const stopped = { succeeded: true, ...nudgeLoopEvidence([step('', ['Alice'], { inputTokens: 450, outputTokens: 49 }), step('Alice so far.', [], { inputTokens: 554, outputTokens: 20 })], 1) }
  const rejected = { succeeded: false, error: 'AI_APICallError: system messages are not supported here', nudgedBeforeStep: 1 }
  const unsent = { succeeded: true, ...nudgeLoopEvidence([step('Hi.')], null) }
  assert.equal(dropped.nudgeInputTokens, 0)
  assert.ok(MIN_NUDGE_TOKENS > 0 && MIN_NUDGE_TOKENS < 40)
  assert.equal(midConversationResult(NUDGE, ok, ok).pass, true)
  assert.equal(midConversationResult(NUDGE, ok, dropped).pass, false, 'a request that succeeded but lost the message passed')
  assert.equal(midConversationResult(NUDGE, stopped, ok).pass, false, 'spoke-then-stopped passed')
  assert.equal(midConversationResult(NUDGE, ok, rejected).pass, false)
  assert.equal(midConversationResult(NUDGE, unsent, ok).pass, false)
  assert.deepEqual(Object.keys(midConversationResult(NUDGE, ok, ok).evidence), ['nudgeText', 'minNudgeTokens', 'sonnet', 'haiku'])
  assert.equal(midConversationResult(NUDGE, ok, ok).evidence.nudgeText, NUDGE)
})

test('the fallback check passes when the Gateway accepts the nudge and the loop goes on', () => {
  const accepted = { model: 'google/gemini-2.5-flash', succeeded: true, ...nudgeLoopEvidence(droppedLoop(), 1) }
  const rejected = { model: 'google/gemini-2.5-flash', succeeded: false, error: 'system message not supported', nudgedBeforeStep: 1 }
  const stopped = { model: 'google/gemini-2.5-flash', succeeded: true, ...nudgeLoopEvidence([step('', ['Alice']), step('Alice.')], 1) }
  assert.equal(fallbackResult(NUDGE, accepted).pass, true, 'Gemini token growth is evidence only')
  assert.equal(fallbackResult(NUDGE, rejected).pass, false)
  assert.equal(fallbackResult(NUDGE, stopped).pass, false)
  const table = formatTable([
    { name: 'mid_conversation_system_message_fallback', ...fallbackResult(NUDGE, accepted) },
    { name: 'mid_conversation_system_message_fallback', ...fallbackResult(NUDGE, rejected) },
  ])
  assert.match(table, /mid_conversation_system_message_fallback\s+PASS\s+gemini-2\.5-flash silent, \+0 tok/)
  assert.match(table, /mid_conversation_system_message_fallback\s+FAIL\s+gemini-2\.5-flash error/)
})

test('the report and table carry the nudged-loop result for each model, redacted', () => {
  const secret = 'gw_test_nudge_secret'
  const spoke = { model: 'anthropic/claude-sonnet-5.5', succeeded: true, ...nudgeLoopEvidence(carriedLoop(), 1) }
  const silent = { model: 'anthropic/claude-haiku-5.5', succeeded: true, ...nudgeLoopEvidence(carriedLoop(''), 1) }
  const failed = { model: 'anthropic/claude-haiku-5.5', succeeded: false, error: `rejected for ${secret}`, nudgedBeforeStep: 1 }
  const stopped = { model: 'anthropic/claude-haiku-5.5', succeeded: true, ...nudgeLoopEvidence([step('', ['Alice']), step('Alice so far.')], 1) }
  const dropped = { model: 'anthropic/claude-haiku-5.5', succeeded: true, ...nudgeLoopEvidence(droppedLoop(), 1) }
  const checks = [
    { name: 'mid_conversation_system_message', ...midConversationResult(NUDGE, spoke, silent) },
    { name: 'mid_conversation_system_message', ...midConversationResult(NUDGE, spoke, failed) },
    { name: 'mid_conversation_system_message', ...midConversationResult(NUDGE, spoke, stopped) },
    { name: 'mid_conversation_system_message', ...midConversationResult(NUDGE, spoke, dropped) },
  ]
  const report = buildReport(checks, { key: secret, generatedAt: '2026-10-10T00:00:00.000Z' })
  assert.equal(JSON.stringify(report).includes(secret), false)
  assert.equal(report.checks[0].evidence.sonnet.textBeforeNextToolCall, true)
  assert.equal(report.checks[0].evidence.haiku.spokeAfterNudge, false)
  assert.match(report.checks[1].evidence.haiku.error, /\[REDACTED\]/)
  const table = formatTable(report.checks)
  assert.match(table, /mid_conversation_system_message\s+PASS\s+sonnet spoke, \+40 tok, haiku silent, \+40 tok/)
  assert.match(table, /mid_conversation_system_message\s+FAIL\s+sonnet spoke, \+40 tok, haiku error/)
  // Never "benign": a line and then nothing is named as the stop it is.
  assert.match(table, /mid_conversation_system_message\s+FAIL\s+sonnet spoke, \+40 tok, haiku spoke then STOPPED before Bob/)
  assert.match(table, /mid_conversation_system_message\s+FAIL\s+sonnet spoke, \+40 tok, haiku silent, \+0 tok/)
  assert.match(formatTable([{ name: 'mid_conversation_system_message', pass: false, evidence: {}, error: 'Error: Cannot find module progressNudge.js' }]), /FAIL\s+Error: Cannot find module/)
})
