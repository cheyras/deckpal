/**
 * ══════════════════════════════════════════════════════════════════════════════
 * THE APPROVAL ROUND TRIP — CAPTURE AND REPLAY, AS TWO PURE FUNCTIONS
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The server holds a write tool and emits `tool-approval-request`; the browser
 * asks the reader; the answer goes back by REPLAYING THE WHOLE TOOL CALL with
 * the verdict attached. This file is the two ends of that: what is captured off
 * the wire, and what is sent back.
 *
 * ── WHY THIS IS A FILE AND NOT TWO CLOSURES IN `useDeckeChat.ts` ─────────────
 *
 * Because this pair has now produced TWO shipped-class bugs, and the suite could
 * not see either one. The tests pinned the POLICY (which tools need consent) and
 * the SDK's hold (that `execute` genuinely does not run). The one thing nobody
 * could reach was the ANSWER travelling back, because it was built inside a
 * React hook that does its own `fetch` and its own `supabase.auth.getSession()`.
 * Nothing could drive it.
 *
 *   1. The first replay sent a bare `{type:'tool-approval-response', approvalId,
 *      approved}` — the obvious shape, and silently destroyed. `isToolUIPart` in
 *      ai@7.0.66 is `type.startsWith('tool-')`, so `convertToModelMessages` read
 *      that part as a call to a tool NAMED "approval-response" and emitted
 *      `{type:'tool-call', toolName:'approval-response'}` with no `toolCallId`
 *      at all. Measured against the pinned package, verbatim:
 *      `[{"type":"tool-call","toolName":"approval-response"}]`. The answer
 *      vanishes and the next leg dies in `standardizePrompt` with
 *      AI_InvalidPromptError.
 *   2. The capture read `approvalId`/`toolCallId`/name/input off the chunk and
 *      DROPPED `signature`. With `DECKE_APPROVAL_SECRET` set — it is, in both
 *      Production and Preview — `validateApprovedToolApprovals` throws
 *      `InvalidToolApprovalSignatureError: missing signature`, and EVERY
 *      approved write fails.
 *
 * Both have the same reader-facing shape: preview, "Go ahead", then "My brain
 * glitched on that one — try me again?", and NOTHING WRITTEN. Consent given,
 * nothing happened — the precise failure this whole control exists to prevent,
 * arriving through the control itself.
 *
 * A SEPARATE MODULE rather than exports on the hook, and that is load-bearing
 * rather than tidiness: `useDeckeChat.ts` imports `../../lib/supabase`, which
 * reads `import.meta.env` at module scope. Under `node --import tsx --test`
 * there is no Vite, `import.meta.env` is `undefined`, and merely importing the
 * hook throws `TypeError: Cannot read properties of undefined (reading
 * 'VITE_SUPABASE_URL')` before a single test runs. So "export them from the
 * hook" is not a smaller version of this change; it is a version of this change
 * that leaves the code exactly as untestable as it was when it shipped both
 * bugs. `__tests__/approval.test.ts` drives these two functions directly, and
 * drives their output through the REAL `convertToModelMessages`.
 *
 * `PendingApproval` is re-exported from `useDeckeChat.ts` so its existing
 * import path (`DeckeChat.tsx`) is unchanged.
 */

/**
 * A tool call the reader has to authorise before it runs.
 *
 * The SDK holds the call and emits `tool-approval-request`; nothing executes
 * until an approval goes back. That is a real control rather than a prompt
 * instruction — the tool's `execute` is genuinely not invoked.
 */
export type PendingApproval = {
  approvalId: string
  toolCallId: string
  /** The tool's own title, once its `tool-input-available` chunk arrives. */
  title: string
  name: string
  /**
   * The arguments the call was made with.
   *
   * NOT decoration. Answering an approval means REPLAYING THE WHOLE TOOL CALL
   * with the answer attached — see `approvalReplayPart`. Without the input the
   * replayed part is not a valid tool call and the SDK cannot resume it.
   */
  input: Record<string, unknown>
  /**
   * The server's HMAC over this approval, when `DECKE_APPROVAL_SECRET` is set.
   *
   * MUST BE REPLAYED. With a secret configured the SDK verifies the signature
   * on the way back and throws `InvalidToolApprovalSignatureError: missing
   * signature` if it is absent — so dropping it does not weaken the check, it
   * BREAKS EVERY APPROVED WRITE. The reader consents, the turn errors, nothing
   * is written: the precise failure this control exists to prevent, caused by
   * turning the control on.
   *
   * Undefined when no secret is set, and omitted from the replay in that case
   * rather than sent as `undefined`.
   */
  signature?: string
}

/**
 * The `tool-approval-request` chunk, as much of it as this end reads.
 *
 * `toolCallId` and `signature` are typed `unknown` on purpose: this is parsed
 * JSON off a network stream, and the narrowing belongs in the function that
 * decides what to do when they are the wrong shape, not in a type assertion at
 * the parse site that would be a claim nobody checked.
 */
export type ApprovalRequestChunk = {
  approvalId: string
  toolCallId?: unknown
  signature?: unknown
}

/**
 * Build the pending approval from the `tool-approval-request` chunk.
 *
 * The chunk carries only ids — `approvalId`, `toolCallId`, and `signature` when
 * the deployment signs approvals (`ai/dist/index.js:7704-7712`, where the
 * signature is spread in only `...part.signature != null ? {...} : {}`, so its
 * ABSENCE is normal and indistinguishable from a reader that forgot to look for
 * it). Everything a human needs to judge the call, and everything the SDK needs
 * to resume it, arrived EARLIER on that call's `tool-input-available` chunk,
 * which is what the three maps hold.
 *
 * The fallbacks are not decoration. `'that change'` / `'Make that change'` is
 * what the reader is asked to authorise if the input chunk never arrived, and
 * an empty `input` is what the SDK is handed. Neither is good; both beat asking
 * someone to permit `call_a7f3`.
 */
export function pendingApprovalFromChunk(
  part: ApprovalRequestChunk,
  approvalNames: Map<string, string>,
  approvalTitles: Map<string, string>,
  approvalInputs: Map<string, Record<string, unknown>>,
): PendingApproval {
  return {
    approvalId: part.approvalId,
    toolCallId: String(part.toolCallId ?? ''),
    name: approvalNames.get(String(part.toolCallId ?? '')) ?? 'that change',
    title: approvalTitles.get(String(part.toolCallId ?? '')) ?? 'Make that change',
    input: approvalInputs.get(String(part.toolCallId ?? '')) ?? {},
    // Present only when the deployment signs approvals. See the field's
    // comment — dropping it breaks every write the moment signing is on.
    ...(typeof part.signature === 'string' ? { signature: part.signature } : {}),
  }
}

/** The replayed tool call, with the verdict attached. */
export type ApprovalReplayPart = {
  type: string
  toolCallId: string
  input: Record<string, unknown>
  state: 'approval-responded'
  approval: { id: string; approved: boolean; signature?: string; reason?: string }
}

/**
 * ── REPLAY THE WHOLE CALL, WITH THE ANSWER ATTACHED ─────────────────────────
 *
 * NOT a bare `{type:'tool-approval-response', approvalId, approved}`. See bug 1
 * in this file's header: that shape is read as a call to a tool named
 * "approval-response", the answer vanishes, and the next leg dies in
 * `standardizePrompt` with AI_InvalidPromptError.
 *
 * The SDK resumes statelessly, so it needs the call RECONSTRUCTED: the tool's
 * own `tool-<name>` type, its `toolCallId`, its original `input`, and the
 * verdict in `approval`. That converts to tool-call + tool-approval-request +
 * tool-approval-response, which is exactly what `collectToolApprovals` reads.
 */
export function approvalReplayPart(a: PendingApproval, approved: boolean): ApprovalReplayPart {
  return {
    type: `tool-${a.name}`,
    toolCallId: a.toolCallId,
    input: a.input,
    state: 'approval-responded',
    approval: {
      id: a.approvalId,
      approved,
      // `convertToModelMessages` reads the signature from HERE —
      // `part.approval.signature` at `ai/dist/index.js:10906-10913` — and
      // nowhere else. OMITTED rather than sent as `undefined` when there is
      // none: the two serialise identically over JSON and are different object
      // shapes everywhere before that, and this codebase has already been bitten
      // once by treating a field that is absent as the same thing as a field
      // that is present and empty.
      ...(a.signature ? { signature: a.signature } : {}),
      // A DENIAL IS AN ANSWER, not a silence. Sending it lets him say "alright,
      // left it alone" rather than stopping mid-turn with no explanation, which
      // reads as a crash.
      ...(approved ? {} : { reason: 'the reader declined' }),
    },
  }
}

/**
 * How many times he may hand the browser work and come back for more, per turn.
 *
 * NOT `stopWhen`. A client tool has no server `execute`, so it ENDS the server
 * turn (`finishReason: "tool-calls"`); the loop is stream closes → browser runs
 * tools → browser POSTs a follow-up. Raising the server's step budget does
 * nothing for this; only this constant does.
 *
 * Four, because a real journey is: navigate → (page settles) → fly to the row →
 * click it → say what he found. Each leg is a FULL request re-billing the entire
 * prompt and history, so this is a spend ceiling as much as a loop guard.
 *
 * It lives HERE, beside the two functions that reason about it, so the rule and
 * its tests cannot drift from the loop that enforces them — which they had, and
 * which review caught: the loop re-implemented `MAX_LEGS + approvalReplays`
 * inline while the tests pinned a hand-copied constant of their own. Two copies
 * of a rule agree until the day they do not.
 */
export const MAX_LEGS = 4

/**
 * Extra legs reserved for POSTing an answered approval, on top of `MAX_LEGS`.
 * See `mayAskApproval` for why the reserve exists and why it is two.
 */
export const MAX_APPROVAL_REPLAYS = 2

/**
 * How many legs the turn may spend, given how many answered approvals it has
 * committed to carrying.
 *
 * Split out of `useDeckeChat`'s loop so the rule can be TESTED. The loop itself
 * cannot be — the hook imports `lib/supabase`, which reads `import.meta.env` at
 * module scope, so `node --test` cannot even import the file. That is the same
 * barrier that kept the two earlier approval bugs invisible, and it is why the
 * pure halves keep moving into this module rather than staying where they are
 * used.
 */
export function legBudget(approvalReplays: number, maxLegs: number = MAX_LEGS): number {
  return maxLegs + approvalReplays
}

/**
 * May the turn put an approval dialog in front of the reader right now?
 *
 * THE QUESTION IS WHETHER THE ANSWER CAN BE DELIVERED, not whether there is
 * room to ask. Asking and then discarding the reply is strictly worse than not
 * asking: the reader has consented, believes the change was made, and nothing
 * on screen says otherwise. That is exactly what happened before this guard
 * existed — on the final leg the answer was collected, pushed onto the wire,
 * and dropped when the loop ended without POSTing.
 *
 * `mayAskApproval` is therefore consulted BEFORE the dialog opens, and the leg
 * that will carry the answer is granted by `legBudget` at the moment the answer
 * is taken. The two are one rule in two halves, and `approvalAlwaysDeliverable`
 * in the tests is the statement that they agree.
 */
export function mayAskApproval(
  approvalReplays: number,
  maxApprovalReplays: number = MAX_APPROVAL_REPLAYS,
): boolean {
  return approvalReplays < maxApprovalReplays
}
