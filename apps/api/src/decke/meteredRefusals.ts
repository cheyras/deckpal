/**
 * A meter refusal that has already happened does not get to happen again in the
 * same turn.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE LOOP, MEASURED
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The reader approved `write_strategy_guide`. The daily deep cap was spent, so
 * the meter refused it and `deepOutcome.ts`'s `[[NO_WORK]]` marker did its job:
 * he did NOT narrate a guide that was never written. What he did instead was
 * re-read the deck, call the same tool again, and raise a SECOND approval card
 * for the identical work — which was charged against the same spent cap and
 * refused again.
 *
 * So the honest-narration fix was real and the retry it sat on top of was not
 * touched. `buildDeepTools`'s `needsApproval` only ever asked one question —
 * "did the human decline this?" — and a meter refusal is not a decline. Nothing
 * in `deep.ts` or `focus.ts` knew that the tool had become impossible.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY AN IN-MEMORY CLOSURE IS NOT ENOUGH, AND THIS IS THE WHOLE DESIGN
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * A `Set` captured in `buildDeepTools` covers the SDK's own steps, because those
 * all happen inside one `streamText` call. It covers none of the browser's
 * approval legs: each approval is a fresh POST, `api/chat.mjs` reconstructs
 * every tool from scratch, and the closure is a new empty one. The original bug
 * spans exactly that boundary — approve, refuse, re-propose, approve — so a
 * closure alone would have left it standing while the unit tests went green.
 *
 * The replayed history is the one thing that crosses the legs. `declined.ts`
 * reaches the same conclusion for the same reason and reads declines out of it;
 * this reads meter refusals out of it, from the `[meter:…]` token that
 * `deepOutcome.ts` writes into the refusal itself.
 *
 * THE BROWSER HAS TO SEND ONE. It did not: `useDeckeChat.ts` replayed lookup
 * summaries and `output-error` parts and dropped the SDK's
 * `tool-output-available` chunk on the floor, so this seed was correct and
 * permanently empty on exactly the leg that mattered. See
 * `apps/web/src/character/host/chat/meterRefusal.ts`, which now carries the
 * refused call — id, original input, the server's own refusal text — and
 * nothing else.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * TURN-SCOPED, AND NEVER A LOCKOUT
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The seed reads only the part of the history AFTER the reader's last message.
 * A new user message is a new turn, the seed comes back empty, and the next
 * deep call is charged for real — which is the only way a top-up, a refund or
 * tomorrow's reset can ever take effect. Scoping this to the conversation the
 * way declines are scoped would be a permanent lockout bought with a balance
 * that has since changed.
 *
 * It is also per-request, and a request carries exactly one user: there is no
 * module-level state here, so nothing one reader's spent cap does can be seen
 * by another's turn.
 */

import { callKey } from './repeat.js';
import { meterRefusalScope, type MeterRefusalScope } from './deepOutcome.js';

/**
 * The four tools the deep meter governs.
 *
 * Listed here rather than derived from `buildDeepTools` so `focus.ts` can ask
 * "is this a deep tool" without importing the sub-agent machinery — and so a
 * fifth deep tool cannot be added without this list being looked at.
 * `deep.test.ts` pins the two against each other.
 */
export const DEEP_TOOL_NAMES: ReadonlySet<string> = new Set([
  'plan_deck',
  'write_strategy_guide',
  'research_meta',
  'analyze_collection',
]);

/**
 * What one turn has already been told it cannot have.
 *
 * Read by `needsApproval` (raise no card), by `execute` (refuse before the
 * meter is asked a second time) and by `focus.ts` (take the tool out of
 * `activeTools` entirely). Three places, one predicate, so they cannot come to
 * disagree about what is impossible.
 */
export interface MeteredRefusals {
  /**
   * Is THIS call impossible for the rest of the turn, and under which limit?
   *
   * A `cap` or `hold` refusal blocks every deep tool: the limit is on the tier,
   * not the call, so a different tool with different arguments is just as
   * impossible. A `credits` refusal blocks only the identical (tool, args) call
   * — a cheaper deep tool may still be affordable, and the brief asks that
   * unrelated capability survive.
   */
  blocked(name: string, input: unknown): MeterRefusalScope | undefined;
  /**
   * Should this tool be removed from `activeTools` outright?
   *
   * True only for the tier-wide limits, and only for deep tools. An argument-
   * specific `credits` refusal cannot be expressed as a tool name — the next
   * call may be a cheaper one — so it is enforced at `needsApproval` and
   * `execute` instead, which is where the arguments exist.
   */
  unavailable(name: string): boolean;
  /** Record the verdict the meter just returned. */
  note(name: string, input: unknown, scope: MeterRefusalScope): void;
}

/** The scope with the wider blast radius wins: a spent cap outranks a thin balance. */
const TIER_WIDE = (s: MeterRefusalScope): boolean => s === 'cap' || s === 'hold';

/**
 * Argument keys the SERVER puts into a call's input, not the model.
 *
 * `needsApproval` writes `no_research: true` onto a `write_strategy_guide`
 * input so the approval card can show the reader the guide is unbacked, and
 * `execute` then sees the MUTATED object. Keying off that made a refusal
 * unrecognisable the moment it came back: the model re-emits `{deck_id,
 * findings}`, the ledger holds `{deck_id, findings, no_research}`, the keys
 * differ, and a second card went up for the identical work — the exact loop
 * this module exists to close, surviving inside it.
 *
 * Stripped on BOTH sides (`note` and `blocked`), so the fingerprint is the work
 * the model asked for and nothing the server added to it. Everything else is
 * kept: a different deck, different findings or a different tool is different
 * work and stays askable.
 */
const SERVER_INJECTED = ['no_research'];

/** A call's identity for this ledger: `callKey`, minus what the server added. */
function fingerprint(name: string, input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return callKey(name, input ?? {});
  }
  const args: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  for (const k of SERVER_INJECTED) delete args[k];
  return callKey(name, args);
}

class TurnRefusals implements MeteredRefusals {
  /** Set by the first `cap`/`hold` refusal seen this turn. */
  private tier: MeterRefusalScope | undefined;
  /** Fingerprints refused for insufficient credit. */
  private readonly calls = new Map<string, MeterRefusalScope>();

  blocked(name: string, input: unknown): MeterRefusalScope | undefined {
    if (this.tier && DEEP_TOOL_NAMES.has(name)) return this.tier;
    return this.calls.get(fingerprint(name, input));
  }

  unavailable(name: string): boolean {
    return this.tier !== undefined && DEEP_TOOL_NAMES.has(name);
  }

  note(name: string, input: unknown, scope: MeterRefusalScope): void {
    if (TIER_WIDE(scope)) {
      this.tier ??= scope;
      return;
    }
    this.calls.set(fingerprint(name, input), scope);
  }
}

/**
 * Seed a turn's ledger from the replayed conversation.
 *
 * Walks only the messages AFTER the reader's last one — see the turn-scoping
 * section above — and picks up any deep tool result carrying the `[meter:…]`
 * token. `p.output` is where the SDK puts a tool's return value in a UI message
 * part; a call still awaiting approval has no output and contributes nothing,
 * which is correct, because nothing has been refused yet.
 *
 * ONLY `tool-…` PARTS ARE READ. A text part carrying the same token is not one
 * — so no amount of model prose, his own or replayed, can talk this into
 * suppressing work the meter would have allowed.
 *
 * `messages` is `unknown` on purpose: it arrives as parsed request JSON and the
 * shape is the browser's claim, not ours. Everything below is defensive for the
 * same reason `declinedCalls` is.
 */
export function seedMeteredRefusals(messages: unknown): MeteredRefusals {
  const ledger = new TurnRefusals();
  if (!Array.isArray(messages)) return ledger;
  // The current turn begins after the reader's most recent message. `-1` is not
  // a fallback to "scan everything by accident": with no user message at all,
  // slice(0) is the whole array, which is also the whole of a turn that has not
  // had a user message in it.
  let start = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
      start = i + 1;
      break;
    }
  }
  for (const m of messages.slice(start)) {
    const parts = m?.parts;
    if (!Array.isArray(parts)) continue;
    for (const p of parts) {
      if (!p || typeof p.type !== 'string' || !p.type.startsWith('tool-')) continue;
      const name = p.type.slice('tool-'.length);
      if (!DEEP_TOOL_NAMES.has(name)) continue;
      const scope = meterRefusalScope(p.output);
      if (scope) ledger.note(name, p.input ?? {}, scope);
    }
  }
  return ledger;
}

/**
 * The sentence a blocked call gets INSTEAD of a second trip to the meter.
 *
 * It says the limit is unchanged within this turn and that a later message will
 * be re-checked, because the failure to avoid is not only the retry — it is
 * also telling somebody a limit is permanent when a top-up would clear it.
 */
export function blockedReason(scope: MeterRefusalScope): string {
  if (scope === 'hold') return 'AI credits are still on hold — this was already refused in this turn';
  if (scope === 'credits') return 'this exact call was already refused this turn for lack of credits and nothing has changed since';
  return "today's deep-thinking questions are still spent — this was already refused in this turn";
}
