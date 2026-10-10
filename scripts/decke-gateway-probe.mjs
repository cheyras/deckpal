#!/usr/bin/env node
/**
 * Small, live observations of the Anthropic options Deck-E sends through the
 * Vercel AI Gateway. Individual failures belong in the report: only setup and
 * report-writing failures make the process fail.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGateway } from '@ai-sdk/gateway'
import { generateText, stepCountIs, tool } from 'ai'
import { z } from 'zod'

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

function evidenceSummary(check) {
  if (check.error) return String(check.error).replace(/\s+/g, ' ').slice(0, 120)
  const evidence = check.evidence ?? {}
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
