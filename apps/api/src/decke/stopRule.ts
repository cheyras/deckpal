/**
 * End a turn after its answer has settled into a final visible gesture.
 *
 * The bug it exists for: a tool call opens another step, and in that step a
 * model that has already answered answers again — measured, near-verbatim:
 *   [step 1] "Yeah, scalpers grabbing whole cases is the worst…"
 *   [step 2] "Yeah, scalpers grabbing whole cases is the worst…"
 *
 * It took three attempts to get right, and each looked correct:
 *   1. `hasToolCall('express')` — SILENCED HIM. He does not reliably speak
 *      before he moves; when `express` comes first, stopping there ends the
 *      turn with zero text. All five probe turns went silent while their
 *      states still fired correctly.
 *   2. A "you are done" note in the tool result — UNRELIABLE, and it silenced
 *      him too when worded as "stop here". A prompt is not an enforcement
 *      mechanism.
 *   3. Stop when the SAME step produced both visible text and an `express`
 *      call — "he said his piece and reacted".
 *
 * That third rule then met a measured defect of its own. With a larger tool
 * loop, the ordinary shape became lookup → words → panel; requiring text and a
 * gesture in the same step never stopped it. On the deployed preview, "show me
 * my 5 most valuable cards" redrew `showScreen` three times, and another probe
 * repeated its closing line after drawing the correct panel. The rule therefore
 * treated both `express` and `showScreen` as visible, cosmetic completion.
 *
 * The first whole-turn version stopped when the model had spoken at ANY point
 * and the last step was cosmetic-only. On 2026-10-10 that became wrong for the
 * interaction readers now want: "found these, now checking prices…" is an
 * interim update, not an answer. An express-only step after a later lookup must
 * not strand that lookup's result. We now count speech only AFTER the final
 * non-cosmetic tool call. That preserves the measured anti-duplication purpose
 * while allowing short updates between groups of work.
 *
 * Browser tools still end the server request and resume through a fresh HTTP
 * leg; this rule governs only the server-side model loop.
 *
 * NOT THE LINE THAT ANSWERED A PROGRESS NUDGE (review, 2026-10-10). After a
 * silent run of lookups `progressNudge.ts` asks him for one line of progress.
 * If the step after that nudge is the line plus an `express`, the rule above
 * saw speech after the last lookup and a cosmetic-only last step, and settled:
 * "Two losses to Dragapult so far — checking your list next." was the entire
 * reply, and no turn guard fired, because there WAS text. So the steps that
 * answered a nudge (`answeredNudge`, the ledger's `landings`) do not count as
 * speech here: the turn settles only on words he says after them. The cost is
 * the rarer case where the nudged line really was the whole answer AND came
 * with a face — the loop gets one more step, which may repeat him. A
 * text-only nudged step needs no rule at all: with no tool call the loop ends.
 */

export const COSMETIC_TOOLS: ReadonlySet<string> = new Set(['express', 'showScreen']);

type SettlingStep = {
  text?: string | null;
  toolCalls?: ReadonlyArray<{ toolName: string }> | null;
};

/** Index of the last step that called a non-cosmetic tool, or -1. */
export function lastLookupIndex(steps: ReadonlyArray<SettlingStep>): number {
  let lastLookup = -1;
  for (let i = 0; i < steps.length; i += 1) {
    if ((steps[i]?.toolCalls ?? []).some((call) => !COSMETIC_TOOLS.has(call.toolName))) {
      lastLookup = i;
    }
  }
  return lastLookup;
}

/**
 * What he said AFTER his last lookup — the answer, by this file's rule.
 *
 * Text that streamed in a step that also looked something up came BEFORE that
 * lookup's result, so it is an interim line ("found these, now checking
 * prices…"), not an answer to what the lookup found. `api/chat.mjs`'s
 * step-budget and empty-answer guards read this rather than every step's text,
 * so an interim line cannot switch them off.
 */
export function textAfterLastLookup(
  steps: ReadonlyArray<SettlingStep>,
  exclude: ReadonlyArray<number> = [],
): string {
  const lastLookup = lastLookupIndex(steps);
  const skip = new Set(exclude);
  return steps
    .flatMap((step, index) => (index > lastLookup && !skip.has(index) ? [step.text ?? ''] : []))
    .filter((text) => text.trim().length > 0)
    .join('\n');
}

export function spokeAndSettled(
  steps: ReadonlyArray<SettlingStep>,
  answeredNudge: ReadonlyArray<number> = [],
): boolean {
  const spoke = textAfterLastLookup(steps, answeredNudge).trim().length > 0;
  const lastCalls = steps.at(-1)?.toolCalls ?? [];
  const settled = lastCalls.length > 0 && lastCalls.every((call) => COSMETIC_TOOLS.has(call.toolName));
  return spoke && settled;
}

type AskStep = {
  toolCalls?: ReadonlyArray<{ toolName: string; invalid?: boolean }> | null;
};

/**
 * Whether a step put an `ask_user` card on screen: a call that PASSED its
 * schema.
 *
 * Not `hasToolCall('ask_user')`. In ai@7 a call that failed validation still
 * sits in `step.toolCalls`, marked `invalid: true` (`parse-tool-call.ts`), and
 * the SDK's helper counts it. A 13-character header therefore ended the turn
 * on an error row with no card and no words, when the loop would otherwise
 * have shown the model its validation error and let it ask again.
 */
function askedIn(step: AskStep | undefined): boolean {
  return (step?.toolCalls ?? []).some((call) => call.toolName === 'ask_user' && call.invalid !== true);
}

/** Stop condition: the LAST step showed the reader a valid ask card. */
export function askedThisStep(steps: ReadonlyArray<AskStep>): boolean {
  return askedIn(steps.at(-1));
}

/**
 * Whether ANY step of this request showed a valid ask card.
 *
 * A turn that asked has chosen what happens next — the reader's answer. Nothing
 * after-turn (the audit's corrective leg, the pasted-log backstop) may dock a
 * second card above the question it is waiting on.
 */
export function askedThisTurn(steps: ReadonlyArray<AskStep>): boolean {
  return steps.some(askedIn);
}

/**
 * The system note for a leg that follows an ask card in the SAME turn.
 *
 * An ask can share its step with a held write or a browser tool. The reader
 * approves the write (consent for that write, nothing more) or the browser
 * finishes moving, and the turn resumes with the questions still unanswered.
 * `api/chat.mjs` withholds new tool calls on that leg (`toolChoice: 'none'`);
 * this says why, so the one thing left to write is not an answer to questions
 * nobody has answered.
 */
export function askPendingInstruction(): string {
  return (
    'Earlier in this turn you asked the reader questions on a card, and they have not answered yet. ' +
    'In one short line, say what just finished (a change they approved, or where you are now), ' +
    'then stop. Do not assume their answers or continue the work the questions are for.'
  );
}
