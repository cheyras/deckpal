/**
 * The conversation a follow-up model leg (the audit's corrective leg, the
 * pasted-log backstop) continues from: the request's prepared messages, then
 * EVERYTHING the finished leg added — including what ai@7 produced before its
 * first step.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE DEFECT (present on main since the corrective leg existed)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * On a leg that resumes an approval, ai@7 executes the approved call BEFORE step
 * 0 and keeps its tool result in the result's "initial response messages" —
 * outside `steps`. The follow-up was built from
 * `steps.flatMap((step) => step.response.messages)`, so it carried the approved
 * call (in the prepared messages) with no result. The SDK lets that through
 * (approved ids are excluded from its missing-result check), and the provider
 * then receives a `tool_use` with no `tool_result`.
 *
 * `StreamTextResult.responseMessages` is the SDK's own accumulation: initial
 * response messages, then every step's (`ai/dist/index.js`, `get
 * responseMessages()`). It is used instead of rebuilding it here. Nothing runs
 * twice: the SDK re-executes approvals only from the LAST message, and the last
 * message is now the leg's own output, not the approval answer.
 */
export async function followUpMessages<M>(
  prepared: readonly M[],
  finished: { responseMessages: PromiseLike<readonly M[]> },
): Promise<M[]> {
  return [...prepared, ...(await finished.responseMessages)];
}
