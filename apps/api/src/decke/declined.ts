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
import { NO_WORK } from './deepOutcome.js'

/** `approval.ts`'s wording for a panel that was never answered. Not a refusal. */
const ABANDONED_REASON = 'the reader did not answer'

/**
 * The deep tier's "nothing happened" tail, replicated here because
 * `deepOutcome.ts` keeps it module-private (it is not in this pass's ownership).
 *
 * A declined guide or research call is the SAME class of non-result as a
 * refused `plan_deck`: the tool did not run, and a polite first-person sentence
 * is the easiest thing in the world to continue from as though it had. Leading
 * with `[[NO_WORK]]` and ending with this discipline means the model cannot
 * narrate a refused guide or research call as work that happened — see
 * `deepOutcome.ts` for the incident that marker exists to prevent.
 */
const NO_WORK_TAIL =
  'There is NO result. Do not describe, summarise, continue from or refer to ' +
  'work that did not happen. Do not say "let\'s build", do not list cards, do not ' +
  'give counts. Say plainly that it did not happen and why, and stop.'

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * A CHANGED MIND IS THE READER'S SENTENCE — the bypass the name-level lie hid
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The name-level suppression is IRREVERSIBLE for the conversation: the same
 * predicate that refused the first reworded guide save refuses the second, so
 * "call it again and it will ask" was provably false — a refusal the message
 * itself promised would not happen. The one fact the model cannot fake is the
 * reader's own sentence, and `printingSaid.ts` already built the witness for it:
 * reduce a sentence to padded lowercase tokens and match a fixed vocabulary on
 * its boundaries. The same shape is reused here, so a reader who actually
 * raises the subject again — "yes, write up the strategy guide" — re-opens the
 * guide family, and "look it up, the current meta lists" re-opens research.
 *
 * The BYPASS is name-level only: an exact (tool, args) decline still suppresses
 * the exact call (the reader declined THAT call), and the approval dialog is
 * the real check on a re-opened reworded call — a wrong bypass just shows a
 * dialog the reader dismisses again, which is the safe failure direction.
 */
const tokens = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `

/** Words that re-open the guide family, pre-normalised once like `printingSaid`'s NEEDLES. */
const GUIDE_NEEDLES = ['guide', 'strategy', 'write it up', 'save it'].map(tokens)

/** Words that re-open the research_meta family, pre-normalised once. */
const RESEARCH_NEEDLES = ['research', 'meta', 'look it up', 'current lists'].map(tokens)

/** Did the reader's own latest message name this family? Mirrors `readerNamedPrinting`. */
const readerMentions = (text: unknown, needles: readonly string[]): boolean => {
  if (typeof text !== 'string' || !text.trim()) return false
  const hay = tokens(text)
  return needles.some((n) => hay.includes(n))
}

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
 * The deep tool whose decline suppresses further calls of the same name,
 * regardless of arguments — the same name-level suppression as the guide pair,
 * keyed to research_meta alone.
 *
 * A research_meta decline must NOT suppress guides, and a guide decline must NOT
 * suppress research_meta: the two are independent. The measured complaint —
 * "You asked to do meta research. I said no because you'd already done it" —
 * is a reworded research_meta re-ask, which the (tool, args) ledger above does
 * not catch.
 */
const RESEARCH_TOOL = 'research_meta'

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
 * Is this callKey a research_meta call — any shape, any arguments?
 *
 * Same NUL cut as `guideName`, but keyed to research_meta alone: the name-level
 * suppression for research_meta does not distinguish write from read — a
 * declined research_meta suppresses further research_meta calls of ANY shape,
 * because the measured complaint was a reworded re-ask.
 */
function isResearchMeta(key: string): boolean {
  const i = key.indexOf(KEY_SEP)
  return i >= 0 && key.slice(0, i) === RESEARCH_TOOL
}

/**
 * A decline set that ALSO suppresses by name for the two guide tools, and for
 * research_meta.
 *
 * `has` checks the exact (tool, args) key first — that path is unchanged for
 * every tool. Only when no exact match is found does it suppress by name:
 *   - a guide write was declined somewhere in this conversation → a
 *     `write_strategy_guide` call of any shape, and a `deck_strategy` call of
 *     the write shape, are both refused without a dialog.
 *   - a research_meta call was declined somewhere in this conversation → any
 *     further research_meta call, any shape, is refused without a dialog.
 * The two are independent: a guide decline does not suppress research_meta, and
 * a research_meta decline does not suppress guides.
 *
 * The `size` check in every caller (`declined.size > 0 && declined.has(...)`)
 * still reads the real entry count, so the short-circuit is honest: an empty set
 * means nothing was refused, guide, research or otherwise.
 */
class GuideDeclinedSet extends Set<string> {
  /** True when ANY guide-tool write was declined in this conversation. */
  private readonly guideDeclined: boolean
  /** True when ANY research_meta call was declined in this conversation. */
  private readonly researchDeclined: boolean
  /**
   * True when the reader's OWN latest message re-opens the guide family — so a
   * reworded guide save asks again rather than being refused without a dialog.
   * Name-level only; an exact (tool, args) decline still suppresses the exact
   * call.
   */
  private readonly guideReopened: boolean
  /** Same, for the research_meta family. */
  private readonly researchReopened: boolean

  constructor(entries: Iterable<string>, latestUserText?: string) {
    super(entries)
    this.guideDeclined = [...this].some(isGuideWrite)
    this.researchDeclined = [...this].some(isResearchMeta)
    this.guideReopened = readerMentions(latestUserText, GUIDE_NEEDLES)
    this.researchReopened = readerMentions(latestUserText, RESEARCH_NEEDLES)
  }

  override has(key: string): boolean {
    if (super.has(key)) return true
    // Name-level only; the bypass re-opens the family, never the exact call.
    if (this.guideDeclined && isGuideWrite(key) && !this.guideReopened) return true
    if (this.researchDeclined && isResearchMeta(key) && !this.researchReopened) return true
    return false
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
 *
 * `latestUserText` is the reader's OWN latest message (chat.mjs threads it via
 * its `latestUserText(messages)` helper). It is the one fact the model cannot
 * fake, and it is what re-opens a name-level family the reader raises again —
 * see the bypass section above. Absent or unmatching, the name-level
 * suppression stands for the conversation.
 */
export function declinedCalls(messages: unknown, latestUserText?: string): Set<string> {
  const out: string[] = []
  if (!Array.isArray(messages)) return new GuideDeclinedSet(out, latestUserText)
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
  return new GuideDeclinedSet(out, latestUserText)
}

/**
 * Did research (or a card read) actually run in this conversation?
 *
 * The no_research evidence bar on the guide card is findings-length theatre
 * without this: a guide can be backed by research the reader never ran, because
 * `findings` content is the model's own text and unverifiable. This scans the
 * replayed history the same way `declinedCalls` scans for declines — a
 * `tool-research_meta` or `tool-get_card` part that ran to a result, whether the
 * reader approved it (`approval.approved === true`, the approval-gated path) or
 * it returned a read result (`state: 'output-available'`, the read path).
 *
 * What this CANNOT verify, and the residual the bar now documents: that the
 * `findings` TEXT the model passes matches what research actually returned.
 * Provenance of the call is verifiable from history; content of the text is
 * not. The card now fires when findings is trivial OR this returns false, so a
 * guide is "backed by research" only when research genuinely ran AND the
 * findings are non-trivial.
 */
export function researchRanInConversation(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false
  for (const m of messages) {
    const parts = m?.parts
    if (!Array.isArray(parts)) continue
    for (const p of parts) {
      if (!p || typeof p.type !== 'string' || !p.type.startsWith('tool-')) continue
      const name = p.type.slice('tool-'.length)
      if (name !== RESEARCH_TOOL && name !== 'get_card') continue
      const a = p.approval
      if (a && a.approved === true) return true
      if (p.state === 'output-available') return true
    }
  }
  return false
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
 *
 * For research_meta the message is research-specific: a reworded research_meta
 * re-ask is the other half of the same measured complaint, and "this exact
 * research_meta call" is wrong when the query was reworded. The research message
 * names the act — meta research — and says the same.
 *
 * TRUTHFUL, AND MARKED: the name-level decline is irreversible for the
 * conversation — the same predicate that refused the first reworded call
 * refuses the next — so the message never promises a bare re-call will ask.
 * Only the reader raising it themselves (the `latestUserText` bypass) brings a
 * reworded call back to a dialog. Every message leads with `[[NO_WORK]]` and
 * ends with the deep tier's discipline tail, so a refused guide or research
 * call cannot be narrated as work that happened.
 */
export function alreadyDeclinedMessage(tool: string): string {
  if (GUIDE_TOOLS.has(tool)) return guideDeclinedMessage()
  if (tool === RESEARCH_TOOL) return researchDeclinedMessage()
  return exactDeclinedMessage(tool)
}

/**
 * The exact (tool, args) refusal: the one shape that IS reversible by different
 * arguments, so it says so plainly. Still marked and tailed — a bare re-call with
 * the same arguments will not ask; only different arguments bring a dialog back.
 */
function exactDeclinedMessage(tool: string): string {
  return (
    `${NO_WORK} REFUSED — they already said no to this exact ${tool} call in this conversation, so it has not run ` +
    `and they have not been asked again. Nothing changed. Do not ask a third time and do not ` +
    `work around it — carry on with what they actually wanted, or say plainly that you cannot ` +
    `do this part without it. Calling it again with the same arguments will not ask; only ` +
    `different arguments bring a dialog back. ${NO_WORK_TAIL}`
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
    `${NO_WORK} REFUSED — they already said no to saving a strategy guide in this conversation, so it has not run ` +
    `and they have not been asked again. Nothing changed — rewording the guide is not a new ` +
    `question. Drop the subject: unless they raise it themselves, do not propose another guide ` +
    `save, and do not work around it — carry on with what they actually wanted, or say plainly ` +
    `that you cannot do this part without it. Only the reader raising saving a strategy guide ` +
    `themselves brings the dialog back; a bare re-call will not ask. ${NO_WORK_TAIL}`
  )
}

/**
 * The research_meta-specific refusal: the same doctrine as
 * `guideDeclinedMessage`, worded for the act research_meta performs.
 *
 * "This exact research_meta call" is wrong when the query was reworded — the
 * whole point of the name-level suppression is that rewording is not a new
 * question. So this names the act, says the subject is dropped unless the
 * reader raises it, and forbids work-arounds, exactly as the doctrine requires.
 */
function researchDeclinedMessage(): string {
  return (
    `${NO_WORK} REFUSED — they already said no to research_meta in this conversation, so it has not run ` +
    `and they have not been asked again. Nothing changed — rewording the query is not a new ` +
    `question. Drop the subject: unless they raise it themselves, do not propose another ` +
    `research_meta call, and do not work around it — carry on with what they actually wanted, ` +
    `or say plainly that you cannot do this part without it. Only the reader raising ` +
    `research_meta themselves brings the dialog back; a bare re-call will not ask. ${NO_WORK_TAIL}`
  )
}
