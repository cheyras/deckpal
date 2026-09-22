/**
 * How a deep tool says NOTHING HAPPENED, in a way the model cannot read as an
 * answer.
 *
 * ── THE FAILURE THIS EXISTS TO STOP, ON CAMERA ───────────────────────────────
 *
 * Recorded 2026-08-23. The owner asked for a deck. `plan_deck` was refused —
 * the daily deep cap was already spent — so it ran no model and produced no
 * plan. Deck-E then said:
 *
 *     "Perfect, let's build! I'm pulling together a 60-card list…"
 *
 * He tried twice, searched the catalogue in between, and narrated a decklist
 * that did not exist. The owner's words: *"he couldn't actually plan the deck,
 * so it wouldn't be a good deck. Really we need to change the order of
 * operations."*
 *
 * ── WHY HE DID THAT, AND WHY IT IS NOT A PROMPT PROBLEM ──────────────────────
 *
 * Every one of the three outcomes returned a BARE STRING:
 *
 *     refused  →  "I have used up today's 10 deep-thinking questions. Ask me
 *                  again tomorrow — looking things up is separate and still works."
 *     failed   →  "That did not work: <message>"
 *     worked   →  the actual plan
 *
 * The chip told the READER which was which. Nothing told the MODEL. All three
 * are the same type, all three read as prose, and the refusal is a *polite,
 * fluent, first-person sentence* — the single easiest thing in the world to
 * mistake for the beginning of an answer. Asking a non-reasoning model to
 * distinguish "here is your deck" from "I cannot make your deck" by tone is not
 * a prompt failing. It is a missing signal.
 *
 * This is the same defect as the denied write, which was live for the same
 * reason: accepting emitted a row and declining emitted nothing, so the absence
 * had to be inferred. The lesson repeats — **an outcome nobody encodes is an
 * outcome somebody guesses.**
 *
 * ── THE SHAPE ────────────────────────────────────────────────────────────────
 *
 * A marker no plan could contain, first, before any prose. Then what did not
 * happen, in the negative. Then the instruction, because the model is going to
 * write a sentence next and this is the last thing it reads before doing so.
 *
 * Deliberately UGLY. This string is never shown to a reader — the chip carries
 * that, from the same event — so it is optimised for one job: being impossible
 * to continue from as though work had occurred.
 */

/**
 * The marker. Never appears in a real result, and `deepOutcome.test.ts` pins
 * that a plausible deck plan does not contain it.
 */
export const NO_WORK = '[[NO_WORK]]';

/** Shared tail. The model reads this immediately before it writes its reply. */
const TAIL =
  `There is NO result. Do not describe, summarise, continue from or refer to work that did not happen. ` +
  `Do not say "let's build", do not list cards, do not give counts. ` +
  `Say plainly that it did not happen and why, and stop.`;

/**
 * WHICH limit refused a deep call, in one machine-readable word.
 *
 *   `cap`      the daily deep-call cap is spent — EVERY deep tool is impossible
 *              for the rest of this turn.
 *   `hold`     AI credits are on hold — same blast radius as `cap`.
 *   `credits`  this particular call costs more than the balance left. A CHEAPER
 *              deep tool may still be affordable, so this blocks the identical
 *              call and nothing else.
 *
 * Not a failure mode. A provider that throws is `deepFailed`, which carries no
 * scope at all — a transient 503 must never read as a spent meter.
 */
export type MeterRefusalScope = 'cap' | 'hold' | 'credits';

/**
 * The scope, written into the refusal string itself.
 *
 * ── WHY IT TRAVELS IN THE TEXT, WHICH LOOKS LIKE A SMELL ─────────────────────
 *
 * The browser re-POSTs the whole conversation on every approval leg and the
 * server keeps nothing between requests — `declined.ts` says the same thing
 * about declines. A tool result is the only per-call field that survives that
 * round trip, so a refusal that wants to be remembered on the NEXT leg has to
 * put its evidence there.
 *
 * This is not "parse the prose". It is a fixed token THIS module emitted, read
 * back by an anchored pattern that cannot match anywhere a real answer could
 * reach: `[[NO_WORK]]` is already the marker no plan contains, and the bracket
 * form is matched at the very start of the string.
 */
const SCOPE_RE = /^\[\[NO_WORK\]\] REFUSED \[meter:(cap|hold|credits)\]/;

/**
 * A deep call that never ran a model, because it was refused before it started.
 *
 * `reason` is the machine's reason, not his voice — he writes the sentence the
 * reader sees. Keep it short and factual.
 *
 * `scope` is present only for METER refusals. A decline, a vetted-off research
 * query and every other refusal omit it, and are therefore invisible to
 * `meterRefusalScope` — which is correct: they are not evidence that the
 * account has run out of anything.
 */
export function deepRefused(reason: string, scope?: MeterRefusalScope): string {
  const tag = scope ? ` [meter:${scope}]` : '';
  return `${NO_WORK} REFUSED${tag} — this tool did not run. ${reason}. ${TAIL}`;
}

/**
 * Read the scope back off a refusal, wherever it has been since.
 *
 * Returns undefined for every other string — a real answer, a failure, a
 * decline — so "the meter refused this" is never inferred from anything but the
 * token this module wrote.
 */
export function meterRefusalScope(text: unknown): MeterRefusalScope | undefined {
  if (typeof text !== 'string') return undefined;
  const m = SCOPE_RE.exec(text);
  return m ? (m[1] as MeterRefusalScope) : undefined;
}

/**
 * A deep call that started and threw.
 *
 * Distinct from a refusal because the two need different sentences from him: a
 * refusal is a limit and a failure is a fault, and telling someone their deck
 * failed when they are simply out of credit sends them to support instead of to
 * the top-up.
 */
export function deepFailed(message: string): string {
  return `${NO_WORK} FAILED — this tool ran and errored. ${message}. ${TAIL}`;
}

/** Did a deep tool produce nothing? Exported for `deepOutcome.test.ts`; nothing else consumes it yet. */
export function isNoWork(text: unknown): boolean {
  return typeof text === 'string' && text.startsWith(NO_WORK);
}
