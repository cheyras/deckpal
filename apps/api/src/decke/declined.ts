/**
 * Not asking twice for something they already said no to.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE COMPLAINT, IN THE READER'S OWN WORDS
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * From the transcript record, three consecutive turns of one conversation:
 *
 *   seq 0  research_meta   ok         deck_strategy  DECLINED
 *   seq 1  research_meta   DECLINED   deck_strategy  DECLINED
 *   seq 2                             deck_strategy  DECLINED
 *
 *   "You asked to do meta research. I said no because you'd already done it.
 *    Then you asked to edit the strategy guide again. These were both not good
 *    behaviors. Saying this so Claude can improve the agentic experience by
 *    looking at these chat logs later."
 *
 * Across the whole corpus: `research_meta` declined 4 times, `deck_strategy`
 * declined 4 times. Every one of them a dialog the reader had to read and
 * dismiss for a thing they had already refused.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THIS IS NOT A PROMPT RULE, AND NOT A MISSING TOOL EITHER
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `focus.ts` already settled the first half: "with `danger` absent from
 * `activeTools`, a prompt begging the model to call it produced no call". A
 * request not to re-ask is a request; the reader has already been re-asked
 * three times while one was in force.
 *
 * But taking the tool AWAY for the rest of the conversation — the obvious
 * structural answer — is worse, for two reasons this file exists to avoid:
 *
 *   1. **"Go on then, do the research now" would produce nothing.** By
 *      `focus.ts`'s own measurement the tool is not merely discouraged, it is
 *      uncallable. A reader who changes their mind is stuck.
 *   2. **The system prompt still advertises it** (`dataToolSummary` is built
 *      with `include: () => true`), so he would offer a capability he no longer
 *      has — the exact "offer you cannot fulfil" the prompt calls worse than an
 *      honest no.
 *
 * So the tool stays callable, and what changes is the ANSWER: a call whose
 * (tool, arguments) match one already declined in this conversation is refused
 * HERE, without a dialog, with a sentence saying so. New arguments ask
 * normally. A changed mind still works, because the reader saying "yes, do it"
 * is a new user message and he will call it again — with the refusal in context
 * telling him what happened last time rather than a silence.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * A DECLINE IS NOT AN ABANDONMENT
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `approval.ts` sends `approved: false` for both "the reader declined" and
 * `ABANDONED_REASON` — "the reader did not answer", which is what a closed
 * panel or a turn they walked away from produces. Treating the second as a
 * refusal would silently disable a tool because somebody's phone locked.
 * Only an explicit decline counts.
 */

import { callKey } from './repeat.js'

/** `approval.ts`'s wording for a panel that was never answered. Not a refusal. */
const ABANDONED_REASON = 'the reader did not answer'

/**
 * Every (tool, arguments) the reader explicitly refused in this conversation.
 *
 * Read from the REPLAYED history, which is the only place it can come from: the
 * browser re-POSTs the whole conversation on every leg and the server keeps
 * nothing between requests.
 *
 * Scoped to the conversation rather than the turn on purpose. The measured
 * complaint spans three separate turns — a per-turn set would have caught none
 * of it.
 */
export function declinedCalls(messages: unknown): Set<string> {
  const out = new Set<string>()
  if (!Array.isArray(messages)) return out
  for (const m of messages) {
    const parts = m?.parts
    if (!Array.isArray(parts)) continue
    for (const p of parts) {
      if (!p || typeof p.type !== 'string' || !p.type.startsWith('tool-')) continue
      const a = p.approval
      if (!a || a.approved !== false) continue
      // An unanswered panel is not a refusal. See the header.
      if (typeof a.reason === 'string' && a.reason === ABANDONED_REASON) continue
      out.add(callKey(p.type.slice('tool-'.length), p.input ?? {}))
    }
  }
  return out
}

/**
 * What he is told instead of a second dialog.
 *
 * It names the tool and says the decision stands unless they say otherwise —
 * because the failure to avoid is not only re-asking, it is also treating a
 * refusal as a problem to solve. The prompt already says a refusal "is not a
 * problem to solve and not something to talk them out of"; this is that rule
 * with something behind it.
 */
export function alreadyDeclinedMessage(tool: string): string {
  return (
    `They already said no to this exact ${tool} call in this conversation, so it has not run ` +
    `and they have not been asked again. Nothing changed. Do not ask a third time and do not ` +
    `work around it — carry on with what they actually wanted, or say plainly that you cannot ` +
    `do this part without it. If they tell you to go ahead, call it again and it will ask.`
  )
}
