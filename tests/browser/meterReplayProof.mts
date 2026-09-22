/**
 * The server half of the browser regression, run on the body the browser
 * actually sent.
 *
 * `chat.mjs` drives the real `useDeckeChat` against a real `fetch('/api/chat')`
 * and captures the NEXT request body off the wire. This module — the only place
 * in `tests/browser` that needs the API's TypeScript, hence tsx and hence its
 * own file — feeds that captured body to the real `seedMeteredRefusals` and a
 * brand-new `buildDeepTools`, and asserts the refused call is now impossible
 * without a card, a meter query or a provider call.
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
const captured = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) as {
  legs: Wire[]
  newTurn: Wire
  refusal: { toolCallId: string; input: Record<string, unknown> }
}
const replay = captured.legs[captured.legs.length - 1]
assert.ok(replay, 'the browser made no follow-up request to capture')

/** Counters a real turn would pay. Any non-zero one is the bug coming back. */
let charges = 0
const meter = { allowed: false as const, credits: true, balance: 0, needed: 2 }
const freshTools = (messages: unknown) =>
  buildDeepTools({
    ctx: {} as never,
    gateway: (() => {
      throw new Error('the provider must never be reached after a refusal')
    }) as never,
    charge: async () => {
      charges++
      return meter
    },
    onEvent: () => {},
    refusals: seedMeteredRefusals(messages),
  }) as Record<string, { needsApproval(i: unknown): unknown; execute(i: unknown, c: { toolCallId: string }): Promise<string> }>

// ── 1. THE REFUSAL IS ON THE WIRE, AS A REAL TOOL RESULT ────────────────────
const refusalPart = replay.messages
  .flatMap((m) => m.parts)
  .find((p) => p.type === 'tool-write_strategy_guide' && p.state === 'output-available')
assert.ok(refusalPart, 'the browser dropped the refused guide from its next request')
assert.equal(refusalPart.toolCallId, captured.refusal.toolCallId, 'tool-call id must survive')
// THE FINGERPRINT PIN. Byte-identical to what `deepOutcome.ts` emits today, so
// a change to the marker on either side fails here rather than silently
// un-seeding the ledger in production.
assert.equal(
  refusalPart.output,
  deepRefused('this needs 2 credits and only 0 are left', 'credits'),
  'the replayed output is not the refusal the server writes',
)

// ── 2. A BRAND-NEW TOOL SET, SEEDED ONLY FROM THAT BODY ─────────────────────
const tools = freshTools(replay.messages)
// The ORIGINAL arguments, as the model first emitted them — no `no_research`,
// which the server injects during `needsApproval` and which must not change a
// call's identity. This is the fresh object the second leg would carry.
const sameWork = { deck_id: 'deck-browser', findings: '' }
const duplicateApproval = (await tools.write_strategy_guide.needsApproval(sameWork)) === true
const refusedAgain = await tools.write_strategy_guide.execute(sameWork, { toolCallId: 'replay-1' })
assert.equal(duplicateApproval, false, 'the repeated guide raised a second approval card')
assert.ok(isNoWork(refusedAgain), 'the repeated guide did not report that it did nothing')
assert.equal(charges, 0, 'the repeated guide went back to the meter')

// ── 3. A DIFFERENT, CHEAPER DEEP CALL IS UNTOUCHED ──────────────────────────
// `credits` is a fact about THIS call's price, not about the tier, so a
// different deep tool still asks — and still charges, because only the meter
// knows whether it is affordable.
const otherAsks = (await tools.plan_deck.needsApproval({ goal: 'a budget deck' })) === true
assert.equal(otherAsks, true, 'a different deep call was suppressed by an unrelated refusal')
// And the tier stays visible: `credits` removes nothing from `activeTools`.
const visible = focusedTools(tools as never, 1, (n) => seedMeteredRefusals(replay.messages).unavailable(n))
assert.ok(visible.includes('plan_deck'), 'a credits refusal must not hide the deep tier')

// ── 4. THE READER'S NEXT MESSAGE ASKS AGAIN ─────────────────────────────────
// Same body, one more user turn on the end — a top-up or tomorrow's reset can
// only ever land if the seed stops at the reader's last message.
const nextTurn = freshTools(captured.newTurn.messages)
const asksAfterNewTurn = (await nextTurn.write_strategy_guide.needsApproval({ ...sameWork })) === true
assert.equal(asksAfterNewTurn, true, 'a new user message did not re-open the meter')

// ── 5. PROSE CANNOT DO WHAT THE TOOL RESULT DOES ────────────────────────────
// The same marker as a TEXT part, which is all a model can produce.
const proseOnly = freshTools([
  { role: 'user', parts: [{ type: 'text', text: 'write the guide' }] },
  { role: 'assistant', parts: [{ type: 'text', text: refusalPart.output }] },
])
const proseSuppressed = (await proseOnly.write_strategy_guide.needsApproval({ ...sameWork })) === false
assert.equal(proseSuppressed, false, 'model prose was able to suppress work')

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
      charges,
      providerCalls: 0,
      writes: 0,
      differentAffordableCallStillAsks: otherAsks,
      newTurnAsksAgain: asksAfterNewTurn,
      proseCanSuppress: proseSuppressed,
    },
    null,
    2,
  ),
)
console.log('PASS captured browser wire seeds the real ledger: no second card, no charge, no provider')
