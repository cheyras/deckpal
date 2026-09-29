#!/usr/bin/env node
/**
 * Probe the UI-message histories Deck-E sends when a browser continuation
 * starts a fresh request. Anthropic thinking is intentionally not replayed by
 * the browser, so these are the shapes most likely to expose a provider rule
 * about a final assistant tool call.
 */
import { createGateway } from '@ai-sdk/gateway'
import { convertToModelMessages, stepCountIs, streamText, tool } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { z } from 'zod'

const ANTHROPIC_CACHE = { anthropic: { cacheControl: { type: 'ephemeral' } } }
const SYSTEM = 'You are Deck-E. Continue the conversation helpfully after any completed tool work.'

function uiTool(type, toolCallId, input, state, extra = {}) {
  return { type: `tool-${type}`, toolCallId, input, state, ...extra }
}

/** The exact four browser histories that begin a continuation leg. */
export function continuationShapes() {
  return [
    {
      name: 'approval continuation',
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'add 2 Pikachu to my collection' }] },
        { id: 'a1', role: 'assistant', parts: [uiTool('log_cards', 'c1', { cards: [{ name: 'Pikachu', quantity: 2 }] }, 'approval-responded', {
          approval: { id: 'a1', approved: true },
        })] },
      ],
    },
    {
      name: 'browser-tool continuation',
      messages: [
        { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'take me to my decks' }] },
        { id: 'a2', role: 'assistant', parts: [
          { type: 'text', text: 'I’ll take you there.' },
          uiTool('goTo', 'c2', { route: '/decks' }, 'output-available', { output: { ok: true } }),
        ] },
      ],
    },
    {
      name: 'prior-turn replay',
      messages: [
        { id: 'u3', role: 'user', parts: [{ type: 'text', text: "what's my deck record?" }] },
        { id: 'a3', role: 'assistant', parts: [
          uiTool('decks', 'c3', {}, 'output-available', { output: 'Toolbox Slowking … 19W–13L' }),
          { type: 'text', text: 'Toolbox Slowking is 19W–13L.' },
        ] },
        { id: 'u4', role: 'user', parts: [{ type: 'text', text: 'and which version did best?' }] },
      ],
    },
    {
      name: 'declined replay',
      messages: [
        { id: 'u5', role: 'user', parts: [{ type: 'text', text: 'save this deck for me' }] },
        { id: 'a4', role: 'assistant', parts: [
          uiTool('save_deck', 'c4', { name: 'Toolbox Slowking' }, 'output-denied', {
            approval: { id: 'a2', approved: false, reason: 'The reader chose not to save this deck.' },
          }),
          { type: 'text', text: 'Okay, I won’t save it.' },
        ] },
        { id: 'u6', role: 'user', parts: [{ type: 'text', text: 'what should I change first?' }] },
      ],
    },
  ]
}

function fakeTools() {
  return {
    log_cards: tool({
      description: 'Add cards to the collection.',
      inputSchema: z.object({ cards: z.array(z.object({ name: z.string(), quantity: z.number().int().positive() })) }),
      needsApproval: true,
      execute: async () => 'Added 2 Pikachu.',
    }),
    // Browser fulfils navigation, so this deliberately has no execute handler.
    goTo: tool({ description: 'Navigate the reader to a route.', inputSchema: z.object({ route: z.string() }) }),
    decks: tool({ description: 'Read deck records.', inputSchema: z.object({}), execute: async () => 'Toolbox Slowking: 19W–13L.' }),
    save_deck: tool({
      description: 'Save a deck.', inputSchema: z.object({ name: z.string() }), needsApproval: true,
      execute: async () => 'Saved Toolbox Slowking.',
    }),
  }
}

function cachedTools(modelId, tools) {
  if (!modelId.startsWith('anthropic/')) return tools
  return Object.fromEntries(Object.entries(tools).map(([name, value]) => [name, {
    ...value,
    providerOptions: { ...(value.providerOptions ?? {}), anthropic: { cacheControl: { type: 'ephemeral' } } },
  }]))
}

function mockModel() {
  return new MockLanguageModelV3({
    modelId: 'decke-leg-smoke-mock',
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] })
          controller.enqueue({ type: 'text-start', id: 'answer' })
          controller.enqueue({ type: 'text-delta', id: 'answer', delta: 'Mock continuation succeeded.' })
          controller.enqueue({ type: 'text-end', id: 'answer' })
          controller.enqueue({ type: 'finish', finishReason: 'stop', usage: {
            inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 5, text: 5, reasoning: 0 },
          }, providerMetadata: { gateway: { cost: 0 } } })
          controller.close()
        },
      }),
    }),
  })
}

function firstLine(error) {
  return String(error?.message ?? error).split(/\r?\n/, 1)[0].trim() || 'Unknown error'
}

function costFrom(metadata) {
  const value = metadata?.gateway?.cost ?? metadata?.gateway?.totalCost ?? metadata?.gateway?.total_cost_usd
  return typeof value === 'number' && Number.isFinite(value) ? `$${value.toFixed(6)}` : 'n/a'
}

function hasReasoning(reasoning) {
  if (typeof reasoning === 'string') return reasoning.trim().length > 0
  if (Array.isArray(reasoning)) return reasoning.length > 0
  return Boolean(reasoning)
}

export async function convertShape(shape) {
  return convertToModelMessages(shape.messages)
}

export async function runShape({ shape, modelId, mock, gateway }) {
  try {
    const messages = await convertShape(shape)
    const result = streamText({
      model: mock ? mockModel() : gateway(modelId),
      instructions: modelId.startsWith('anthropic/')
        ? { role: 'system', content: SYSTEM, providerOptions: ANTHROPIC_CACHE }
        : SYSTEM,
      messages,
      tools: cachedTools(modelId, fakeTools()),
      maxOutputTokens: 300,
      stopWhen: stepCountIs(3),
    })
    await result.text
    const [reasoning, providerMetadata] = await Promise.all([result.reasoning, result.providerMetadata])
    return { ok: true, reasoning: hasReasoning(reasoning), cost: costFrom(providerMetadata) }
  } catch (error) {
    return { ok: false, error: firstLine(error) }
  }
}

export function parseArgs(argv = process.argv.slice(2)) {
  const mock = argv.includes('--mock')
  const modelIndex = argv.indexOf('--models')
  const value = modelIndex >= 0 ? argv[modelIndex + 1] : undefined
  if (modelIndex >= 0 && (!value || value.startsWith('--'))) throw new Error('--models needs a comma-separated value')
  return {
    mock,
    models: (value ?? (mock ? 'mock' : 'anthropic/claude-sonnet-5.5,anthropic/claude-sonnet-5')).split(',').filter(Boolean),
  }
}

function printRow(shape, model, outcome) {
  const result = outcome.ok
    ? `OK · reasoning ${outcome.reasoning ? 'yes' : 'no'} · cost ${outcome.cost}`
    : `ERROR ${outcome.error}`
  console.log(`${shape.padEnd(28)} | ${model.padEnd(30)} | ${result}`)
}

export async function main(argv = process.argv.slice(2)) {
  const { mock, models } = parseArgs(argv)
  const key = process.env.DECKE_VERCEL_AI_GATEWAY_KEY || process.env.AI_GATEWAY_API_KEY
  const gateway = !mock && key ? createGateway({ apiKey: key }) : null
  console.log('Shape                        | Model                          | Result')
  console.log('-----------------------------+--------------------------------+-----------------------------------------------')
  for (const model of models) {
    for (const shape of continuationShapes()) {
      const outcome = !mock && !gateway
        ? { ok: false, error: 'Missing DECKE_VERCEL_AI_GATEWAY_KEY or AI_GATEWAY_API_KEY' }
        : await runShape({ shape, modelId: model, mock, gateway })
      printRow(shape.name, model, outcome)
    }
  }
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) await main()
