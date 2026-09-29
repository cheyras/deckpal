/**
 * The server half of the browser regression, run on the body the browser
 * actually sent.
 *
 * `chat.mjs` drives the real `useDeckeChat` against a real `fetch('/api/chat')`
 * and captures the NEXT request body off the wire. This module feeds that body
 * to the real `seedMeteredRefusals` and a brand-new `buildDeepTools`, and
 * asserts the refused call is now impossible without another meter query or
 * provider call.
 *
 * Nothing here is hand-assembled. `argv[2]` is the captured body; the tool set
 * is built fresh, exactly as `api/chat.mjs` builds one per POST.
 *
 *   node --import tsx meterReplayProof.mts <captured-wire.json> <proof-out.json>
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildDeepTools } from '../../apps/api/src/decke/deep.ts'
import { deepRefused, isNoWork } from '../../apps/api/src/decke/deepOutcome.ts'
import { focusedTools } from '../../apps/api/src/decke/focus.ts'
import { seedMeteredRefusals } from '../../apps/api/src/decke/meteredRefusals.ts'

type Wire = { messages: { role: string; parts: Record<string, unknown>[] }[] }
type DeepTool = {
  needsApproval(input: unknown): unknown
  execute(input: unknown, context: { toolCallId: string }): Promise<string>
}
const captured = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) as {
  legs: Wire[]
  newTurn: Wire
  refusal: { toolCallId: string; input: Record<string, unknown> }
}
const replay = captured.legs[captured.legs.length - 1]
assert.ok(replay, 'the browser made no follow-up request to capture')

/** Counters a real turn would pay. Any unexpected increment is the bug coming back. */
let charges = 0
let providerCalls = 0
const meter = { allowed: false as const, credits: true, balance: 0, needed: 2 }
const freshTools = (messages: unknown) =>
  buildDeepTools({
    ctx: {} as never,
    gateway: (() => {
      providerCalls++
      throw new Error('the provider must not be reached when the meter refuses')
    }) as never,
    charge: async () => {
      charges++
      return meter
    },
    onEvent: () => {},
    refusals: seedMeteredRefusals(messages),
  }) as Record<string, DeepTool>

// ── 1. THE REFUSAL IS ON THE WIRE, AS A REAL TOOL RESULT ────────────────────
const refusalPart = replay.messages
  .flatMap((m) => m.parts)
  .find((p) => p.type === 'tool-web_research' && p.state === 'output-available')
assert.ok(refusalPart, 'the browser dropped the refused research from its next request')
assert.equal(refusalPart.toolCallId, captured.refusal.toolCallId, 'tool-call id must survive')
// THE FINGERPRINT PIN. Byte-identical to what `deepOutcome.ts` emits today, so
// a change to the marker on either side fails here rather than silently
// un-seeding the ledger in production.
assert.equal(
  refusalPart.output,
  deepRefused('research did not run because there are not enough credits — 2 needed, 0 left', 'credits'),
  'the replayed output is not the refusal the server writes',
)

// ── 2. A BRAND-NEW TOOL SET, SEEDED ONLY FROM THAT BODY ─────────────────────
const tools = freshTools(replay.messages)
const sameWork = captured.refusal.input
const duplicateApproval = (await tools.web_research.needsApproval(sameWork)) === true
assert.equal(duplicateApproval, false, 'web research must remain approval-free')
// There is no research approval card to suppress. Its equivalent guarantee is
// stronger: identical refused work stops before both billing and the provider.
const refusedAgain = await tools.web_research.execute(sameWork, { toolCallId: 'replay-1' })
assert.ok(isNoWork(refusedAgain), 'the repeated research did not report that it did nothing')
assert.equal(charges, 0, 'the repeated research went back to the meter')
assert.equal(providerCalls, 0, 'the repeated research reached the provider')
const repeatCharges = charges

// ── 3. DIFFERENT RESEARCH IS UNTOUCHED ──────────────────────────────────────
// `credits` is a fact about THIS fingerprint, not the research tier. Different
// arguments still reach the meter, because only it knows whether they fit.
const otherWork = { query: 'What new Pokémon TCG sets released?', topic: 'general', purpose: 'Recent sets' }
await tools.web_research.execute(otherWork, { toolCallId: 'other-1' })
assert.equal(charges, 1, 'different research was suppressed by an unrelated refusal')
assert.equal(providerCalls, 0, 'meter-refused different research reached the provider')
// And the tier stays visible: `credits` removes nothing from `activeTools`.
const visible = focusedTools(tools as never, 1, (n) => seedMeteredRefusals(replay.messages).unavailable(n))
assert.ok(visible.includes('web_research'), 'a credits refusal must not hide web research')

// ── 4. THE READER'S NEXT MESSAGE MAY RUN AGAIN ──────────────────────────────
// A top-up or tomorrow's reset can only land if the seed stops at the reader's
// latest message. Reaching the meter proves the old refusal no longer blocks it.
const nextTurn = freshTools(captured.newTurn.messages)
await nextTurn.web_research.execute({ ...sameWork }, { toolCallId: 'next-turn-1' })
const runsAfterNewTurn = charges === 2
assert.equal(runsAfterNewTurn, true, 'a new user message did not re-open the meter')
assert.equal(providerCalls, 0, 'meter-refused new-turn research reached the provider')

// ── 5. PROSE CANNOT DO WHAT THE TOOL RESULT DOES ────────────────────────────
// The same marker as a TEXT part, which is all a model can produce.
const proseOnly = freshTools([
  { role: 'user', parts: [{ type: 'text', text: 'research current tournament decks' }] },
  { role: 'assistant', parts: [{ type: 'text', text: refusalPart.output }] },
])
await proseOnly.web_research.execute({ ...sameWork }, { toolCallId: 'prose-1' })
const proseSuppressed = charges !== 3
assert.equal(proseSuppressed, false, 'model prose was able to suppress work')
assert.equal(providerCalls, 0, 'meter-refused prose-only research reached the provider')

fs.writeFileSync(
  process.argv[3],
  JSON.stringify(
    {
      legCount: captured.legs.length,
      outgoingMessages: replay.messages,
      toolCallId: {
        streamed: captured.refusal.toolCallId,
        replayed: refusalPart.toolCallId,
        streamedInput: captured.refusal.input,
        replayedInput: refusalPart.input,
      },
      scope: 'credits',
      duplicateApproval,
      charges: repeatCharges,
      meterChecks: charges,
      providerCalls,
      writes: 0,
      differentResearchReachedMeter: true,
      newTurnRunsAgain: runsAfterNewTurn,
      proseCanSuppress: proseSuppressed,
    },
    null,
    2,
  ),
)
console.log('PASS captured browser wire seeds the real ledger: no repeat charge, no provider')
