/**
 * The compacted record of what a turn's tool calls FOUND, as a wire part.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY A TURN'S LOOKUPS ARE REPLAYED, COMPACTED (spec §2.3)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The wire used to keep text and nothing else. So turn N+1 had no record that
 * turn N had read 604 cards — only its own prose about them. Which re-creates
 * the original pathology in a new form: he asserts from his own earlier
 * sentences rather than from data, and a sentence is exactly the thing that can
 * drift. "You've got 70 of them" becomes "you've got most of them" becomes a
 * number nobody looked up.
 *
 * Three options were on the table and the owner chose this one:
 *
 *   replay everything     truthful, and the input bill grows without bound on
 *                         a long conversation — colliding with the per-turn
 *                         input budget the tool ceiling exists to defend
 *   re-read per turn      always fresh, never stale, and costs a tool call and
 *                         a round trip on every follow-up question
 *   replay COMPACTED      what a lookup FOUND, in one line, not its 200 rows
 *
 * The compact form is the chip's own summary — the first line of the real tool
 * result, produced by the server's execute wrapper. So the record cannot
 * describe a lookup that did not happen: there is no chip without an
 * invocation.
 *
 * MARKED AS A RECORD, not folded into his speech. Appending "I read 604 cards"
 * to his words would put sentences in his mouth he never said, and the next
 * turn would replay them as if he had. It is a separate part, prefixed, and
 * plainly not dialogue.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * IT HAS TWO CALLERS, AND THE SECOND ONE IS WHY THIS FILE EXISTS
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * This lived inside `messagesToWire`, which replays between TURNS. Between the
 * LEGS of one turn — the extra round trips a client tool like `flyTo` forces,
 * because the browser has to run it and report back — the follow-up message
 * carried his text and the movement's own result and NOTHING ELSE. So the
 * moment he flew anywhere, he lost the record of every server tool he had just
 * run.
 *
 * Measured, from a real turn: asked to show a decklist he drew the panel with
 * `showScreen`, called `flyTo`, and on the next leg re-read `decks` and wrote
 * the whole list out AGAIN as prose. Both rules that should have stopped that
 * were live and neither could fire — the prompt's "when a panel carries the
 * answer, do not also narrate it", and `showScreen`'s own return value, *"The
 * panel is on screen. Do not repeat its contents in words"*. A rule cannot
 * apply to evidence that was thrown away before it was read.
 *
 * Which is the paragraph above, one level down: s/turn/leg/.
 *
 * Extracted here rather than exported from `useDeckeChat.ts` because that file
 * reaches `import.meta.env` through its imports and cannot be loaded under
 * `node --import tsx --test` at all — so anything left in it can only ever be
 * tested by pinning its source text. This is the same reason `toolRowState.ts`
 * and `historyState.ts` sit in this directory.
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
 * `showScreen` is not a lookup either and IS replayed, deliberately: it is the
 * line that tells the next leg a panel already exists, which is the entire
 * reason this file has a second caller.
 */
const NOT_EVIDENCE = new Set(['express'])

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
