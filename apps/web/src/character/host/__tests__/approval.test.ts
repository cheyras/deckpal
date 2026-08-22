/**
 * The approval round trip, driven end to end.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * Two bugs shipped in the browser's half of the tool-approval handshake, and
 * the suite was green for both. Not because the tests were bad — they pinned
 * the POLICY (which tools need consent, in `apps/api`) and the SDK's hold (that
 * a held tool's `execute` really does not run). What nobody could reach was the
 * ANSWER travelling back, because it was built inside a React hook that does
 * its own `fetch` and its own `supabase.auth.getSession()`. There was no way to
 * call it.
 *
 *   1. The reply was a bare `{type:'tool-approval-response', approvalId,
 *      approved}`. `isToolUIPart` in ai@7.0.66 is `type.startsWith('tool-')`,
 *      so `convertToModelMessages` read it as a call to a tool NAMED
 *      "approval-response", and the next leg died in `standardizePrompt` with
 *      AI_InvalidPromptError.
 *   2. The capture kept approvalId/toolCallId/name/input and DROPPED
 *      `signature`. With `DECKE_APPROVAL_SECRET` set — it is, in Production and
 *      Preview — `validateApprovedToolApprovals` throws
 *      `InvalidToolApprovalSignatureError: missing signature`, and every
 *      approved write fails.
 *
 * Both looked identical to the reader: preview, "Go ahead", "My brain glitched
 * on that one — try me again?", nothing written.
 *
 * ── WHY THE REAL SDK, NOT A STUB ────────────────────────────────────────────
 *
 * `ai@7.0.66` is a dependency of the repo ROOT, so Node resolves it from
 * `apps/web` by walking up to `node_modules/ai` — verified, and the last test
 * below imports the genuine `convertToModelMessages` rather than describing it.
 * That matters more than usual here: both bugs were bugs about what THAT
 * FUNCTION does with a shape, and a stub would have agreed with whatever the
 * author believed. The first bug in particular had been reviewed, reasoned
 * about, and committed by someone who was sure it was right.
 *
 * The shapes asserted below were read out of the pinned package, not inferred:
 *   • `ai/dist/index.js:7704-7712` — the `tool-approval-request` CHUNK carries
 *     `...part.signature != null ? { signature: part.signature } : {}`.
 *   • `ai/dist/index.js:10906-10913` — `convertToModelMessages` reads the
 *     signature from `part.approval.signature`, and nowhere else.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { convertToModelMessages } from 'ai'
import { approvalReplayPart, legBudget, mayAskApproval, pendingApprovalFromChunk, type PendingApproval } from '../approval'

/** The three per-leg lookups, filled from a `tool-input-available` chunk. */
function lookups(toolCallId: string, name: string, input: Record<string, unknown>) {
  return {
    names: new Map([[toolCallId, name]]),
    titles: new Map([[toolCallId, 'Log cards']]),
    inputs: new Map([[toolCallId, input]]),
  }
}

/** A captured approval for `log_cards`, signed, as the live deployment sends it. */
function captureSigned(): PendingApproval {
  const l = lookups('call_a7f3', 'log_cards', { cards: ['sv1-1'], qty: 2 })
  return pendingApprovalFromChunk(
    { approvalId: 'apr_1', toolCallId: 'call_a7f3', signature: 'sig_deadbeef' },
    l.names,
    l.titles,
    l.inputs,
  )
}

test('a signed approval round-trips: the signature survives capture and replay', () => {
  // BUG 2. The chunk is the only place the signature is ever offered, and the
  // replay is the only place the SDK ever looks for it. If either end drops it,
  // every approved write fails with `InvalidToolApprovalSignatureError` the
  // moment `DECKE_APPROVAL_SECRET` is set — which it now is.
  const a = captureSigned()
  assert.equal(a.signature, 'sig_deadbeef')

  const part = approvalReplayPart(a, true)
  assert.equal(part.approval.signature, 'sig_deadbeef')
})

test('an unsigned approval replays with no `signature` KEY, not `signature: undefined`', () => {
  // The distinction is invisible over JSON — `JSON.stringify` drops an explicit
  // `undefined` — and visible everywhere before that: `'signature' in x`,
  // `Object.keys`, `deepEqual`, and any `!= null` guard reading the object
  // directly. The SDK's own emitter makes the same distinction on the way out
  // (`ai/dist/index.js:7704-7712` spreads the key in only when it is non-null),
  // so the reply mirrors it rather than inventing a third state.
  const l = lookups('call_a7f3', 'log_cards', { cards: ['sv1-1'] })
  const a = pendingApprovalFromChunk(
    { approvalId: 'apr_1', toolCallId: 'call_a7f3' },
    l.names,
    l.titles,
    l.inputs,
  )
  assert.equal('signature' in a, false)

  const part = approvalReplayPart(a, true)
  assert.equal('signature' in part.approval, false)
  assert.deepEqual(Object.keys(part.approval), ['id', 'approved'])
})

test('a non-string signature on the wire is not carried through as one', () => {
  // Parsed JSON off a network stream. `typeof === 'string'` is the guard, so a
  // null, a number or an object is treated as "no signature" rather than
  // forwarded into an HMAC comparison as whatever it happens to be.
  const l = lookups('c1', 'log_cards', {})
  for (const signature of [null, 42, { sig: 'x' }, undefined]) {
    const a = pendingApprovalFromChunk(
      { approvalId: 'apr_1', toolCallId: 'c1', signature },
      l.names,
      l.titles,
      l.inputs,
    )
    assert.equal('signature' in a, false, `signature ${JSON.stringify(signature)} leaked through`)
  }
})

test('the replay is the whole tool call, not a bare approval-response', () => {
  // BUG 1, pinned at the shape level. `type` must be the TOOL's own
  // `tool-<name>`; `toolCallId` and the original `input` must both be present,
  // because the SDK resumes statelessly and reconstructs the call from exactly
  // these fields.
  const part = approvalReplayPart(captureSigned(), true)

  assert.equal(part.type, 'tool-log_cards')
  assert.equal(part.toolCallId, 'call_a7f3')
  assert.deepEqual(part.input, { cards: ['sv1-1'], qty: 2 })
  assert.equal(part.state, 'approval-responded')
  assert.equal(part.approval.id, 'apr_1')
  assert.equal(part.approval.approved, true)
  // The shape that broke it: nothing may be typed `tool-approval-response`,
  // and the verdict may not be a sibling of `type` instead of living under
  // `approval`.
  assert.notEqual(part.type, 'tool-approval-response')
  assert.equal('approved' in part, false)
})

test('an approval carries no `reason`; a denial carries one', () => {
  // A DENIAL IS AN ANSWER, not a silence — the reason is what lets him say
  // "alright, left it alone" rather than stopping mid-turn, which reads as a
  // crash. And `reason` on an APPROVAL would be a sentence nobody said.
  const a = captureSigned()

  const yes = approvalReplayPart(a, true)
  assert.equal(yes.approval.approved, true)
  assert.equal('reason' in yes.approval, false)

  const no = approvalReplayPart(a, false)
  assert.equal(no.approval.approved, false)
  assert.equal(no.approval.reason, 'the reader declined')
  // The signature is replayed on a DENIAL too. The SDK validates the approval
  // either way; an unsigned "no" fails the same check an unsigned "yes" does,
  // and the reader's decline would surface as the same "brain glitched".
  assert.equal(no.approval.signature, 'sig_deadbeef')
})

test('the lookups fall back when the tool-input-available chunk never arrived', () => {
  // The approval request carries only ids. Everything legible about the call
  // arrived earlier, on a different chunk — so this is the state the reader is
  // left in if that chunk was missed: a generic name, a generic title, and an
  // empty input. None of it is good; all of it beats being asked to authorise
  // `call_a7f3`, and none of it may be `undefined`, which would render as the
  // word "undefined" in a consent prompt.
  const a = pendingApprovalFromChunk(
    { approvalId: 'apr_1', toolCallId: 'call_unseen' },
    new Map(),
    new Map(),
    new Map(),
  )
  assert.equal(a.name, 'that change')
  assert.equal(a.title, 'Make that change')
  assert.deepEqual(a.input, {})
  assert.equal(a.toolCallId, 'call_unseen')
  assert.equal(a.approvalId, 'apr_1')
})

test('a missing toolCallId becomes the empty string, never the string "undefined"', () => {
  // `String(undefined)` is `'undefined'`, which would then be sent back as a
  // tool call id the server has never heard of — a plausible-looking id is
  // worse than an obviously empty one.
  const a = pendingApprovalFromChunk({ approvalId: 'apr_1' }, new Map(), new Map(), new Map())
  assert.equal(a.toolCallId, '')
  assert.equal(approvalReplayPart(a, true).toolCallId, '')
})

// ── THE END-TO-END PROOF ─────────────────────────────────────────────────────
//
// The real `convertToModelMessages`, from the pinned `ai@7.0.66`. Everything
// above pins the shape this code MEANS to produce; only this pins what the SDK
// does with it, which is the thing both bugs were actually about.

test('the real convertToModelMessages resumes the call with signature intact', async () => {
  const part = approvalReplayPart(captureSigned(), true)
  const model = await convertToModelMessages([
    { role: 'user', parts: [{ type: 'text', text: 'log my two Bulbasaurs' }] },
    // `as any` because the SDK's `UIMessagePart` union is generated from a tool
    // registry this app does not have, and `tool-log_cards` is not one of its
    // members. The RUNTIME shape is what is under test — a cast that made the
    // types agree would be testing the cast.
    { role: 'assistant', parts: [part] as never },
  ])

  const assistant = model.find((m) => m.role === 'assistant')
  assert.ok(assistant, 'the replayed part produced no assistant message at all')
  const content = assistant.content as Array<Record<string, unknown>>

  // 1. A real tool call, under its real name. This is bug 1: with the bare
  //    `tool-approval-response` shape the SDK emitted
  //    `{"type":"tool-call","toolName":"approval-response"}` — measured, no
  //    `toolCallId` at all — and `standardizePrompt` rejected the next leg.
  const call = content.find((c) => c.type === 'tool-call')
  assert.ok(call, 'no tool-call in the assistant message')
  assert.equal(call.toolName, 'log_cards')
  assert.equal(call.toolCallId, 'call_a7f3')
  assert.deepEqual(call.input, { cards: ['sv1-1'], qty: 2 })

  // 2. The approval request, rebuilt WITH the signature. This is bug 2:
  //    `ai/dist/index.js:10906-10913` reads `part.approval.signature` and
  //    nowhere else, so a replay that dropped it produced this same part with
  //    the key missing and `validateApprovedToolApprovals` threw.
  const request = content.find((c) => c.type === 'tool-approval-request')
  assert.ok(request, 'no tool-approval-request — the SDK cannot match the verdict to a call')
  assert.equal(request.approvalId, 'apr_1')
  assert.equal(request.toolCallId, 'call_a7f3')
  assert.equal(request.signature, 'sig_deadbeef')

  // 3. The verdict itself, on the tool message.
  const tool = model.find((m) => m.role === 'tool')
  assert.ok(tool, 'no tool message carrying the response')
  const response = (tool.content as Array<Record<string, unknown>>).find(
    (c) => c.type === 'tool-approval-response',
  )
  assert.ok(response, 'no tool-approval-response — consent was given and never delivered')
  assert.equal(response.approvalId, 'apr_1')
  assert.equal(response.approved, true)
})

test('the real convertToModelMessages carries a denial through as a denial', async () => {
  const part = approvalReplayPart(captureSigned(), false)
  const model = await convertToModelMessages([
    { role: 'user', parts: [{ type: 'text', text: 'log my two Bulbasaurs' }] },
    // See the cast note in the test above.
    { role: 'assistant', parts: [part] as never },
  ])

  const tool = model.find((m) => m.role === 'tool')
  assert.ok(tool)
  const content = tool.content as Array<Record<string, unknown>>

  const response = content.find((c) => c.type === 'tool-approval-response')
  assert.ok(response)
  assert.equal(response.approved, false)
  assert.equal(response.reason, 'the reader declined')

  // The SDK also synthesises the tool RESULT for the call that will now never
  // run, so the model sees a closed loop rather than a dangling tool_use —
  // which some providers reject outright. That only happens because the replay
  // carries `state: 'approval-responded'`.
  const result = content.find((c) => c.type === 'tool-result')
  assert.ok(result, 'a denied call left a dangling tool_use with no result')
  assert.equal(result.toolCallId, 'call_a7f3')
  assert.deepEqual(result.output, { type: 'execution-denied', reason: 'the reader declined' })
})

test('the shape bug 1 shipped is still exactly as broken as recorded', async () => {
  // A GUARD AGAINST THE COMMENTS GOING STALE. The reason the replay looks the
  // way it does is that the obvious alternative is silently destroyed by this
  // package. If a future `ai` upgrade ever makes the bare shape work, this test
  // fails and somebody re-reads why the long comment in `approval.ts` is there
  // — rather than the codebase carrying an explanation that stopped being true.
  const model = await convertToModelMessages([
    { role: 'user', parts: [{ type: 'text', text: 'go' }] },
    {
      role: 'assistant',
      // Deliberately the WRONG shape; that is the point of this test.
      parts: [{ type: 'tool-approval-response', approvalId: 'apr_1', approved: true }] as never,
    },
  ])

  const assistant = model.find((m) => m.role === 'assistant')
  assert.ok(assistant)
  const content = assistant.content as Array<Record<string, unknown>>
  const call = content.find((c) => c.type === 'tool-call')
  assert.ok(call, 'the bare shape no longer produces a tool-call — re-read approval.ts')
  assert.equal(
    call.toolName,
    'approval-response',
    'ai@7.0.66 read the bare part as a tool named "approval-response"; if it no longer does, ' +
      'the reasoning recorded in approval.ts needs revisiting',
  )
  assert.equal(call.toolCallId, undefined, 'the bare shape carried no toolCallId — that was the bug')
  assert.equal(
    model.some((m) => m.role === 'tool'),
    false,
    'the bare shape produced no approval response at all — consent given, nothing delivered',
  )
})

// ─── The leg budget: never ask what you cannot answer ────────────────────────
//
// The third bug in this round trip, and the same one as the other two wearing
// different clothes. On the last allowed leg the approvals branch asked the
// reader, took "Go ahead", pushed the replay onto the wire — and then
// `continue` ended the loop instead of reaching the POST. No text, no error,
// no write. The reader cannot tell that apart from a write that worked.

test('an approval that may be asked always has a leg left to carry the answer', () => {
  // THE INVARIANT, stated over every state the loop can reach rather than the
  // one the old code happened to be tested on. `leg` is the index about to run;
  // committing to a replay increments `approvalReplays`, which must buy a leg
  // that the loop's own bound then admits.
  const MAX_LEGS = 4
  const MAX_APPROVAL_REPLAYS = 2
  for (let replays = 0; replays <= MAX_APPROVAL_REPLAYS + 1; replays++) {
    for (let leg = 0; leg < legBudget(MAX_LEGS, replays); leg++) {
      if (!mayAskApproval(replays, MAX_APPROVAL_REPLAYS)) continue
      // The ask is permitted, so the answer is taken and one replay committed.
      const after = replays + 1
      assert.ok(
        leg + 1 < legBudget(MAX_LEGS, after),
        `asked on leg ${leg} with ${replays} replay(s) spent, but the budget ` +
          `${legBudget(MAX_LEGS, after)} leaves no leg to POST the answer`,
      )
    }
  }
})

test('the ask is refused once the replay budget is spent, rather than dropped after', () => {
  // The other half. When the answer CANNOT be delivered the dialog must not
  // open at all — the reader is told nothing changed, which is a nuisance, not
  // a broken promise.
  assert.equal(mayAskApproval(0, 2), true)
  assert.equal(mayAskApproval(1, 2), true)
  assert.equal(mayAskApproval(2, 2), false)
  assert.equal(mayAskApproval(3, 2), false)
})

test('a reserved approval leg is not a free extra step for ordinary work', () => {
  // The budget grows ONLY for answers. A turn that never hits an approval gets
  // exactly MAX_LEGS, so this cannot become a quiet raise of the spend ceiling.
  assert.equal(legBudget(4, 0), 4)
  assert.equal(legBudget(4, 1), 5)
  assert.equal(legBudget(4, 2), 6)
})
