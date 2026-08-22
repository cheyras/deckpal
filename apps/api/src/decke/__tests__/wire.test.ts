/**
 * The wire format, pinned to the SDK that actually produces it.
 *
 * ── WHY THIS TEST EXISTS ─────────────────────────────────────────────────────
 *
 * For its whole life the browser collected forwarded tool calls with:
 *
 *     part.type.startsWith('tool-') && part.state === 'input-available'
 *
 * `state` is not a field on this chunk. It is a field on a UI MESSAGE PART,
 * which is a different object that shares the vocabulary. So the guard was
 * `undefined === 'input-available'` on every chunk it ever saw, `flyTo`/`goTo`/
 * `highlight` were dropped silently, and Deck-E narrated journeys that never
 * happened — for everyone, for months. Nothing failed. No type error, no
 * exception, no log line. The only symptom was a character who lied.
 *
 * A test that asserts what we BELIEVE the format is would have passed just as
 * happily. So this drives the real `buildTools()` through the real
 * `createUIMessageStream` pipeline and asserts the bytes, which is the only
 * version of this claim that can be wrong out loud.
 *
 * It also pins the second half, which is easier to miss and worse to get wrong:
 * SERVER-EXECUTED tools emit the same `tool-input-available` chunk. Fixing the
 * guard without also filtering to `CLIENT_TOOLS` hands `express` to a browser
 * that cannot run it, which posts a second, contradicting output for a call id
 * the server has already answered.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { convertToModelMessages, createUIMessageStream, streamText, type UIMessageChunk } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { buildTools, CLIENT_TOOLS } from '../tools.js'

/**
 * A model that says one line and then calls one client tool and one server
 * tool — the shape of every real navigation turn.
 */
function modelThatCalls(calls: { toolCallId: string; toolName: string; input: unknown }[]) {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: 'stream-start', warnings: [] })
          c.enqueue({ type: 'text-start', id: '0' })
          c.enqueue({ type: 'text-delta', id: '0', delta: 'Taking you there.' })
          c.enqueue({ type: 'text-end', id: '0' })
          for (const call of calls) {
            c.enqueue({
              type: 'tool-call',
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              input: JSON.stringify(call.input),
            })
          }
          c.enqueue({
            type: 'finish',
            // `tool-calls` is the real reason: a client tool has no server
            // `execute`, so the turn ends here and the browser takes over. It is
            // a STRUCTURED value at this provider version — `unified` plus the
            // provider's own `raw` string — not the bare string it used to be.
            finishReason: { unified: 'tool-calls' as const, raw: 'tool_calls' },
            // Structured at this provider version, and there is no `totalTokens`
            // — a flat `{inputTokens: 1, totalTokens: 2}` is a type error, which
            // is the build catching a stale mock rather than a test quietly
            // asserting a shape the SDK stopped using.
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
          })
        },
      }),
    }),
  })
}

/**
 * Read the stream to the point where the browser would take over.
 *
 * BOUNDED, and the bound is the finding rather than a workaround: a client tool
 * has no server `execute`, so the SDK holds the stream open waiting for a result
 * only the browser can supply. That is exactly why the journey loop lives in the
 * client (§2.2 of the spec) — the server turn cannot advance itself. An
 * unbounded `for await` here does not fail, it hangs, which is the same class of
 * silent non-event this whole test file exists to make loud.
 */
async function wireOf(
  calls: { toolCallId: string; toolName: string; input: unknown }[],
): Promise<UIMessageChunk[]> {
  const written: unknown[] = []
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      const result = streamText({
        model: modelThatCalls(calls),
        messages: [{ role: 'user', content: 'take me to my decks' }],
        // THE REAL TOOL SET, not a stand-in. A stand-in would test the SDK; this
        // tests the thing that ships.
        tools: buildTools({ write: (p: unknown) => written.push(p) }),
      })
      writer.merge(result.toUIMessageStream({ sendReasoning: false }))
    },
  })

  const parts: UIMessageChunk[] = []
  const reader = stream.getReader()
  // Long enough that a slow machine cannot mistake latency for the end of the
  // stream; short enough that a genuine hang is a failed test, not a hung CI job.
  const QUIET_MS = 2_000
  try {
    for (;;) {
      const next = await Promise.race([
        reader.read(),
        new Promise<'quiet'>((r) => setTimeout(() => r('quiet'), QUIET_MS).unref?.()),
      ])
      if (next === 'quiet') break
      if (next.done) break
      parts.push(next.value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return parts
}

test('a forwarded tool call carries no `state` field — the guard that read one never matched', async () => {
  const parts = await wireOf([
    { toolCallId: 'call_1', toolName: 'goTo', input: { route: '/decks' } },
  ])
  const call = parts.find((p) => p.type === 'tool-input-available') as
    | Record<string, unknown>
    | undefined

  assert.ok(call, 'the SDK emits no tool-input-available chunk at all')
  assert.equal(call.toolCallId, 'call_1')
  assert.equal(call.toolName, 'goTo')
  assert.deepEqual(call.input, { route: '/decks' })
  assert.equal(
    'state' in call,
    false,
    'if `state` ever appears here the browser guard may read it — until then, ' +
      'reading it is a predicate that is false on every chunk in existence',
  )
})

test('the tool NAME is a field, not a slice of the type', async () => {
  const parts = await wireOf([
    { toolCallId: 'call_1', toolName: 'flyTo', input: { selector: '#x' } },
  ])
  const call = parts.find((p) => p.type === 'tool-input-available') as Record<string, unknown>

  // The near-miss fix: slicing the type at 'tool-' yields 'input-available',
  // which is dispatched as a tool name and answered "I do not know how to do
  // that" — a repair that looks like it worked and is wrong in a new way.
  assert.equal((call.type as string).slice('tool-'.length), 'input-available')
  assert.equal(call.toolName, 'flyTo')
})

test('server-executed tools emit the same chunk, which is why the filter is not optional', async () => {
  const parts = await wireOf([
    { toolCallId: 'call_1', toolName: 'goTo', input: { route: '/decks' } },
    { toolCallId: 'call_2', toolName: 'express', input: { commands: [{ op: 'idle' }] } },
  ])
  const announced = parts
    .filter((p) => p.type === 'tool-input-available')
    .map((p) => (p as { toolName: string }).toolName)

  assert.deepEqual(
    announced,
    ['goTo', 'express'],
    'both kinds announce identically on the wire — nothing in the chunk says ' +
      'which side is meant to run it',
  )
  // And `express` has ALREADY run by then: the server answered it in the same
  // stream. A browser that re-runs it posts a contradicting second output.
  const answered = parts
    .filter((p) => p.type === 'tool-output-available')
    .map((p) => (p as { toolCallId: string }).toolCallId)
  assert.deepEqual(answered, ['call_2'])

  const forwarded = announced.filter((n) => (CLIENT_TOOLS as readonly string[]).includes(n))
  assert.deepEqual(forwarded, ['goTo'], 'only the client tool should survive the filter')
})

test('a browser tool result replays as a UI message part, where `state` IS the field', async () => {
  // The other half of the confusion, asserted so the two shapes stay told
  // apart: the STREAM chunk has no `state`; the MESSAGE part requires one.
  // `convertToModelMessages` is what the chat function feeds the follow-up leg
  // to, so if this shape were wrong the model would see a result for a call it
  // never made.
  // `convertToModelMessages` is ASYNC at this version — the chat function
  // awaits it too. Forgetting to gives you a Promise that every array method on
  // it fails against, which is at least loud.
  const modelMessages = await convertToModelMessages([
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'take me to my decks' }] },
    {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Taking you there.' },
        {
          type: 'tool-goTo',
          toolCallId: 'call_1',
          state: 'output-available',
          input: { route: '/decks' },
          output: { ok: true },
        },
      ],
    },
  ] as never)

  const assistant = modelMessages.find((m) => m.role === 'assistant')
  const toolMsg = modelMessages.find((m) => m.role === 'tool')
  assert.ok(assistant, 'the call must survive as an assistant message')
  assert.ok(toolMsg, 'the result must survive as a tool message paired to it')
})
