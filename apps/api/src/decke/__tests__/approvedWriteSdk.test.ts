/**
 * A held write against the REAL SDK (ai@7), on the leg AFTER the one it ran.
 *
 * "Log this game and take me to my battle logs" holds `add_battle_log` and
 * runs the browser's `goTo` in one step. The approval leg runs the write. On
 * any further leg the browser sends the write as the finished call it became
 * (`settleApprovedCalls` in apps/web), not as the one-leg approval answer.
 * This pins what that buys on the server: the model's prompt pairs the write's
 * tool call with its result, the SDK raises no MissingToolResultsError, and
 * the handler ran exactly once. The counter-case — the answer left in the
 * wire — is kept too, because it is what the browser used to send: the SDK
 * passes it without complaint and the provider gets a call with no result.
 *
 * Modelled on `deepThinkSdk.test.ts`; the fake API is `writeIdempotency`'s.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { convertToModelMessages, streamText } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import type { ToolDefinition } from '@deckpal/agent-tools'
import { buildDataTools } from '../adapters/aisdk.js'

const DECK = '00000000-0000-4000-8000-0000000000d1'
const INPUT = { deck_id: DECK, log: 'PTCGL battle log text', dry_run: false }
const SECRET = 'test-only-approved-write-secret'
const QUESTION = 'Log this game and take me to my battle logs'

type Part = Record<string, unknown>
type Message = { role: string; parts: Part[] }
type PromptMessage = { role: string; content: Array<{ type: string; toolCallId?: string }> }

/** A deckpal-api with one deck and a battle-log route that counts real writes. */
function fakeApi() {
  let writes = 0
  const oldFetch = globalThis.fetch
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = new URL(typeof url === 'string' ? url : url instanceof URL ? url : url.url)
    const path = target.pathname.replace(/^\/api/, '') + target.search
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
    const json = (value: unknown) =>
      new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
    if (method === 'GET' && path === '/decks') return json({ decks: [{ id: DECK, name: 'Toolbox', formatCode: 'standard' }] })
    if (method === 'GET' && path.startsWith(`/decks/${DECK}/logs?`)) {
      return json({ totals: { total: writes, wins: writes, losses: 0, ties: 0 } })
    }
    if (method === 'POST' && path === `/decks/${DECK}/logs`) {
      if (body.dryRun === true) {
        return json({ dryRun: true, preview: { deckName: 'Toolbox', version: 3 }, parsed: null, attachedToVersion: 3 })
      }
      writes += 1
      return json({
        log: { id: writes, deckVersion: 3, result: 'win', opponent: 'Rival', opponentDeck: null, turns: 9, prizes: null, parsed: null },
        attachedToVersion: 3,
      })
    }
    throw new Error(`unexpected ${method} ${path}`)
  }) as typeof fetch
  return { writes: () => writes, restore: () => { globalThis.fetch = oldFetch } }
}

const tools = () => buildDataTools({
  pool: { connect: async () => { throw new Error('no database in this test') } } as never,
  userId: 'user-1',
  jwt: 'jwt',
  apiBase: 'https://example.test/api',
  include: (d: ToolDefinition) => d.name === 'add_battle_log',
  onApprovalPreview: () => {},
} as never) as Record<string, any>

/** A model that calls the given tools, or answers in text, and records every prompt it is sent. */
function model(calls: Array<{ toolCallId: string; toolName: string; input: unknown }> = []) {
  const seen: PromptMessage[][] = []
  const m = new MockLanguageModelV3({
    doStream: async (options: { prompt: unknown }) => {
      seen.push(options.prompt as PromptMessage[])
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            for (const call of calls) {
              controller.enqueue({ type: 'tool-call', toolCallId: call.toolCallId, toolName: call.toolName, input: JSON.stringify(call.input) })
            }
            if (!calls.length) {
              controller.enqueue({ type: 'text-start', id: 't' })
              controller.enqueue({ type: 'text-delta', id: 't', delta: 'Logged your game.' })
              controller.enqueue({ type: 'text-end', id: 't' })
            }
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: calls.length ? 'tool-calls' : 'stop', raw: calls.length ? 'tool_calls' : 'stop' },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            })
            controller.close()
          },
        }),
      }
    },
  } as never)
  return { m, seen }
}

async function drain(stream: ReadableStream<unknown>): Promise<Part[]> {
  const parts: Part[] = []
  const reader = stream.getReader()
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const quiet = new Promise<'quiet'>((resolve) => { timer = setTimeout(() => resolve('quiet'), 2_000) })
      const next = await Promise.race([reader.read(), quiet])
      clearTimeout(timer)
      if (next === 'quiet' || next.done) return parts
      parts.push(next.value as Part)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

/** One request through the real SDK, signed, as `api/chat.mjs` sends it. */
async function leg(messages: Message[], calls?: Parameters<typeof model>[0]) {
  const mock = model(calls)
  const errors: unknown[] = []
  const parts = await drain(streamText({
    model: mock.m,
    messages: await convertToModelMessages(messages as never),
    tools: tools(),
    experimental_toolApprovalSecret: SECRET,
    onError: ({ error }) => { errors.push(error) },
  }).fullStream as ReadableStream<unknown>)
  return { parts, errors, prompts: mock.seen }
}

const callIds = (prompt: PromptMessage[]) =>
  prompt.flatMap((m) => m.role === 'assistant' ? m.content.filter((c) => c.type === 'tool-call').map((c) => c.toolCallId) : []).sort()
const resultIds = (prompt: PromptMessage[]) =>
  prompt.flatMap((m) => m.role === 'tool' ? m.content.filter((c) => c.type === 'tool-result').map((c) => c.toolCallId) : []).sort()

test('a held write, settled by the browser, reaches the next leg paired with its result and runs once', async () => {
  const api = fakeApi()
  try {
    // Leg 1: the model calls the write and the SDK holds it behind a signed card.
    const first = await leg([{ role: 'user', parts: [{ type: 'text', text: QUESTION }] }], [
      { toolCallId: 'log-1', toolName: 'add_battle_log', input: INPUT },
    ])
    const request = first.parts.find((p) => p.type === 'tool-approval-request') as
      { approvalId: string; signature: string } | undefined
    assert.ok(request, 'the write was not held for approval')
    assert.equal(api.writes(), 0, 'the write ran before it was approved')

    // Leg 2, the approval leg: the browser ran `goTo` in the same step and the
    // reader said yes. The answer is last, where the SDK collects it.
    const goTo: Part = { type: 'tool-goTo', toolCallId: 'g1', input: { to: '/battle-logs' }, state: 'output-available', output: { ok: true } }
    const approvalLeg: Message[] = [
      { role: 'user', parts: [{ type: 'text', text: QUESTION }] },
      {
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Logging it now.' },
          goTo,
          {
            type: 'tool-add_battle_log', toolCallId: 'log-1', input: INPUT, state: 'approval-responded',
            approval: { id: request.approvalId, approved: true, signature: request.signature },
          },
        ],
      },
    ]
    const second = await leg(approvalLeg)
    assert.deepEqual(second.errors, [])
    assert.equal(api.writes(), 1, 'the approved write did not run')
    const result = second.parts.find((p) => p.type === 'tool-result' && p.toolCallId === 'log-1') as { output: unknown } | undefined
    assert.ok(result, 'the write streamed no result')

    // Leg 3: the browser has settled the answer into the finished call
    // (`settleApprovedCalls`), and another browser tool ran in between.
    const laterLeg: Message[] = [
      { role: 'user', parts: [{ type: 'text', text: QUESTION }] },
      {
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Logging it now.' },
          goTo,
          { type: 'tool-add_battle_log', toolCallId: 'log-1', input: INPUT, state: 'output-available', output: JSON.stringify(result.output) },
        ],
      },
      { role: 'assistant', parts: [{ type: 'tool-goTo', toolCallId: 'g2', input: { to: '/battle-logs/1' }, state: 'output-available', output: { ok: true } }] },
    ]
    const third = await leg(laterLeg)
    assert.deepEqual(third.errors, [], 'the SDK refused the settled wire (MissingToolResultsError?)')
    assert.ok(!third.parts.some((p) => p.type === 'error'), 'the leg failed')
    assert.equal(third.prompts.length, 1, 'the model was not called')
    const prompt = third.prompts[0]!
    assert.deepEqual(callIds(prompt), ['g1', 'g2', 'log-1'])
    assert.deepEqual(resultIds(prompt), ['g1', 'g2', 'log-1'], 'a tool call reached the model with no result')
    assert.ok(!third.parts.some((p) => p.type === 'tool-approval-request'), 'a second approval was raised')
    assert.equal(api.writes(), 1, 'the write ran again')

    // The counter-case: the same leg with the approval answer left in place,
    // which is what the browser sent before. The SDK lets it through, and the
    // write's call reaches the model with no result.
    const unsettled: Message[] = [approvalLeg[0]!, approvalLeg[1]!, laterLeg[2]!]
    const stale = await leg(unsettled)
    const stalePrompt = stale.prompts[0]
    assert.ok(stalePrompt, 'premise: the SDK refused the unsettled wire outright')
    assert.ok(callIds(stalePrompt).includes('log-1'))
    assert.ok(!resultIds(stalePrompt).includes('log-1'), 'premise: the unsettled wire already paired the write')
    assert.equal(api.writes(), 1, 'an answer left in an earlier message ran the write again')
  } finally {
    api.restore()
  }
})
