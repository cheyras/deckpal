/**
 * Ask Deck-E to say where he is after a long, silent run of lookups.
 *
 * The owner, 2026-10-10: "with a lot of these requests there are a ton of tool
 * calls, and it's a solid minute of tool calls then one response. I want Deck-E
 * to divide these into groups — 'got it, I'll start researching' … 'interesting,
 * I'm finding good information, now I'll check X' — brief pauses between
 * groups."
 *
 * The core prompt already asks for exactly that ("Progress while you work" in
 * `prompt.ts`), and the stop rule (`stopRule.ts`) now lets an interim line
 * continue the turn instead of ending it. But a prompt is a request, not a
 * mechanism: it is read once, thousands of tokens before the tenth tool result,
 * and long tool chains are precisely where it fades. Anthropic's Opus 5.5
 * prompting guide gives the measured remedy — a short system message dropped
 * into the conversation once the model has gone quiet roughly halved long
 * silent stretches, with no change in cost — so that is what this is.
 *
 * The decision is pure and lives here so it can be tested. `api/chat.mjs` owns
 * the lines that act on it (append the message, allow a system message among
 * the messages, keep the cache breakpoint behind it) and only does so for
 * Anthropic models; `chatWiring.test.ts` pins those lines.
 *
 * WHAT COUNTS. A DATA step calls any tool other than the cosmetic `express` and
 * `showScreen` — `COSMETIC_TOOLS` from `stopRule.ts`, one definition, so "data"
 * here cannot drift from "lookup" there. A step with visible text ends a silent
 * run. A silent cosmetic-only step neither ends nor extends one: a face is not a
 * sentence, and it is not work either. `scripts/decke-replay-probe.mjs` grades
 * `longestSilentRun` by this same rule, so what the nudge fires on and what the
 * probe measures are one thing.
 *
 * WHEN.
 * - After SILENT_DATA_STEPS consecutive silent data steps. The replay probe
 *   fails a turn whose silent run is LONGER than SILENT_DATA_STEPS and calls a
 *   turn long from SILENT_DATA_STEPS + 1 data steps, so the nudge lands just
 *   before the step that would cross the line — every turn the probe can fail
 *   is one this had the chance to nudge. (Review, 2026-10-10: the first cut
 *   nudged at four while the probe called three "long", so it graded turns
 *   production never asked to speak.) The price is that a turn of exactly three
 *   silent lookups may be nudged on the step that was going to answer anyway,
 *   which is why the text asks for "what you're checking next" only if he is
 *   not done.
 * - Only straight after a data step. The conversation then ends in that step's
 *   tool result, and a system message has to follow a user or tool-result turn,
 *   never sit after the model's own words.
 * - Never before the first step (nothing has happened yet) and never after a
 *   step that already spoke: that IS the behaviour being asked for, and nudging
 *   it would be noise.
 * - At most MAX_PROGRESS_NUDGES per HTTP REQUEST — not per reader turn. A turn
 *   that pauses for an approval card or a browser tool resumes in a new
 *   request, which starts a new ledger. A run that already earned a nudge has
 *   to grow by another SILENT_DATA_STEPS silent steps before it earns the next
 *   one (`sinceStep`), so an ignored nudge is not repeated on every step.
 *
 * WHAT THE STEP AFTER A NUDGE IS. The ledger remembers it (`landings`), because
 * the line that answers a nudge is a progress line by construction, and the
 * stop rule must not mistake it for the answer: "Two losses to Dragapult so far
 * — checking your list next" plus a face would otherwise settle the turn and be
 * the whole reply. See `spokeAndSettled` in `stopRule.ts`.
 */
import { COSMETIC_TOOLS } from './stopRule.js';

/** Silent data steps in a row before the nudge; also the replay probe's longest allowed silent run. */
export const SILENT_DATA_STEPS = 3;

/** Nudges one HTTP request may receive (not one reader turn). */
export const MAX_PROGRESS_NUDGES = 2;

/**
 * `scripts/decke-gateway-probe.mjs` sends this exact text live.
 *
 * "Only if you're not done" (review, 2026-10-10): the nudge can land on the
 * step that was going to be the answer, and asking unconditionally for "what
 * you're checking next" invites him to invent a next check — or to end the
 * reply on one.
 *
 * "Then continue" stays, and it is load-bearing. A step that is ONLY text has
 * no tool call, so the model loop ends on it whatever the stop rule says. The
 * first softened wording dropped it, and on the live probe Standard's Gemini
 * fallback answered the nudge with "Now looking up Bob." and stopped — a
 * progress line as the whole reply (2026-10-10). With "then continue" it went
 * on to the lookup.
 */
export const PROGRESS_NUDGE_TEXT =
  "The reader hasn't heard from you in a while. In one short line, tell them what you've found so far. Only if you're not done, add what you're checking next, then continue.";

/** The shape both ai@7's `StepResult` and the replay probe's timeline satisfy. */
export type ProgressStep = {
  text?: string | null;
  toolCalls?: ReadonlyArray<{ toolName: string }> | null;
};

export function spoke(step: ProgressStep | undefined): boolean {
  return (step?.text ?? '').trim().length > 0;
}

export function isDataStep(step: ProgressStep | undefined): boolean {
  return (step?.toolCalls ?? []).some((call) => !COSMETIC_TOOLS.has(call.toolName));
}

/**
 * Silent data steps at the END of `steps`, counting only from `sinceStep` on.
 * Text anywhere in the tail ends the run; silent cosmetic steps are skipped.
 */
export function silentDataRun(steps: ReadonlyArray<ProgressStep>, sinceStep = 0): number {
  let run = 0;
  for (let i = steps.length - 1; i >= Math.max(0, sinceStep); i -= 1) {
    const step = steps[i];
    if (spoke(step)) break;
    if (isDataStep(step)) run += 1;
  }
  return run;
}

/**
 * Should the NEXT step be preceded by the progress nudge?
 *
 * `steps` are the steps this model call has finished (ai@7 hands them to
 * `prepareStep`); `sinceStep` is `steps.length` at the previous nudge, or 0.
 */
export function shouldNudge(
  steps: ReadonlyArray<ProgressStep>,
  nudgesSoFar: number,
  sinceStep = 0,
): boolean {
  if (nudgesSoFar >= MAX_PROGRESS_NUDGES) return false;
  const last = steps.at(-1);
  if (!last || spoke(last) || !isDataStep(last)) return false;
  return silentDataRun(steps, sinceStep) >= SILENT_DATA_STEPS;
}

/** A fresh message each time: the SDK owns what it is handed. */
export function progressNudgeMessage(): { role: 'system'; content: string } {
  return { role: 'system', content: PROGRESS_NUDGE_TEXT };
}

/**
 * The request-scoped bookkeeping `shouldNudge` needs: how many nudges this
 * request has had, and which steps of the current model call followed one.
 *
 * One per REQUEST, so the limit holds across the Quick tier's one Standard
 * retry. A retry is a new model call whose steps start again at zero, which is
 * why an empty `steps` resets the landing points but not the count.
 *
 * `landings` are step INDICES in the current model call — `steps.length` when
 * the nudge was appended, which is the index the next step will have. The
 * stop rule reads them (`spokeAndSettled(steps, landings)`) in the same call's
 * `stopWhen`, which ai@7 evaluates after the step that `prepareStep` prepared,
 * so the landing is always recorded before it is needed.
 */
export function createProgressNudges(): {
  next(steps: ReadonlyArray<ProgressStep>): boolean;
  readonly count: number;
  readonly landings: ReadonlyArray<number>;
} {
  let nudges = 0;
  let since = 0;
  let landings: number[] = [];
  return {
    next(steps) {
      if (steps.length === 0) {
        since = 0;
        landings = [];
      }
      if (!shouldNudge(steps, nudges, since)) return false;
      nudges += 1;
      since = steps.length;
      landings.push(steps.length);
      return true;
    },
    get count() {
      return nudges;
    },
    get landings() {
      return [...landings];
    },
  };
}
