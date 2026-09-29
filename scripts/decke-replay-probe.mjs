#!/usr/bin/env node
/**
 * Replay the owner's real Deck-E conversations against the production prompt
 * and tool surface. Data execution is fixture-backed so only model behaviour
 * and Gateway usage vary between arms.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { createGateway } from '@ai-sdk/gateway'
import { stepCountIs, streamText, tool } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { z } from 'zod'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const FIXTURES = resolve(HERE, 'fixtures/decke-replay')
const TOOL_RECORD_PREFIX = '[lookups on that turn, for your own reference —'
const TOOL_OUTPUT_MAX = 12_000
const TOOL_OUTPUT_TRIM = '\n[… trimmed for length …]'
const WRITE_NAMES = new Set([
  'log_cards', 'save_deck', 'delete_deck', 'deck_strategy', 'create_list', 'update_list',
  'delete_list', 'edit_list', 'add_battle_log', 'edit_battle_log', 'delete_battle_log',
  'deck_history', 'revert',
])
const DATA_TOOLS = new Set()
const STOPWORDS = new Set('a an and are as at be by current do doing for from how i in is it its look meta my of on or pokemon tcg the this to up was what with you your'.split(' '))

function argvValue(argv, name, fallback) {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}

export function parseArgs(argv = process.argv.slice(2)) {
  const mock = argv.includes('--mock')
  const replay = argvValue(argv, 'replay', 'full')
  if (!['full', 'compact'].includes(replay)) throw new Error('--replay must be full or compact')
  const budgetUsd = Number(argvValue(argv, 'budget-usd', mock ? '0' : '5'))
  const n = Number(argvValue(argv, 'n', '1'))
  if (!Number.isFinite(budgetUsd) || budgetUsd < 0) throw new Error('--budget-usd must be a non-negative number')
  if (!Number.isInteger(n) || n < 1) throw new Error('--n must be a positive integer')
  return {
    mock,
    replay,
    budgetUsd,
    n,
    models: argvValue(argv, 'models', mock ? 'mock' : 'anthropic/claude-sonnet-5.5').split(',').filter(Boolean),
    scenarios: argvValue(argv, 'scenarios', '').split(',').filter(Boolean),
    out: resolve(argvValue(argv, 'out', resolve(REPO, 'tmp/decke-replay-probe'))),
  }
}

const norm = (value) => JSON.stringify(value ?? {}, Object.keys(value ?? {}).sort())
const clampOutput = (value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return text.length <= TOOL_OUTPUT_MAX ? text : `${text.slice(0, TOOL_OUTPUT_MAX - TOOL_OUTPUT_TRIM.length)}${TOOL_OUTPUT_TRIM}`
}
const tokens = (value) => new Set(String(value ?? '').toLowerCase().match(/[a-z0-9]+/g)?.filter((x) => x.length > 2 && !STOPWORDS.has(x)) ?? [])

/** A repeat needs a substantive shared topic, not merely the word “research”. */
export function researchTopicsOverlap(a, b) {
  const aa = tokens(`${a?.query ?? ''} ${a?.purpose ?? ''}`)
  const bb = tokens(`${b?.query ?? ''} ${b?.purpose ?? ''}`)
  for (const word of aa) if (bb.has(word)) return true
  return false
}

export function hasTextDeckList(text) {
  return String(text ?? '').split(/\r?\n/).filter((line) => /^\s*\d+\s*[x×]?\s+\S/i.test(line)).length >= 12
}

export function hasFalseRefusal(text, declined = false) {
  return !declined && /\b(?:blocked|refused|declined|can't research|cannot research)\b/i.test(String(text ?? ''))
}

export function deckTotal(call) {
  return Array.isArray(call?.input?.cards)
    ? call.input.cards.reduce((sum, card) => sum + (Number(card?.quantity) || 0), 0)
    : null
}

function isDataRead(call) {
  return DATA_TOOLS.has(call.name) && !WRITE_NAMES.has(call.name) && call.name !== 'check_deck'
}

export const METRIC_COLUMNS = [
  'tool_calls', 'feedback_tool_calls', 'web_research_calls', 'repeat_research_calls',
  'repeated_reads', 'expects_deck_turns', 'check_before_show', 'full_lists_proposed',
  'show_deck_for_full_list', 'show_deck_60', 'text_decklists', 'asks_for_tool_data',
  'false_refusals', 'expects_write_turns', 'write_calls', 'ttft_ms', 'total_ms',
  'output_tokens', 'cost_usd', 'cache_read_tokens', 'cache_write_tokens',
]

export function scoreTranscript(turns) {
  const m = Object.fromEntries(METRIC_COLUMNS.map((key) => [key, 0]))
  const priorResearch = []
  const priorReads = new Set()
  for (const turn of turns) {
    const calls = turn.calls ?? []
    m.tool_calls += calls.length
    if (turn.tags?.includes('feedback')) m.feedback_tool_calls += calls.length
    const research = calls.filter((call) => call.name === 'web_research')
    m.web_research_calls += research.length
    for (const call of research) {
      if (priorResearch.some((old) => researchTopicsOverlap(old.input, call.input))) m.repeat_research_calls++
      if (call.output != null && String(call.output).trim()) priorResearch.push(call)
    }
    const readsThisTurn = []
    for (const call of calls.filter(isDataRead)) {
      const key = `${call.name}:${norm(call.input)}`
      if (priorReads.has(key)) m.repeated_reads++
      readsThisTurn.push(key)
    }
    for (const key of readsThisTurn) priorReads.add(key)
    const showIndexes = calls.flatMap((call, i) => call.name === 'showDeck' ? [i] : [])
    const checkIndexes = calls.flatMap((call, i) => call.name === 'check_deck' ? [i] : [])
    const hasTypedList = hasTextDeckList(turn.text)
    const hasFullList = hasTypedList || showIndexes.length > 0 || calls.some((call) => call.name === 'check_deck' && deckTotal(call) === 60)
    if (turn.tags?.includes('expects-deck')) {
      m.expects_deck_turns++
      if (showIndexes.some((show) => checkIndexes.some((check) => check < show))) m.check_before_show++
    }
    if (hasFullList) {
      m.full_lists_proposed++
      if (showIndexes.length) m.show_deck_for_full_list++
    }
    m.show_deck_60 += calls.filter((call) => call.name === 'showDeck' && deckTotal(call) === 60).length
    if (hasTypedList) m.text_decklists++
    if (/\bhow many\b[^?.!]*(?:do you have|do you own)|\bwhich cards do you have\b/i.test(turn.text ?? '')) m.asks_for_tool_data++
    if (hasFalseRefusal(turn.text, Boolean(turn.declined))) m.false_refusals++
    if (turn.tags?.includes('expects-write')) {
      m.expects_write_turns++
      m.write_calls += calls.filter((call) => WRITE_NAMES.has(call.name)).length
    }
    m.ttft_ms += Number(turn.ttft_ms) || 0
    m.total_ms += Number(turn.total_ms) || 0
    m.output_tokens += Number(turn.output_tokens) || 0
    m.cost_usd += Number(turn.cost_usd) || 0
    m.cache_read_tokens += Number(turn.cache_read_tokens) || 0
    m.cache_write_tokens += Number(turn.cache_write_tokens) || 0
  }
  for (const key of ['ttft_ms', 'total_ms']) m[key] = turns.length ? Math.round(m[key] / turns.length) : 0
  m.cost_usd = Number(m.cost_usd.toFixed(8))
  return m
}

function fixtureDeckCheck(world, input) {
  const byId = new Map(world.collection.cards.map((card) => [card.id.toLowerCase(), card]))
  const byName = new Map(world.collection.cards.map((card) => [card.name.toLowerCase(), card]))
  let raw = input.cards ?? []
  if (!raw.length && input.ptcgl_text) {
    raw = input.ptcgl_text.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^\s*(\d+)\s+(.+?)(?:\s+[A-Z0-9-]+\s+\d+)?\s*$/i)
      return match ? [{ quantity: Number(match[1]), name: match[2] }] : []
    })
  }
  const lines = raw.map((row) => {
    const card = row.card_id ? byId.get(String(row.card_id).toLowerCase()) : byName.get(String(row.name ?? '').toLowerCase())
    return {
      card_id: card?.id ?? null,
      name: card?.name ?? row.name ?? row.card_id ?? 'Unknown card',
      supertype: card?.supertype ?? 'Unknown', quantity: Number(row.quantity) || 0,
      owned: card?.owned ?? 0, unit_price_usd: card?.price ?? null, resolved: Boolean(card),
      ...(card && row.name ? { note: `resolved '${row.name}' to ${card.id}` } : {}),
    }
  })
  const total = lines.reduce((sum, line) => sum + line.quantity, 0)
  const issues = []
  if (total !== 60) issues.push(`A deck must contain 60 cards; this list contains ${total}.`)
  for (const line of lines) if (line.quantity > 4 && line.supertype !== 'Energy') issues.push(`${line.name} has ${line.quantity} copies; the usual limit is 4.`)
  for (const line of lines) if (!line.resolved) issues.push(`${line.name} could not be resolved to a card id.`)
  const have = new Set(lines.filter((line) => line.quantity > 0).map((line) => line.name.toLowerCase()))
  const candy = have.has('rare candy')
  const chains = [
    ['Dreepy', 'Drakloak', 'Dragapult ex'], ['Litwick', 'Lampent', 'Chandelure'],
    ['Fennekin', 'Braixen', 'Delphox'], ['Duskull', 'Dusclops', 'Dusknoir'], ['Slowpoke', null, 'Slowking'],
  ]
  const evolution_gaps = []
  for (const [basic, stage1, stage2] of chains) {
    if (!have.has(stage2.toLowerCase())) continue
    if (!have.has(basic.toLowerCase())) evolution_gaps.push(`${stage2} has no ${basic}.`)
    if (stage1 && !have.has(stage1.toLowerCase()) && !candy) evolution_gaps.push(`${stage2} has no ${stage1} and no Rare Candy.`)
  }
  if (evolution_gaps.length) issues.push(...evolution_gaps)
  const owned = lines.reduce((sum, line) => sum + Math.min(line.owned, line.quantity), 0)
  const missing = lines.reduce((sum, line) => line.unit_price_usd == null ? sum : sum + Math.max(0, line.quantity - line.owned) * line.unit_price_usd, 0)
  const ptcgl = lines.filter((line) => line.resolved).map((line) => `${line.quantity} ${line.name} ${line.card_id}`).join('\n')
  return { format: input.format ?? 'standard', total, legal: issues.length ? false : true, issues, evolution_gaps, lines, owned, missing_cost_usd: Number(missing.toFixed(2)), ptcgl }
}

function renderDeckCheck(result) {
  const status = result.legal ? 'LEGAL' : `NOT LEGAL — ${result.issues.length} issue${result.issues.length === 1 ? '' : 's'}`
  const groups = ['Pokémon', 'Trainer', 'Energy', 'Unknown'].flatMap((kind) => {
    const rows = result.lines.filter((line) => line.supertype === kind)
    return rows.length ? [`\n${kind}`, ...rows.map((line) => `${line.quantity} ${line.name} (${line.card_id ?? 'unresolved'}) — own ${line.owned}`)] : []
  })
  return [`Checked ${result.total} cards (${result.format}): ${status}`, ...groups,
    ...(result.issues.length ? ['\nIssues', ...result.issues.map((x) => `- ${x}`)] : []),
    ...(result.evolution_gaps.length ? ['\nEvolution gaps', ...result.evolution_gaps.map((x) => `- ${x}`)] : []),
    `\nOwn ${result.owned}/${result.total}; missing cost $${result.missing_cost_usd?.toFixed(2) ?? 'unknown'}.`,
  ].join('\n')
}

function cardRows(world, ownedOnly = false) {
  const cards = ownedOnly ? world.collection.cards.filter((card) => card.owned > 0) : world.collection.cards
  return cards.map((card) => `${card.id} — ${card.name} · owned ${card.owned} · $${card.price.toFixed(2)}`).join('\n')
}

function fixtureOutput(name, input, world, writes) {
  if (WRITE_NAMES.has(name)) {
    writes.push({ name, input })
    return `${name} was approved by the fixture reader and recorded in the fixture. No live data was changed.`
  }
  if (name === 'collection_summary') return `Collection: ${world.owner.distinct_cards} distinct cards, ${world.owner.total_cards} total copies.\nPokémon 416 · Trainer 301 · Energy 135.`
  if (name === 'search_cards') return cardRows(world, Boolean(input.owned_only))
  if (name === 'get_card') {
    const q = String(input.card_id ?? input.name ?? '').toLowerCase()
    const found = world.collection.cards.find((card) => card.id.toLowerCase() === q || card.name.toLowerCase().includes(q))
    return found ? `${found.id} — ${found.name}\nOwned: ${found.owned}\nMarket: $${found.price.toFixed(2)}` : 'No matching card in the fixture.'
  }
  if (name === 'decks') {
    const q = String(input.deck ?? input.deck_id ?? '').toLowerCase()
    if (!q) return world.decks.map((deck) => `${deck.id} — ${deck.name} · ${deck.cards.length ? deck.cards.reduce((a, c) => a + c.quantity, 0) : 60} cards · ${deck.format}`).join('\n')
    const deck = world.decks.find((x) => x.id.toLowerCase() === q || x.name.toLowerCase().includes(q)) ?? world.decks[0]
    return `${deck.name} (${deck.id}) · ${deck.format}\nRecord: ${deck.record ? `${deck.record.wins}W-${deck.record.losses}L` : 'not recorded'}\n${deck.cards.map((c) => `${c.quantity} ${c.card_id}`).join('\n')}`
  }
  if (name === 'battle_logs') return world.battle_logs.map((log, i) => `${i + 1}. ${log.result} vs ${log.opponent} — ${log.note}`).join('\n')
  if (name === 'deck_performance' || name === 'deck_stats') return 'Toolbox Slowking v3: 19 wins, 13 losses (59.4%). Recent 10: 6-4. Losses skew toward fast basic attackers.'
  if (name === 'check_deck') return renderDeckCheck(fixtureDeckCheck(world, input))
  if (name === 'set_progress') return 'Pitch Black (me05): 45/181 owned (24.9%). Litwick 9, Lampent 9, Chandelure 4.'
  if (name === 'collection_log' || name === 'mutation_history') return 'Recent collection changes: +3 Litwick, +2 Lampent, +1 Dragapult ex.'
  if (name === 'lists') return 'Favorites (12 cards)\nTrade targets (8 cards)'
  if (name === 'health') return 'DeckPal fixture is healthy.'
  return `Fixture ${name} result: no matching rows. The tool ran successfully with ${JSON.stringify(input)}.`
}

function mockModel() {
  return new MockLanguageModelV3({
    modelId: 'decke-replay-mock',
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] })
          controller.enqueue({ type: 'text-start', id: 'mock-text' })
          controller.enqueue({ type: 'text-delta', id: 'mock-text', delta: 'Got it — mock replay response.' })
          controller.enqueue({ type: 'text-end', id: 'mock-text' })
          controller.enqueue({
            type: 'finish', finishReason: 'stop',
            usage: { inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 7, text: 7, reasoning: 0 } },
            providerMetadata: { gateway: { cost: 0 } },
          })
          controller.close()
        },
      }),
    }),
  })
}

function readUsage(usage, metadata) {
  const input = usage?.inputTokens ?? usage?.promptTokens ?? {}
  const output = usage?.outputTokens ?? usage?.completionTokens ?? {}
  // The Gateway reports cost as a decimal STRING ("0.0123"), exactly as
  // apps/api/src/decke/usageMetadata.ts reads it; a numbers-only parse read every
  // cost as 0 and left --budget-usd unenforced.
  const number = (value) => {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
    return typeof n === 'number' && Number.isFinite(n) ? n : 0
  }
  const gateway = metadata?.gateway ?? {}
  return {
    output_tokens: number(output.total ?? output),
    cache_read_tokens: number(input.cacheRead ?? usage?.inputTokenDetails?.cacheReadTokens ?? usage?.cachedInputTokens ?? gateway.cacheReadTokens),
    cache_write_tokens: number(input.cacheWrite ?? usage?.inputTokenDetails?.cacheWriteTokens ?? usage?.cacheCreationInputTokens ?? gateway.cacheWriteTokens),
    cost_usd: number(gateway.cost ?? gateway.totalCost ?? gateway.total_cost_usd),
  }
}

function summaryFor(call) {
  const value = typeof call.output === 'string' ? call.output : JSON.stringify(call.output ?? '')
  // This deliberately reproduces the old failure: deep results were sliced
  // from byte zero, so research replayed the untrusted-data frame, not findings.
  return value.replace(/\r/g, '').replace(/\n+/g, ' ').slice(0, 110)
}

function compactHistory(turns) {
  const messages = []
  for (const turn of turns) {
    messages.push({ role: 'user', content: [{ type: 'text', text: turn.user }] })
    const parts = []
    if (turn.text) parts.push({ type: 'text', text: turn.text })
    const calls = turn.calls.filter((call) => call.name !== 'express')
    if (calls.length) parts.push({
      type: 'text',
      text: `${TOOL_RECORD_PREFIX} you actually ran these, so the figures in them are real and yours are not a guess]\n${calls.map((call) => `${call.name}: ${summaryFor(call)}`).join('\n')}`,
    })
    if (parts.length) messages.push({ role: 'assistant', content: parts })
  }
  return messages
}

function replayableModelMessages(messages) {
  const expressIds = new Set(messages.flatMap((message) => Array.isArray(message.content) ? message.content : [])
    .filter((part) => part.type === 'tool-call' && part.toolName === 'express')
    .map((part) => part.toolCallId))
  return messages.flatMap((message) => {
    if (!Array.isArray(message.content)) return [message]
    const content = message.content.flatMap((part) => {
      if ((part.type === 'tool-call' && part.toolName === 'express') || expressIds.has(part.toolCallId)) return []
      if (part.type !== 'tool-result') return [part]
      const output = part.output?.type === 'text'
        ? { ...part.output, value: clampOutput(part.output.value) }
        : part.output?.type === 'json'
          ? { type: 'text', value: clampOutput(part.output.value) }
          : part.output
      return [{ ...part, output }]
    })
    return content.length ? [{ ...message, content }] : []
  })
}

function fullHistory(turns) {
  const split = Math.max(0, turns.length - 6)
  return [
    ...compactHistory(turns.slice(0, split)),
    ...turns.slice(split).flatMap((turn) => [
      { role: 'user', content: [{ type: 'text', text: turn.user }] },
      ...replayableModelMessages(turn.modelMessages),
    ]),
  ]
}

async function loadRuntime(world, writes) {
  // The root workspace does not depend on this package by name. Import its
  // compiled entry directly, just as the existing probes import API dist.
  const agent = await import(pathToFileURL(resolve(REPO, 'packages/agent-tools/dist/index.js')).href)
  const { buildSystemPrompt } = await import(pathToFileURL(resolve(REPO, 'apps/api/dist/decke/prompt.js')).href)
  const { buildTools } = await import(pathToFileURL(resolve(REPO, 'apps/api/dist/decke/tools.js')).href)
  const { createGrounding } = await import(pathToFileURL(resolve(REPO, 'apps/api/dist/decke/grounding.js')).href)
  const definitions = agent.allTools()
  for (const def of definitions) DATA_TOOLS.add(def.name)
  const dataTools = Object.fromEntries(definitions.map((def) => [def.name, tool({
    description: def.description,
    inputSchema: def.inputSchema ?? z.object({}),
    needsApproval: def.annotations.readOnlyHint ? false : true,
    execute: async (input) => fixtureOutput(def.name, input, world, writes),
  })]))
  const checked = async (input) => fixtureDeckCheck(world, input)
  const cosmetic = buildTools({ write() {} }, createGrounding(), undefined, undefined, { checkDeck: checked })
  const web_research = tool({
    description: 'Quickly research the current state of the Pokémon TCG world: the current meta and tournament results, community opinion, news, recent releases, and price trends. Use it when DeckPal does not store the answer. Do not use it when findings already in the conversation answer the question. Write `purpose` as the short status the reader should see, such as "Dragapult ex tournament results".',
    inputSchema: z.object({
      query: z.string().max(300).describe('A plain-language Pokémon TCG question. Never include user data.'),
      topic: z.enum(['competitive', 'general']).default('general'),
      purpose: z.string().max(60).describe('Short reader-facing subject.'),
    }),
    execute: async (input) => /dragapult/i.test(`${input.query} ${input.purpose}`) ? world.research.dragapult : world.research.meta,
  })
  const tools = { ...cosmetic, ...dataTools, web_research }
  const dataToolList = [...definitions.map((def) => ({ name: def.name, title: def.title })), { name: 'web_research', title: 'Research the web' }]
  return { buildSystemPrompt, tools, dataToolList }
}

// Mirrors api/chat.mjs: one breakpoint on the system prompt covers the tools too.
function cacheTools(modelId, tools) {
  return tools
}

async function runTurn({ model, modelId, gateway, runtime, priorTurns, replay, scenarioTurn, budget }) {
  const messages = [...(replay === 'full' ? fullHistory(priorTurns) : compactHistory(priorTurns)), { role: 'user', content: [{ type: 'text', text: scenarioTurn.user }] }]
  const calls = []
  const started = performance.now()
  let first = null
  let text = ''
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let turnCost = 0
  let stepCount = 0
  const modelMessages = []
  const instructionsText = runtime.buildSystemPrompt({ route: '/decks', signedIn: true, dataTools: runtime.dataToolList })
  const instructions = modelId.startsWith('anthropic/')
    ? { role: 'system', content: instructionsText, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } }
    : instructionsText
  const allTools = cacheTools(modelId, runtime.tools)
  let legMessages = messages
  let pendingApprovedCalls = new Set()
  for (let approvalRound = 0; approvalRound < 8; approvalRound++) {
    let legMetadata = {}
    let observedStepCost = 0
    const generationIds = new Set()
    const resumedResults = []
    const result = streamText({
      model,
      instructions,
      messages: legMessages,
      tools: allTools,
      stopWhen: stepCountIs(24),
      maxOutputTokens: 8000,
      onStepFinish(step) {
        const stepMeasured = readUsage(step.usage, step.providerMetadata)
        observedStepCost += stepMeasured.cost_usd
        budget.spent += stepMeasured.cost_usd
        const stepGeneration = step.providerMetadata?.gateway?.generationId
        if (stepGeneration) generationIds.add(stepGeneration)
        if (budget.spent > budget.limit + 1e-9) {
          throw new Error(`Budget exceeded after a model call: $${budget.spent.toFixed(6)} > $${budget.limit.toFixed(6)}`)
        }
        for (const call of step.toolCalls ?? []) {
          const output = (step.toolResults ?? []).find((item) => item.toolCallId === call.toolCallId)?.output
          const found = calls.find((item) => item.id === call.toolCallId)
          if (found) found.output = output == null ? found.output : clampOutput(output)
          else calls.push({ id: call.toolCallId, name: call.toolName, input: call.input ?? call.args ?? {}, output: output == null ? undefined : clampOutput(output) })
        }
      },
    })
    for await (const part of result.fullStream) {
      if (first == null && (part.type === 'text-delta' || part.type === 'tool-call')) first = performance.now()
      if (part.type === 'text-delta') text += part.text ?? part.delta ?? ''
      if (part.type === 'tool-result') {
        const found = calls.find((call) => call.id === part.toolCallId)
        if (found) found.output = clampOutput(part.output)
        if (pendingApprovedCalls.has(part.toolCallId)) {
          const stringOutput = clampOutput(part.output)
          resumedResults.push({
            type: 'tool-result', toolCallId: part.toolCallId, toolName: part.toolName,
            output: { type: 'text', value: stringOutput },
          })
        }
      }
      if (part.providerMetadata) {
        legMetadata = { ...legMetadata, ...part.providerMetadata }
        const streamGeneration = part.providerMetadata?.gateway?.generationId
        if (streamGeneration) generationIds.add(streamGeneration)
      }
    }
    const steps = await result.steps
    const response = await result.response
    const usage = await result.totalUsage
    const finalMetadata = await result.providerMetadata
    stepCount += steps.length
    legMetadata = { ...legMetadata, ...finalMetadata }
    const measured = readUsage(usage, legMetadata)
    outputTokens += measured.output_tokens
    cacheReadTokens += measured.cache_read_tokens
    cacheWriteTokens += measured.cache_write_tokens
    const finalGeneration = legMetadata?.gateway?.generationId
    if (finalGeneration) generationIds.add(finalGeneration)
    // Per-step Gateway cost (providerMetadata.gateway.cost) is the primary figure.
    // The generation-info lookup is best-effort: usage events are eventually
    // consistent and answer 404 "Usage event not found" for a few seconds after
    // a call, which used to abort the whole run.
    measured.cost_usd = Math.max(measured.cost_usd, observedStepCost)
    if (gateway && generationIds.size && typeof gateway.getGenerationInfo === 'function') {
      let looked = 0
      let complete = true
      for (const id of generationIds) {
        try {
          const info = await gateway.getGenerationInfo({ id })
          looked += Number(info.totalCost ?? info.usage) || 0
        } catch {
          complete = false
        }
      }
      if (complete && looked > 0) measured.cost_usd = looked
    }
    budget.spent += measured.cost_usd - observedStepCost
    turnCost += measured.cost_usd
    if (budget.spent > budget.limit + 1e-9) throw new Error(`Budget exceeded after a model call: $${budget.spent.toFixed(6)} > $${budget.limit.toFixed(6)}`)
    const resumedMessage = resumedResults.length ? { role: 'tool', content: resumedResults } : null
    if (resumedMessage) modelMessages.push(resumedMessage)
    // ai@7: `response.messages` is the FINAL step only; each step carries its own.
    const legResponseMessages = steps.flatMap((step) => step.response?.messages ?? [])
    modelMessages.push(...legResponseMessages)
    const approvals = legResponseMessages.flatMap((message) => Array.isArray(message.content) ? message.content : [])
      .filter((part) => part.type === 'tool-approval-request')
    if (!approvals.length) break
    const answer = { role: 'tool', content: approvals.map((part) => ({ type: 'tool-approval-response', approvalId: part.approvalId, approved: true, reason: 'approved by the fixture reader' })) }
    modelMessages.push(answer)
    legMessages = [...legMessages, ...(resumedMessage ? [resumedMessage] : []), ...legResponseMessages, answer]
    pendingApprovedCalls = new Set(approvals.map((part) => part.toolCallId))
    if (approvalRound === 7) throw new Error('Write approval loop exceeded 8 rounds')
  }
  return {
    user: scenarioTurn.user, tags: scenarioTurn.tags, text: text.trim(), calls,
    ttft_ms: Math.round((first ?? performance.now()) - started), total_ms: Math.round(performance.now() - started),
    output_tokens: outputTokens, cost_usd: turnCost, cache_read_tokens: cacheReadTokens,
    cache_write_tokens: cacheWriteTokens, steps: stepCount, modelMessages, declined: false,
  }
}

function aggregateRows(runs) {
  return runs.map((run) => ({ model: run.model, replay: run.replay, scenario: run.scenario, sample: run.sample, ...scoreTranscript(run.turns) }))
}

function annotateTurnMetrics(turns) {
  let before = Object.fromEntries(METRIC_COLUMNS.map((key) => [key, 0]))
  return turns.map((turn, index) => {
    const after = scoreTranscript(turns.slice(0, index + 1))
    const metrics = Object.fromEntries(METRIC_COLUMNS.map((key) => [key,
      key === 'ttft_ms' || key === 'total_ms'
        ? Number(turn[key]) || 0
        : Number((after[key] - before[key]).toFixed?.(8) ?? after[key] - before[key]),
    ]))
    before = after
    return { ...turn, metrics }
  })
}

function markdown(rows) {
  const cols = ['model', 'replay', 'scenario', 'sample', ...METRIC_COLUMNS]
  const show = (value) => typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(6) : String(value)
  return [`# Deck-E conversation replay probe`, '', `| ${cols.join(' | ')} |`, `| ${cols.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${cols.map((key) => show(row[key] ?? 0)).join(' | ')} |`), ''].join('\n')
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv)
  const scenarios = JSON.parse(readFileSync(resolve(FIXTURES, 'scenarios.json'), 'utf8'))
  const selected = opts.scenarios.length ? scenarios.filter((scenario) => opts.scenarios.includes(scenario.id)) : scenarios
  const missing = opts.scenarios.filter((id) => !selected.some((scenario) => scenario.id === id))
  if (missing.length) throw new Error(`Unknown scenarios: ${missing.join(', ')}`)
  if (!opts.mock && !(process.env.AI_GATEWAY_API_KEY || process.env.DECKE_VERCEL_AI_GATEWAY_KEY)) throw new Error('Need AI_GATEWAY_API_KEY or DECKE_VERCEL_AI_GATEWAY_KEY for a real run.')
  mkdirSync(opts.out, { recursive: true })
  const world = JSON.parse(readFileSync(resolve(FIXTURES, 'world.json'), 'utf8'))
  const writes = []
  const runtime = await loadRuntime(world, writes)
  const gateway = opts.mock ? null : createGateway({ apiKey: process.env.DECKE_VERCEL_AI_GATEWAY_KEY || process.env.AI_GATEWAY_API_KEY })
  const budget = { spent: 0, limit: opts.budgetUsd }
  const runs = []
  for (const modelId of opts.models) {
    const model = opts.mock ? mockModel() : gateway(modelId)
    for (const scenario of selected) {
      for (let sample = 1; sample <= opts.n; sample++) {
        const priorTurns = []
        for (const scenarioTurn of scenario.turns) {
          priorTurns.push(await runTurn({ model, modelId, gateway, runtime, priorTurns, replay: opts.replay, scenarioTurn, budget }))
        }
        runs.push({ model: modelId, replay: opts.replay, scenario: scenario.id, sample, turns: annotateTurnMetrics(priorTurns) })
        process.stdout.write(`completed ${modelId} / ${scenario.id} / ${sample}\n`)
      }
    }
  }
  const rows = aggregateRows(runs)
  const result = { generated_at: new Date().toISOString(), options: { ...opts, out: undefined }, spent_usd: Number(budget.spent.toFixed(8)), metrics: METRIC_COLUMNS, rows, runs, writes }
  writeFileSync(resolve(opts.out, 'results.json'), `${JSON.stringify(result, null, 2)}\n`)
  writeFileSync(resolve(opts.out, 'summary.md'), markdown(rows))
  process.stdout.write(`wrote ${resolve(opts.out, 'summary.md')} and results.json; cost $${budget.spent.toFixed(6)}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
}
