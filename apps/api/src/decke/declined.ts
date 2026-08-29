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
 * ══════════════════════════════════════════════════════════════════════════════
 * SUGGEST-ONCE ETIQUETTE — the two guide tools, declined by NAME
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The ledger above keys on (tool, args), so a REWORDED guide re-offer asks again
 * — the model changes the markdown, the callKey changes, and the reader is back
 * at a dialog they already dismissed. The owner: "ask maybe once, and if the
 * user seems uninterested, stop persistently asking."
 *
 * The two guide tools are `deck_strategy` (when it writes — the `markdown` shape)
 * and `write_strategy_guide` (the deep tool that calls it). They are the same
 * ACT — saving a strategy guide — performed at two different boundaries, and a
 * refusal of one is a refusal of the whole act. So a recorded decline of EITHER
 * suppresses further calls to BOTH, by name, for the rest of the conversation.
 *
 * "By name" is the change: every other tool keeps the exact (tool, args)
 * semantics above, and a read-only `deck_strategy` call (no `markdown`) is NOT
 * suppressed — only the write shape is.
 */
/** The two tools whose declines suppress each other, regardless of arguments. */
const GUIDE_TOOLS = new Set(['deck_strategy', 'write_strategy_guide'])

/**
 * The NUL that `callKey` uses as its separator — the one byte no tool name can
 * contain, so it is the safe split point between name and arguments.
 */
const KEY_SEP = '\u0000'

/**
 * Which guide tool a callKey names, if any.
 *
 * `callKey` is `${name}\u0000${stable(args)}`; only the name matters for the
 * name-level suppression, and the NUL is the only place to cut it.
 */
function guideName(key: string): string | null {
  const i = key.indexOf(KEY_SEP)
  if (i < 0) return null
  const name = key.slice(0, i)
  return GUIDE_TOOLS.has(name) ? name : null
}

/**
 * Is this callKey a WRITE-shape guide call — the one shape a guide decline
 * suppresses?
 *
 * `write_strategy_guide` is always a write. `deck_strategy` is a write only when
 * it carries `markdown` — "pass markdown to REPLACE the whole guide". A read
 * (no `markdown`) is a different question and is explicitly NOT suppressed.
 *
 * `stable` serialises objects with sorted JSON keys, so a write call's key
 * carries `"markdown":` — the one shape a real write takes. A deck_id whose
 * value happens to contain the word "markdown" serialises with the quotes
 * ESCAPED (`\"markdown\"`), so the un-escaped `"markdown":` only ever matches
 * the key, never the value.
 */
function isGuideWrite(key: string): boolean {
  const name = guideName(key)
  if (name === 'write_strategy_guide') return true
  if (name === 'deck_strategy') return key.includes('"markdown":')
  return false
}

/**
 * A decline set that ALSO suppresses by name for the two guide tools.
 *
 * `has` checks the exact (tool, args) key first — that path is unchanged for
 * every tool. Only when no exact match is found AND a guide write was declined
 * somewhere in this conversation does it suppress by name: a `write_strategy`
 * call of any shape, and a `deck_strategy` call of the write shape, are both
 * refused without a dialog.
 *
 * The `size` check in every caller (`declined.size > 0 && declined.has(...)`)
 * still reads the real entry count, so the short-circuit is honest: an empty set
 * means nothing was refused, guide or otherwise.
 */
class GuideDeclinedSet extends Set<string> {
  /** True when ANY guide-tool write was declined in this conversation. */
  private readonly guideDeclined: boolean

  constructor(entries: Iterable<string>) {
    super(entries)
    this.guideDeclined = [...this].some(isGuideWrite)
  }

  override has(key: string): boolean {
    if (super.has(key)) return true
    if (!this.guideDeclined) return false
    return isGuideWrite(key)
  }
}

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
 *
 * Returns a `GuideDeclinedSet` so the two guide tools are suppressed by name —
 * see the section header above. Every other tool keeps the exact (tool, args)
 * semantics the set's entries record.
 */
export function declinedCalls(messages: unknown): Set<string> {
  const out: string[] = []
  if (!Array.isArray(messages)) return new GuideDeclinedSet(out)
  for (const m of messages) {
    const parts = m?.parts
    if (!Array.isArray(parts)) continue
    for (const p of parts) {
      if (!p || typeof p.type !== 'string' || !p.type.startsWith('tool-')) continue
      const a = p.approval
      if (!a || a.approved !== false) continue
      // An unanswered panel is not a refusal. See the header.
      if (typeof a.reason === 'string' && a.reason === ABANDONED_REASON) continue
      out.push(callKey(p.type.slice('tool-'.length), p.input ?? {}))
    }
  }
  return new GuideDeclinedSet(out)
}

/**
 * What he is told instead of a second dialog.
 *
 * It names the tool and says the decision stands unless they say otherwise —
 * because the failure to avoid is not only re-asking, it is also treating a
 * refusal as a problem to solve. The prompt already says a refusal "is not a
 * problem to solve and not something to talk them out of"; this is that rule
 * with something behind it.
 *
 * For the two guide tools the message is guide-specific: a reworded guide
 * re-offer is the measured complaint, and "this exact deck_strategy call" is
 * wrong when what was declined was a different shape of the same act. The guide
 * message names the act — saving a strategy guide — and says the subject is
 * dropped unless the reader raises it themselves.
 */
export function alreadyDeclinedMessage(tool: string): string {
  if (GUIDE_TOOLS.has(tool)) return guideDeclinedMessage()
  return (
    `They already said no to this exact ${tool} call in this conversation, so it has not run ` +
    `and they have not been asked again. Nothing changed. Do not ask a third time and do not ` +
    `work around it — carry on with what they actually wanted, or say plainly that you cannot ` +
    `do this part without it. If they tell you to go ahead, call it again and it will ask.`
  )
}

/**
 * The guide-specific refusal: the same doctrine as `alreadyDeclinedMessage`,
 * worded for the act both guide tools perform.
 *
 * "This exact deck_strategy call" is wrong when the decline was a
 * `write_strategy_guide` call or a reworded `deck_strategy` write — the
 * whole point of the name-level suppression is that rewording is not a new
 * question. So this names the act, says the subject is dropped unless they
 * raise it, and forbids work-arounds, exactly as the doctrine requires.
 */
function guideDeclinedMessage(): string {
  return (
    `They already said no to saving a strategy guide in this conversation, so it has not run ` +
    `and they have not been asked again. Nothing changed — rewording the guide is not a new ` +
    `question. Drop the subject: unless they raise it themselves, do not propose another guide ` +
    `save, and do not work around it — carry on with what they actually wanted, or say plainly ` +
    `that you cannot do this part without it. If they tell you to go ahead, call it again and ` +
    `it will ask.`
  )
}
