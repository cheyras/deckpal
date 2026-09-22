import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import type { PendingApproval, Verdict } from '../approval'
import { replayLegParts, type ReplayPart, type ReplayPendingTool } from '../approvalReplay'

const requireFromSource = createRequire('/home/cheyras/work/deckpal-todoist/chat-source/package.json')
const { convertToModelMessages, generateText, tool } = requireFromSource('ai') as typeof import('ai')
const { MockLanguageModelV4 } = requireFromSource('ai/test') as typeof import('ai/test')
const { z } = requireFromSource('zod') as typeof import('zod')

const browserCall: ReplayPendingTool = {
  id: 'call_browser',
  name: 'goTo',
  input: { route: '/collection' },
}

const heldWrite: PendingApproval = {
  approvalId: 'approval_write',
  toolCallId: 'call_write',
  name: 'collection_add',
  title: 'Add one card',
  input: { cardId: 'sv1-1', quantity: 1 },
  signature: 'signed-proof',
}

function browserOutput(call: ReplayPendingTool): ReplayPart {
  return {
    type: `tool-${call.name}`,
    toolCallId: call.id,
    state: 'output-available',
    input: call.input,
    output: { ok: true, message: 'navigated' },
  }
}

async function mixedLeg(verdict: Verdict) {
  const controller = new AbortController()
  const ran: string[] = []
  const parts = await replayLegParts({
    prefix: [{ type: 'text', text: 'I will open the collection first.' }],
    pending: [browserCall],
    approvals: [heldWrite],
    answers: new Map([[heldWrite.approvalId, verdict]]),
    signal: controller.signal,
    runPending: async call => {
      ran.push(call.id)
      return browserOutput(call)
    },
  })
  assert.ok(parts)

  // Simulate the next request's held-write collector. It may run only from the
  // approval response at the end of the replayed assistant message.
  const writeRuns: string[] = []
  const last = parts.at(-1) as { toolCallId?: string; approval?: { approved?: boolean } }
  if (last.approval?.approved === true) writeRuns.push(last.toolCallId ?? '')
  return { parts, ran, writeRuns }
}

test('mixed streamed leg accepts: browser output is replayed once before signed approval, which stays last', async () => {
  const { parts, ran, writeRuns } = await mixedLeg({ approved: true })
  assert.deepEqual(ran, ['call_browser'], 'the browser call was dropped or ran more than once')
  assert.deepEqual(writeRuns, ['call_write'], 'the held write did not run on the next request')
  assert.deepEqual(parts.map(part => part.toolCallId), [undefined, 'call_browser', 'call_write'])
  const approval = parts.at(-1) as { approval: Record<string, unknown> }
  assert.deepEqual(approval.approval, {
    id: 'approval_write',
    approved: true,
    signature: 'signed-proof',
  })
})

test('mixed streamed leg denies: navigation still runs once and the held write remains rejected', async () => {
  const { parts, ran, writeRuns } = await mixedLeg({ approved: false, reason: 'reader declined' })
  assert.deepEqual(ran, ['call_browser'])
  assert.deepEqual(writeRuns, [], 'a rejected write ran because navigation shared its leg')
  const approval = parts.at(-1) as { approval: Record<string, unknown> }
  assert.deepEqual(approval.approval, {
    id: 'approval_write',
    approved: false,
    signature: 'signed-proof',
    reason: 'reader declined',
  })
})

test('an aborted mixed leg cannot execute a later browser call or replay an approval', async () => {
  const controller = new AbortController()
  const ran: string[] = []
  const parts = await replayLegParts({
    prefix: [],
    pending: [browserCall, { ...browserCall, id: 'call_later', name: 'flyTo' }],
    approvals: [heldWrite],
    answers: new Map([[heldWrite.approvalId, { approved: true }]]),
    signal: controller.signal,
    runPending: async call => {
      ran.push(call.id)
      controller.abort()
      return browserOutput(call)
    },
  })
  assert.equal(parts, null, 'an aborted turn was allowed to create a next request')
  assert.deepEqual(ran, ['call_browser'], 'a browser call ran after cancellation')
})

test('approval-only and browser-only legs keep their existing shapes', async () => {
  const approvalOnly = await replayLegParts({
    prefix: [{ type: 'text', text: 'May I?' }],
    pending: [],
    approvals: [heldWrite],
    answers: new Map([[heldWrite.approvalId, { approved: true }]]),
    signal: new AbortController().signal,
    runPending: async () => assert.fail('approval-only replay ran a browser tool'),
  })
  assert.ok(approvalOnly)
  assert.deepEqual(approvalOnly.map(part => part.type), ['text', 'tool-collection_add'])

  let browserRuns = 0
  const browserOnly = await replayLegParts({
    prefix: [{ type: 'text', text: 'Going there.' }],
    pending: [browserCall],
    approvals: [],
    signal: new AbortController().signal,
    runPending: async call => {
      browserRuns++
      return browserOutput(call)
    },
  })
  assert.ok(browserOnly)
  assert.equal(browserRuns, 1)
  assert.deepEqual(browserOnly.map(part => part.type), ['text', 'tool-goTo'])
})

test('multiple approvals keep independent allow/deny verdicts after browser output', async () => {
  const second = { ...heldWrite, approvalId: 'approval_second', toolCallId: 'call_second' }
  const parts = await replayLegParts({
    prefix: [],
    pending: [browserCall],
    approvals: [heldWrite, second],
    answers: new Map([
      [heldWrite.approvalId, { approved: true }],
      [second.approvalId, { approved: false, reason: 'not this one' }],
    ]),
    signal: new AbortController().signal,
    runPending: async call => browserOutput(call),
  })
  assert.ok(parts)
  assert.deepEqual(parts.map(part => (part.approval as { approved?: boolean } | undefined)?.approved),
    [undefined, true, false])
  assert.equal((parts.at(-1)?.approval as { reason?: string }).reason, 'not this one')
})

test('real AI SDK conversion executes only the approved mixed-leg write and preserves signatures/order', async () => {
  const parts = await replayLegParts({
    prefix: [{ type: 'text', text: 'replay' }], pending: [browserCall],
    approvals: [heldWrite], answers: new Map([[heldWrite.approvalId, { approved: true }]]),
    signal: new AbortController().signal, runPending: async call => browserOutput(call),
  })
  assert.ok(parts)
  const messages = await convertToModelMessages([
    { role: 'user', parts: [{ type: 'text', text: 'do it' }] },
    { role: 'assistant', parts: parts as never },
  ])
  const runs: string[] = []
  await generateText({
    model: new MockLanguageModelV4({
      doGenerate: { content: [{ type: 'text', text: 'done' }], finishReason: { unified: 'stop', raw: 'stop' },
        usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }, warnings: [] },
    }),
    messages,
    tools: { collection_add: tool({ inputSchema: z.object({ cardId: z.string(), quantity: z.number() }), execute: async input => { runs.push('write'); return input } }) },
  })
  assert.deepEqual(runs, ['write'])
  assert.deepEqual(parts.map(part => part.toolCallId), [undefined, 'call_browser', 'call_write'])
  assert.equal((parts.at(-1)?.approval as { signature: string }).signature, 'signed-proof')
})

test('already-aborted approval-only replay returns null before signing an approval', async () => {
  const controller = new AbortController()
  controller.abort()
  const parts = await replayLegParts({ prefix: [], pending: [], approvals: [heldWrite], signal: controller.signal, runPending: async () => assert.fail() })
  assert.equal(parts, null)
})
