/**
 * The compacted record of what a turn's tool calls FOUND, as a wire part.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY A TURN'S LOOKUPS ARE REPLAYED, COMPACTED (spec §2.3)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Recent turns now replay their complete bounded outputs. This compact form is
 * retained for older turns and legacy chips that never captured an output.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * IT HAS TWO CALLERS, AND THE SECOND ONE IS WHY THIS FILE EXISTS
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * It is also used between legs, where a client-side tool causes another request
 * before the current turn is complete.
 */

/**
 * What this needs from a tool chip. Deliberately not the whole `ToolChip`:
 * a minimal structural shape keeps this module loadable on its own, which is
 * the entire point of it being a module.
 */
export type RecordedCall = {
  name: string
  phase: string
  summary?: string
  reason?: 'timeout' | 'truncated'
}

/** How the replayed block announces itself, so it cannot read as dialogue. */
export const TOOL_RECORD_PREFIX = '[lookups on that turn, for your own reference —'

/**
 * Calls that get a transcript row but are NOT replayed as evidence.
 *
 * `express` moves his body. It looked nothing up, and the block this record
 * sits in says "you actually ran these, so the figures in them are real" — so
 * listing an animation under it is a category error, and one that would arrive
 * in the prompt on every leg of every turn that used it.
 *
 * `showScreen` and `showDeck` are replayed deliberately so a later leg knows
 * the reader already has the corresponding widget on screen.
 */
const NOT_EVIDENCE = new Set(['express'])

/**
 * Calls that get NO TRANSCRIPT ROW AT ALL.
 *
 * *"The 'change how he looks' commands don't need to be telegraphed to the user
 * ever."* — 2026-08-27, against a transcript where a message whose whole content
 * was feedback came back with `Change how he looks · applied 1 command(s)` above
 * the reply. The tool's own description has always promised the opposite: *"The
 * user never sees these commands — only your words and the animation."*
 *
 * THE SERVER ALREADY STOPPED SENDING IT (`decke/tools.ts` — the note at
 * `express`'s `execute`), so on the live backend this set is never consulted.
 * It is here because the browser is not the only thing that writes chips and
 * because a self-hosted or older API is free to send whatever it likes: a
 * promise that "the user never sees these" is worth having enforced on the side
 * that does the showing. One `Set.has` per chip.
 *
 * NOT the same set as `NOT_EVIDENCE`, and they must not be merged. That one is
 * about what the NEXT TURN is told; this one is about what the READER is shown.
 * Widget tools are deliberately in neither set: they are replayed and displayed.
 */
export const NOT_SHOWN = new Set(['express'])

/** Does this call get a row in the transcript? */
export function isShownInTranscript(name: string): boolean {
  return !NOT_SHOWN.has(name)
}

export function lookupRecord(
  chips: readonly RecordedCall[],
): { type: 'text'; text: string } | null {
  // A PARTIAL RESULT IS STILL EVIDENCE, AND IT IS LABELLED AS PARTIAL.
  //
  // Both halves matter. Dropping it would lose the record that he read anything
  // at all, leaving what follows with only prose about it — and prose is
  // exactly the thing that drifts, which is why this record exists. Including
  // it unlabelled is worse: he would carry a reading that stopped half way
  // through the collection forward as a complete one, and quote its figure
  // again with more confidence than the first time.
  //
  // A `start` chip is not evidence of anything yet and is filtered out here, so
  // a caller cannot accidentally replay "he began looking something up".
  const done = chips.filter(
    (t) => (t.phase === 'ok' || t.phase === 'partial') && t.summary && !NOT_EVIDENCE.has(t.name),
  )
  if (!done.length) return null
  return {
    type: 'text',
    text:
      `${TOOL_RECORD_PREFIX} you actually ran these, so the figures in them are real ` +
      `and yours are not a guess]\n` +
      done
        .map((t) =>
          t.phase === 'partial'
            ? `${t.name}: ${t.summary} [INCOMPLETE — this one ran out of ` +
              `${t.reason === 'truncated' ? 'room' : 'time'} and did not finish. ` +
              `Do not present its figures as a full answer.]`
            : `${t.name}: ${t.summary}`,
        )
        .join('\n'),
  }
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * AND THE FAILURES, WHICH THIS FILE USED TO THROW AWAY
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Failures remain real tool parts rather than prose so the model and the
 * server-side circuit breaker see the call, its input, and its error together.
 */

/** What a replayed failure looks like on the wire. */
export type FailurePart = {
  type: string
  toolCallId: string
  input: Record<string, unknown>
  state: 'output-error'
  errorText: string
}

/**
 * How many failures one turn may replay.
 *
 * THE PAYLOAD IS THE COST. Every part here is re-billed on every leg of every
 * later turn, exactly like the landmark list, and a turn that flailed can hold
 * a dozen error chips. Four is enough for the breaker to see a pattern
 * (`CIRCUIT_BUDGET` is 2 distinct TURNS, so one is enough per turn) and small
 * enough that a bad turn cannot dominate the window. The surplus is dropped
 * silently; there is nothing sensible the model could do with a marker.
 */
export const MAX_REPLAYED_FAILURES = 4

/** A chip, plus the two fields a replayed failure needs beyond `RecordedCall`. */
export type FailedCall = RecordedCall & { id: string; args?: Record<string, unknown> }

/**
 * The failed calls of one turn, as wire parts.
 *
 * `summary` IS the error text — it is the first lines of the real result, from
 * the server's own `summariseError`, never model prose (X2). A chip with no
 * summary says nothing and is dropped rather than replayed as an empty failure.
 */
export function failureParts(chips: readonly FailedCall[]): FailurePart[] {
  return chips
    .filter((t) => t.phase === 'error' && typeof t.summary === 'string' && t.summary.trim().length > 0)
    .slice(0, MAX_REPLAYED_FAILURES)
    .map((t) => ({
      type: `tool-${t.name}`,
      toolCallId: t.id,
      input: t.args ?? {},
      state: 'output-error' as const,
      errorText: t.summary as string,
    }))
}

/**
 * The calls a leg added, given what earlier legs already carried forward.
 *
 * ONLY THE NEW ONES. Chips live on the reply message for the whole turn, so
 * replaying all of them on every leg would send leg 1's record again on leg 2
 * and a third time on leg 3 — the same lookups arriving three times reads as
 * three separate readings, which is precisely the drift this record exists to
 * prevent.
 *
 * Returns what to send AND what to mark, rather than mutating: a `start` chip
 * that has not resolved yet is not evidence and must stay eligible once its
 * result lands, so "seen" and "recorded" are not the same set.
 */
export function freshCalls<T extends RecordedCall & { id: string }>(
  chips: readonly T[],
  alreadyReplayed: ReadonlySet<string>,
): { send: T[]; mark: string[] } {
  const send = chips.filter((t) => !alreadyReplayed.has(t.id))
  return {
    send,
    mark: send.filter((t) => t.phase === 'ok' || t.phase === 'partial').map((t) => t.id),
  }
}
