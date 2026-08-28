/**
 * Not asking permission for a write that would change nothing.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE COMPLAINT, IN THE READER'S OWN WORDS
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * 2026-08-27, typed into the conversation it happened in:
 *
 *   *"Flagging this for a future improvement agent — you attempted to edit the
 *    strategy guide again instead of just looking at it."*
 *
 * The turn that produced it was "Give me insights about my slowking deck", and
 * the first thing on screen was a dialog asking to write and store a strategy
 * guide. Reproduced against the live model on `decke-read-vs-write-probe.mjs`,
 * n=12, and the shape of both failures is the whole reason this file exists:
 *
 *   decks(deck: 'slowking')      → returns the deck AND its stored guide
 *   deck_strategy(deck_id: 'slowking', markdown: <that guide, byte for byte>)
 *
 * He read the guide, decided it was good, and proposed saving it back
 * unchanged. That is not a bad judgement about what to write — there is nothing
 * to write. It is a dialog in front of a reader for a no-op.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THIS IS NOT A PROMPT RULE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `declined.ts` settled the general form of this argument and `focus.ts` has the
 * measurement behind it: *"with `danger` absent from `activeTools`, a prompt
 * begging the model to call it produced no call."* A prompt is a request. The
 * prompt now carries a read-versus-write rule too — it belongs there and it is
 * the right thing to say — but a rule that is followed most of the time still
 * leaves the reader answering a dialog for nothing some of the time.
 *
 * And unlike most behaviour, THIS one is decidable. "Would this write change
 * anything?" is a question about data, not about intent, so it can be answered
 * rather than asked for. A write that changes nothing needs no consent, because
 * consent is for consequences.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE FAILURE DIRECTION IS CHOSEN, NOT INHERITED
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Every path that cannot answer returns FALSE — "assume it changes something",
 * which means "ask". A resolution that misses, an API that errors, a tool with
 * no check, arguments of an unexpected shape: all of them fall through to the
 * existing behaviour, which is the dialog.
 *
 * That direction is the whole safety argument. A bug here can cost a needless
 * dialog; it can never cost an unapproved write. The opposite default would
 * make a thrown fetch into permission.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE PAIR HAS TO STAY IN STEP
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `aisdk.ts` consults this from BOTH `needsApproval` and `execute`, exactly as
 * it does with `alreadyDeclined`, and for the same reason its comment gives:
 * `needsApproval` false with an `execute` that did not check would perform the
 * write unapproved. The two read the same predicate through `isNoOpWrite`, and
 * the answer is memoised per (tool, arguments) so the second read cannot
 * disagree with the first — and so the round trip is paid once.
 */
import { needDeck, type Ctx } from '@deckpal/agent-tools';
import { callKey } from './repeat.js';

/** The deck detail fields this needs. The route returns much more. */
type DeckStrategyLite = { deck?: { strategyMd?: string | null } };

/**
 * Two guides are the same guide if they differ only in trailing whitespace.
 *
 * Deliberately NOT a looser comparison. Normalising case, or collapsing runs of
 * spaces, would let a genuinely different guide be swallowed as a no-op — and
 * the cost of being wrong in that direction is a write the reader wanted and
 * did not get, silently. Line endings and outer whitespace are the only
 * differences that carry no meaning in markdown, and `PUT /decks/:id/strategy`
 * already trims on the way in, so this compares what would actually be stored.
 */
function sameGuide(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string | null | undefined) => (s ?? '').replace(/\r\n/g, '\n').trim();
  return norm(a) === norm(b);
}

/**
 * "Would this call change anything?", per tool. Absent means "assume it would".
 *
 * ONE ENTRY, ON PURPOSE. This is not a framework waiting for tools to be added
 * to it — it is the answer to a measured defect, and every future entry should
 * arrive with its own recording the way this one did. The dangerous shape here
 * is a check that is subtly wrong about a tool nobody re-measured; a short map
 * is what keeps that from happening by accretion.
 */
const CHECKS: Record<string, (input: unknown, ctx: Ctx) => Promise<boolean>> = {
  /**
   * `deck_strategy` REPLACES the whole guide, so a write of the current text is
   * a no-op by definition — `PUT /decks/:id/strategy` would snapshot the same
   * string over itself and record a mutation event for nothing.
   */
  deck_strategy: async (input, ctx) => {
    const args = input as { deck_id?: unknown; markdown?: unknown } | null | undefined;
    // NO `markdown` IS A READ, not a no-op write. It never reaches the approval
    // path anyway (`wouldMutate` is about the arguments), and returning true
    // here would be a claim about the wrong call.
    if (typeof args?.markdown !== 'string') return false;
    // STRICT, like the handler's own write branch: a guide replaced on an
    // approximate name is a choice, and a no-op check that fuzzy-matched could
    // compare against a deck the write would not have touched.
    const picked = await needDeck(ctx, args.deck_id, { strict: true });
    if (!picked.ok) return false;
    const detail = (await ctx.api.get(`/decks/${encodeURIComponent(picked.value.id)}`)) as DeckStrategyLite;
    return sameGuide(detail?.deck?.strategyMd, args.markdown);
  },
};

/** What the model is told instead of a dialog. */
export function noOpMessage(tool: string): string {
  return (
    `That ${tool} call would not change anything — what you sent is already exactly what is ` +
    `stored, so nothing was written and the reader was not asked. This is not a failure and ` +
    `there is nothing to retry. Say what the existing content says if that answers them, and ` +
    `do not describe it as something you just saved. If you meant to change it, send the ` +
    `changed version.`
  );
}

/** Is there a check for this tool at all? Cheap, synchronous, no round trip. */
export function hasNoOpCheck(tool: string): boolean {
  return tool in CHECKS;
}

/**
 * A per-request memo of what the checks answered.
 *
 * One instance per `buildDataTools`, the same lifetime as `CallLedger` and for
 * one of the same two reasons: `needsApproval` and `execute` ask the identical
 * question about the identical call, and paying two round trips for one answer
 * — or worse, getting two different answers across them — is not acceptable in
 * the code path that decides whether a reader is asked before a write.
 */
export class NoOpMemo {
  private readonly seen = new Map<string, Promise<boolean>>();

  /**
   * Would this call change nothing?
   *
   * `false` for every tool without a check, so a caller can ask about anything.
   * A rejected check resolves to `false` rather than throwing: the caller is
   * the approval boundary, and an exception there would take the turn down over
   * an optimisation.
   */
  isNoOpWrite(tool: string, input: unknown, run: (fn: (ctx: Ctx) => Promise<boolean>) => Promise<boolean>): Promise<boolean> {
    const check = CHECKS[tool];
    if (!check) return Promise.resolve(false);
    const key = callKey(tool, input);
    const hit = this.seen.get(key);
    if (hit) return hit;
    const p = run((ctx) => check(input, ctx)).catch(() => false);
    this.seen.set(key, p);
    return p;
  }

  /**
   * Forget everything, because a write may have changed the answer.
   *
   * Same trigger and same reasoning as `CallLedger.invalidate`: a guide that
   * matched before an edit does not match after one, and serving a stale "that
   * would change nothing" is how a real edit would go quietly missing.
   */
  invalidate(): void {
    this.seen.clear();
  }
}
