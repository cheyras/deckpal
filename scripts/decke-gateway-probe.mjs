#!/usr/bin/env node
/**
 * Small, live observations of the Anthropic options Deck-E sends through the
 * Vercel AI Gateway. Individual failures belong in the report: only setup and
 * report-writing failures make the process fail.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createGateway } from '@ai-sdk/gateway'
import { generateText, stepCountIs, tool } from 'ai'
import { z } from 'zod'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const UPDATE_BETA = 'thinking-display-updates-2026-08-18'
const CACHE = { anthropic: { cacheControl: { type: 'ephemeral' } } }
const HAIKU = 'anthropic/claude-haiku-5.5'
const SONNET = 'anthropic/claude-sonnet-5.5'
const REASONING_PROMPT = 'In one sentence: which is larger, 9.11 or 9.9? Think it through.'

export function parseArgs(argv = process.argv.slice(2)) {
  let out = resolve(process.cwd(), 'tmp/gateway-probe.json')
  let help = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      help = true
    } else if (arg === '--out') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('--out requires a path')
      out = resolve(argv[++i])
    } else if (arg.startsWith('--out=')) {
      const value = arg.slice('--out='.length)
      if (!value) throw new Error('--out requires a path')
      out = resolve(value)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return { out, help }
}

export function gatewayKey(env = process.env) {
  return env.DECKE_VERCEL_AI_GATEWAY_KEY || env.AI_GATEWAY_API_KEY || null
}

function errorText(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

function redact(value, secrets) {
  if (typeof value === 'string') {
    return secrets.reduce((text, secret) => secret ? text.split(secret).join('[REDACTED]') : text, value)
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item, secrets)]))
  }
  return value
}

/** Construct a serializable report while guaranteeing credentials are absent. */
export function buildReport(checks, { callRecords = [], key = null, generatedAt = new Date().toISOString() } = {}) {
  const secrets = [key, process.env.AI_GATEWAY_API_KEY, process.env.DECKE_VERCEL_AI_GATEWAY_KEY]
    .filter((secret) => typeof secret === 'string' && secret.length > 0)
  return redact({ generatedAt, checks, calls: callRecords }, secrets)
}

/**
 * One nudged loop in a few words. Every failure says which one: a loop that
 * spoke after the nudge and then never looked Bob up STOPPED — the reader got
 * a progress line and no answer, which is the defect, not a benign outcome.
 */
function nudgeRunSummary(name, run) {
  if (!run) return `${name} ?`
  if (!run.succeeded) return `${name} error`
  if (!run.stepAfterNudgeRan) return `${name} no step after nudge`
  if (!run.bobLookedUpAfterNudge) return `${name} ${run.spokeAfterNudge ? 'spoke then STOPPED' : 'STOPPED'} before Bob`
  const tokens = run.nudgeInputTokens == null ? 'tokens ?' : `${run.nudgeInputTokens >= 0 ? '+' : ''}${run.nudgeInputTokens} tok`
  return `${name} ${run.textBeforeNextToolCall ? 'spoke' : 'silent'}, ${tokens}`
}

function evidenceSummary(check) {
  if (check.error) return String(check.error).replace(/\s+/g, ' ').slice(0, 120)
  const evidence = check.evidence ?? {}
  if (check.name === 'mid_conversation_system_message') {
    return `${nudgeRunSummary('sonnet', evidence.sonnet)}, ${nudgeRunSummary('haiku', evidence.haiku)}`
  }
  if (check.name === 'mid_conversation_system_message_fallback') {
    return nudgeRunSummary(String(evidence.fallback?.model ?? 'fallback').replace(/^.*\//, ''), evidence.fallback)
  }
  if (check.name === 'gateway_cost') return `${evidence.withCost ?? 0}/${evidence.successfulCalls ?? 0} calls`
  if ('cacheReadTokens' in evidence) return `cache read ${evidence.cacheReadTokens ?? 0}`
  if ('toolReturned' in evidence) return evidence.toolReturned ? 'tool returned' : 'no tool call'
  if ('low' in evidence && 'high' in evidence) {
    return `reasoning ${evidence.low?.reasoningTokens ?? '?'} -> ${evidence.high?.reasoningTokens ?? '?'}`
  }
  if ('steps' in evidence) return `${evidence.steps.length} steps`
  return ''
}

export function formatTable(checks) {
  const rows = checks.map((check) => [check.name, check.pass ? 'PASS' : 'FAIL', evidenceSummary(check)])
  const headings = ['CHECK', 'RESULT', 'EVIDENCE']
  const widths = headings.map((heading, index) => Math.max(heading.length, ...rows.map((row) => row[index].length)))
  const line = (row) => row.map((cell, index) => cell.padEnd(widths[index])).join('  ').trimEnd()
  return [line(headings), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)].join('\n')
}

function decimalCost(value) {
  return typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) ? value : null
}

function usageEvidence(usage, providerMetadata) {
  const rawAnthropic = providerMetadata?.anthropic?.usage
  return {
    reasoningTokens: usage?.outputTokenDetails?.reasoningTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    cacheReadTokens: usage?.inputTokenDetails?.cacheReadTokens ?? null,
    cacheWriteTokens: usage?.inputTokenDetails?.cacheWriteTokens ?? null,
    rawAnthropicUsage: rawAnthropic && typeof rawAnthropic === 'object' ? rawAnthropic : null,
    gatewayCost: decimalCost(providerMetadata?.gateway?.cost),
  }
}

function makeCallRunner(gateway, abortSignal, callRecords) {
  return async function runCall(label, options) {
    let stepNumber = 0
    try {
      return await generateText({
        ...options,
        model: gateway(options.model),
        abortSignal,
        maxRetries: 0,
        onStepFinish(step) {
          const usage = usageEvidence(step.usage, step.providerMetadata)
          callRecords.push({ label, step: stepNumber++, success: true, ...usage })
          options.onStepFinish?.(step)
        },
      })
    } catch (error) {
      callRecords.push({ label, success: false, error: errorText(error) })
      throw error
    }
  }
}

function recordsFor(callRecords, prefix) {
  return callRecords.filter((record) => record.label === prefix || record.label.startsWith(`${prefix}:`))
}

async function checked(name, operation) {
  try {
    const result = await operation()
    return { name, pass: Boolean(result.pass), evidence: result.evidence ?? {} }
  } catch (error) {
    return { name, pass: false, evidence: {}, error: errorText(error) }
  }
}

async function effortCheck(runCall, callRecords) {
  const one = async (effort) => {
    const result = await runCall(`effort_passthrough_haiku:${effort}`, {
      model: HAIKU,
      prompt: REASONING_PROMPT,
      providerOptions: { anthropic: { effort, thinking: { type: 'adaptive' } } },
      maxOutputTokens: 256,
    })
    const step = result.steps.at(-1)
    return usageEvidence(result.totalUsage, step?.providerMetadata)
  }
  const [low, high] = await Promise.all([one('low'), one('high')])
  const comparable = typeof low.reasoningTokens === 'number' && typeof high.reasoningTokens === 'number'
  return {
    pass: comparable && high.reasoningTokens >= low.reasoningTokens,
    evidence: { low, high, calls: recordsFor(callRecords, 'effort_passthrough_haiku') },
  }
}

async function disabledThinkingCheck(runCall, callRecords) {
  const result = await runCall('thinking_disabled_haiku', {
    model: HAIKU,
    prompt: 'Use the pick tool to select the word ready.',
    tools: {
      pick: tool({
        description: 'Pick one value.',
        inputSchema: z.object({ value: z.string() }),
      }),
    },
    toolChoice: { type: 'tool', toolName: 'pick' },
    providerOptions: { anthropic: { thinking: { type: 'disabled' }, effort: 'low' } },
    maxOutputTokens: 128,
  })
  const found = result.toolCalls.find((call) => call.toolName === 'pick')
  return {
    pass: Boolean(found),
    evidence: {
      toolReturned: Boolean(found),
      input: found?.input ?? null,
      calls: recordsFor(callRecords, 'thinking_disabled_haiku'),
    },
  }
}

// About 6,000 simple word tokens, deterministic across runs and both models.
const CACHE_FILLER = `${Array.from({ length: 750 }, (_, i) =>
  `alpha beta gamma delta epsilon zeta eta theta block${String(i).padStart(4, '0')}.`).join(' ')}\n`

async function cacheCheck(model, name, runCall, callRecords) {
  const request = {
    model,
    instructions: {
      role: 'system',
      content: `Stable cache probe. Ignore the filler and answer the request.\n${CACHE_FILLER}`,
      providerOptions: CACHE,
    },
    messages: [{
      role: 'user',
      content: 'Reply with exactly OK.',
      providerOptions: CACHE,
    }],
    providerOptions: { anthropic: { effort: 'low', thinking: { type: 'adaptive' } } },
    maxOutputTokens: 64,
  }
  const first = await runCall(`${name}:first`, request)
  const second = await runCall(`${name}:second`, request)
  const firstUsage = usageEvidence(first.totalUsage, first.steps.at(-1)?.providerMetadata)
  const secondUsage = usageEvidence(second.totalUsage, second.steps.at(-1)?.providerMetadata)
  const standard = secondUsage.cacheReadTokens
  const raw = secondUsage.rawAnthropicUsage?.cache_read_input_tokens
  const cacheReadTokens = typeof standard === 'number' ? standard : (typeof raw === 'number' ? raw : 0)
  const foundAt = typeof standard === 'number'
    ? 'usage.inputTokenDetails.cacheReadTokens'
    : (typeof raw === 'number' ? 'providerMetadata.anthropic.usage.cache_read_input_tokens' : null)
  return {
    pass: cacheReadTokens > 0,
    evidence: {
      cacheReadTokens,
      foundAt,
      first: firstUsage,
      second: secondUsage,
      calls: recordsFor(callRecords, name),
    },
  }
}

function toolLoopEvidence(result) {
  const steps = result.steps.map((step, index) => ({
    index,
    toolCalls: step.toolCalls.map((call) => call.toolName),
    visibleText: step.text ?? '',
    reasoningText: step.reasoningText ?? '',
    nonEmptyReasoningParts: step.reasoning
      .map((part) => typeof part.text === 'string' ? part.text : '')
      .filter((text) => text.trim().length > 0),
  }))
  const toolStepIndexes = steps.filter((step) => step.toolCalls.length > 0).map((step) => step.index)
  const lastToolStep = toolStepIndexes.at(-1) ?? -1
  return {
    steps,
    visibleTextBeforeOrBetweenTools: steps
      .filter((step) => step.index <= lastToolStep && step.visibleText.trim())
      .map((step) => ({ index: step.index, text: step.visibleText })),
    reasoningTextBetweenToolCalls: steps
      .filter((step) => step.index <= lastToolStep && (step.reasoningText.trim() || step.nonEmptyReasoningParts.length))
      .map((step) => ({ index: step.index, text: step.reasoningText, parts: step.nonEmptyReasoningParts })),
    anyNonEmptyReasoningTextBetweenToolCalls: steps.some(
      (step) => step.index <= lastToolStep && (step.reasoningText.trim() || step.nonEmptyReasoningParts.length),
    ),
  }
}

async function toolLoopCheck({ name, model, anthropic, runCall, callRecords, beta = false }) {
  const result = await runCall(name, {
    model,
    prompt: 'Look up both Alice and Bob, one after the other, then give one short final sentence using both results.',
    tools: {
      lookup: tool({
        description: 'Look up one person. Call once for Alice and once for Bob.',
        inputSchema: z.object({ name: z.string() }),
        execute: async ({ name: person }) => `${person}: fixed probe result`,
      }),
    },
    stopWhen: stepCountIs(3),
    providerOptions: {
      anthropic: {
        ...anthropic,
        ...(beta ? { anthropicBeta: [UPDATE_BETA] } : {}),
      },
    },
    ...(beta ? { headers: { 'anthropic-beta': UPDATE_BETA } } : {}),
    maxOutputTokens: 384,
  })
  return {
    pass: true,
    evidence: { ...toolLoopEvidence(result), calls: recordsFor(callRecords, name) },
  }
}

/**
 * MID-CONVERSATION SYSTEM MESSAGE (2026-10-10).
 *
 * Production (api/chat.mjs, apps/api/src/decke/progressNudge.ts) appends a
 * system message after a tool result when Deck-E has gone three lookups
 * without a word. The SDK side is proven offline — ai@7 sends it with
 * `allowSystemInMessages` and refuses it without — but what the Gateway does
 * with a system message that sits AFTER the first user turn is only
 * answerable live. It could reject the request (every nudged step fails),
 * carry it to Claude, or accept it and silently drop it — and a request that
 * succeeds cannot tell the last two apart. So PASS needs three things, on
 * both models the nudge reaches most (Standard = Sonnet, Quick = Haiku), with
 * production's message shape (cache breakpoint on the tool result, nudge
 * after it):
 *
 * - THE LOOP WENT ON: the follow-up lookup (Bob) ran after the nudge. A loop
 *   that spoke and then stopped is a FAIL — that is the reader getting a
 *   progress line and no answer, the defect the nudge must never cause.
 * - THE MESSAGE WAS CARRIED: the nudged step's input grew by more than the
 *   tool result alone explains. `nudgeInputTokens` compares the input the
 *   nudged step added beyond the previous step's input and output with what
 *   the NEXT step added beyond its own previous step — the same tool-result
 *   growth, and no new nudge, since ai@7 carries the first one forward
 *   rather than adding another. A dropped message measures about zero; the
 *   nudge measured +40 to +51 on both models (2026-10-10).
 * - The request succeeded at all.
 *
 * Whether he spoke before his next lookup is evidence, not the verdict: one
 * sample cannot grade a behaviour, and the replay probe's
 * 'progress-between-batches' is where that is measured. The un-nudged
 * baseline for the same Alice/Bob loop is `haiku_text_between_tools`.
 *
 * AND THE FALLBACK. Once a call is nudged, every later step carries the
 * message, so a Gateway failover on any of them sends it to Standard's
 * fallback (Gemini) too. `mid_conversation_system_message_fallback` runs the
 * same nudged loop on `TIERS.standard.fallback` and passes when the Gateway
 * accepts it and the loop goes on to Bob — i.e. the failover would not choke.
 * Its token growth is reported but not graded: Gemini's input accounting
 * through the Gateway does not difference cleanly step to step.
 */
const NUDGE_LOOP_PROMPT = 'Look up Alice, then Bob — one lookup per step, waiting for each result before the next — then give one short final sentence using both results.'

/** Below this, the nudged step's extra input is noise, not a ~40-token message. */
export const MIN_NUDGE_TOKENS = 15

async function loadNudgeText() {
  // The production text, from the built module, so the live check cannot drift
  // from what chat.mjs sends. Needs `npx tsc -p .` in apps/api first.
  const { PROGRESS_NUDGE_TEXT } = await import(pathToFileURL(resolve(REPO, 'apps/api/dist/decke/progressNudge.js')).href)
  return PROGRESS_NUDGE_TEXT
}

async function loadStandardFallback() {
  const { TIERS } = await import(pathToFileURL(resolve(REPO, 'apps/api/dist/decke/models.js')).href)
  return TIERS.standard.fallback
}

const tokenCount = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null

/**
 * What one nudged loop showed, from its steps alone. `nudgedBeforeStep` is the
 * index of the step the nudge preceded.
 */
export function nudgeLoopEvidence(steps, nudgedBeforeStep) {
  const timeline = (steps ?? []).map((step, index) => ({
    index,
    toolCalls: (step.toolCalls ?? []).map((call) => call.toolName),
    lookups: (step.toolCalls ?? []).filter((call) => call.toolName === 'lookup').map((call) => String(call.input?.name ?? '')),
    visibleText: step.text ?? '',
    inputTokens: tokenCount(step.usage?.inputTokens),
    outputTokens: tokenCount(step.usage?.outputTokens),
    nudged: index === nudgedBeforeStep,
  }))
  const after = nudgedBeforeStep == null ? [] : timeline.slice(nudgedBeforeStep)
  const next = after.findIndex((step) => step.toolCalls.length > 0)
  // Input a step added beyond everything the previous step was sent and said.
  const added = (index) => {
    const step = timeline[index]
    const previous = timeline[index - 1]
    if (!step || !previous || step.inputTokens == null || previous.inputTokens == null || previous.outputTokens == null) return null
    return step.inputTokens - previous.inputTokens - previous.outputTokens
  }
  const nudgedAdded = nudgedBeforeStep == null ? null : added(nudgedBeforeStep)
  const nextAdded = nudgedBeforeStep == null ? null : added(nudgedBeforeStep + 1)
  return {
    steps: timeline,
    nudgedBeforeStep: nudgedBeforeStep ?? null,
    stepAfterNudgeRan: after.length > 0,
    spokeAfterNudge: Boolean(after[0]?.visibleText.trim()),
    nextToolCallStep: next < 0 ? null : after[next].index,
    textBeforeNextToolCall: next >= 0 && after.slice(0, next + 1).some((step) => step.visibleText.trim().length > 0),
    bobLookedUpAfterNudge: after.some((step) => step.lookups.some((name) => /\bbob\b/i.test(name))),
    nudgedStepAddedTokens: nudgedAdded,
    nextStepAddedTokens: nextAdded,
    nudgeInputTokens: nudgedAdded == null || nextAdded == null ? null : nudgedAdded - nextAdded,
  }
}

/** The loop went on past the nudge to the follow-up lookup. */
const wentOn = (run) => run?.succeeded === true && run.stepAfterNudgeRan === true && run.bobLookedUpAfterNudge === true

/** The verdict over both models; the shape the report and table read. */
export function midConversationResult(nudgeText, sonnet, haiku) {
  const carried = (run) => typeof run?.nudgeInputTokens === 'number' && run.nudgeInputTokens >= MIN_NUDGE_TOKENS
  return {
    pass: [sonnet, haiku].every((run) => wentOn(run) && carried(run)),
    evidence: { nudgeText, minNudgeTokens: MIN_NUDGE_TOKENS, sonnet, haiku },
  }
}

/** Standard's fallback: accepted, and the loop went on. Tokens are evidence only. */
export function fallbackResult(nudgeText, fallback) {
  return { pass: wentOn(fallback), evidence: { nudgeText, fallback } }
}

async function nudgedLoop({ model, label, nudgeText, runCall, callRecords, anthropic = true }) {
  let nudgedBeforeStep = null
  try {
    const result = await runCall(label, {
      model,
      prompt: NUDGE_LOOP_PROMPT,
      tools: {
        lookup: tool({
          description: 'Look up one person. Call once for Alice and once for Bob.',
          inputSchema: z.object({ name: z.string() }),
          execute: async ({ name: person }) => `${person}: fixed probe result`,
        }),
      },
      allowSystemInMessages: true,
      prepareStep: ({ steps, messages }) => {
        if (nudgedBeforeStep != null || !steps.at(-1)?.toolCalls?.length) return undefined
        nudgedBeforeStep = steps.length
        const marked = messages.map((message, index) => index === messages.length - 1
          ? { ...message, providerOptions: CACHE }
          : message)
        return { messages: [...marked, { role: 'system', content: nudgeText }] }
      },
      stopWhen: stepCountIs(3),
      ...(anthropic ? { providerOptions: { anthropic: { effort: 'medium', thinking: { type: 'adaptive' } } } } : {}),
      maxOutputTokens: 512,
    })
    return { model, succeeded: true, ...nudgeLoopEvidence(result.steps, nudgedBeforeStep), calls: recordsFor(callRecords, label) }
  } catch (error) {
    return { model, succeeded: false, error: errorText(error), nudgedBeforeStep, calls: recordsFor(callRecords, label) }
  }
}

async function midConversationSystemCheck(runCall, callRecords) {
  const nudgeText = await loadNudgeText()
  const [sonnet, haiku] = await Promise.all([
    nudgedLoop({ model: SONNET, label: 'mid_conversation_system_message:sonnet', nudgeText, runCall, callRecords }),
    nudgedLoop({ model: HAIKU, label: 'mid_conversation_system_message:haiku', nudgeText, runCall, callRecords }),
  ])
  return midConversationResult(nudgeText, sonnet, haiku)
}

async function fallbackSystemCheck(runCall, callRecords) {
  const [nudgeText, model] = await Promise.all([loadNudgeText(), loadStandardFallback()])
  const fallback = await nudgedLoop({
    model, label: 'mid_conversation_system_message_fallback', nudgeText, runCall, callRecords, anthropic: false,
  })
  return fallbackResult(nudgeText, fallback)
}

function gatewayCostCheck(callRecords) {
  const successful = callRecords.filter((record) => record.success)
  const missing = successful.filter((record) => !decimalCost(record.gatewayCost))
  return {
    name: 'gateway_cost',
    pass: successful.length > 0 && missing.length === 0,
    evidence: {
      successfulCalls: successful.length,
      withCost: successful.length - missing.length,
      missing: missing.map(({ label, step }) => ({ label, step })),
      calls: callRecords.map(({ label, step, success, gatewayCost, error }) => ({
        label, step: step ?? null, success, cost: gatewayCost ?? null, ...(error ? { error } : {}),
      })),
    },
  }
}

export async function runProbe({ key }) {
  const gateway = createGateway({ apiKey: key })
  const callRecords = []
  // Leave headroom for cold Node/module startup and writing the report: the
  // complete command, not just its fetches, must remain below 45 seconds.
  const abortSignal = AbortSignal.timeout(35_000)
  const runCall = makeCallRunner(gateway, abortSignal, callRecords)
  const checks = await Promise.all([
    checked('effort_passthrough_haiku', () => effortCheck(runCall, callRecords)),
    checked('thinking_disabled_haiku', () => disabledThinkingCheck(runCall, callRecords)),
    checked('message_cache_haiku', () => cacheCheck(HAIKU, 'message_cache_haiku', runCall, callRecords)),
    checked('message_cache_sonnet', () => cacheCheck(SONNET, 'message_cache_sonnet', runCall, callRecords)),
    checked('updates_display_sonnet', () => toolLoopCheck({
      name: 'updates_display_sonnet', model: SONNET, beta: true, runCall, callRecords,
      anthropic: { effort: 'medium', thinking: { type: 'adaptive', display: 'updates' } },
    })),
    checked('haiku_text_between_tools', () => toolLoopCheck({
      name: 'haiku_text_between_tools', model: HAIKU, runCall, callRecords,
      anthropic: { effort: 'medium', thinking: { type: 'adaptive' } },
    })),
    checked('mid_conversation_system_message', () => midConversationSystemCheck(runCall, callRecords)),
    checked('mid_conversation_system_message_fallback', () => fallbackSystemCheck(runCall, callRecords)),
  ])
  checks.push(gatewayCostCheck(callRecords))
  return { checks, callRecords }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv)
  if (args.help) {
    process.stdout.write('Usage: node scripts/decke-gateway-probe.mjs [--out PATH]\n')
    return null
  }
  const key = gatewayKey(env)
  if (!key) throw new Error('Set DECKE_VERCEL_AI_GATEWAY_KEY or AI_GATEWAY_API_KEY')
  const { checks, callRecords } = await runProbe({ key })
  const report = buildReport(checks, { callRecords, key })
  mkdirSync(dirname(args.out), { recursive: true })
  writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  process.stdout.write(`${formatTable(report.checks)}\nReport: ${redact(args.out, [key])}\n`)
  return report
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((error) => {
    const safe = redact(errorText(error), [gatewayKey()].filter(Boolean))
    process.stderr.write(`Gateway probe could not run: ${safe}\n`)
    process.exitCode = 1
  })
}
