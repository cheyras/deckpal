/**
 * Phase → appearance, as a pure function, because it is the rule the owner
 * watched this UI break.
 *
 * He read a reply that began *"The analyze tool timed out before it could
 * finish reading your full collection…"* and called it, on camera, "a great
 * response". He did not notice it had failed. The chip that would have told him
 * had been pushed to the end of the row by an unrelated upsert bug, wore the
 * same grey pill as every successful call, and kept its real content in a
 * `title` attribute nobody hovers on a phone.
 *
 * So the direction "quieter tool rows" — which is right, and is what he asked
 * for — has one deliberate exception, and this module is where it is enforced
 * rather than remembered:
 *
 *   **A failed or partial call gets MORE weight than a successful one, is never
 *   collapsed by default, and always offers a way to try again.**
 *
 * It is pure and it is tested (`__tests__/toolRowState.test.ts`) so that a later
 * restyle cannot quietly walk the exception back. The component reads the
 * answer; it does not decide it.
 */

/**
 * The phases a real invocation can be in.
 *
 * `start` and `ok`/`error` come from the server's execute wrapper today
 * (`ToolChip` in `useDeckeChat.ts`). `progress` and `partial` are new:
 *
 *   `progress` — the call is still running and the server has sent a note about
 *                what it is doing. Same weight as `start`; more to read.
 *   `partial`  — the call ran out of time or output room and what came back is
 *                INCOMPLETE. This is neither `ok` nor `error` and must not look
 *                like either. It is the state the owner mistook for success.
 */
export type ToolPhase = 'start' | 'progress' | 'ok' | 'partial' | 'error' | 'declined'

export type ToolRowData = {
  id: string
  name: string
  title: string
  phase: ToolPhase
  /** First line of the REAL tool result. Never model prose. */
  summary?: string
  /** Latest progress note from the server, for a long-running call. */
  note?: string
  /** Why a `partial` is partial. */
  reason?: 'timeout' | 'truncated'
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * "LEAVE IT" IS NOT A TICK.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The owner, watching the row that a refusal leaves behind: *"there's a check
 * mark here and there shouldn't be. That should be like a little red x —
 * nothing was written, you cancelled it."*
 *
 * He is right and the reason is worth stating precisely. The row exists because
 * a refusal that left NO mark let the next thing he said read as though the
 * write had happened — a real report, and the reason `deny` emits a row at all.
 * But it was emitted `phase: 'ok'`, which is the phase for *a call that ran and
 * succeeded*, and `ok` draws a tick. So the fix for "the transcript did not say
 * it was cancelled" produced a transcript that said it was done.
 *
 * ── WHY THIS IS DERIVED FROM THE ID AND NOT SENT AS A PHASE ──────────────────
 *
 * It should be sent. `useDeckeChat.ts`'s `deny` should emit `phase: 'declined'`
 * and this bridge should not exist — but that file is owned by another lane in
 * this pass and must not be edited from here.
 *
 * So the row is recognised by the id `deny` deliberately builds:
 * `` `${toolCallId}-declined` ``. That is a real, intentional, stable string
 * rather than a guess about prose — the alternative was matching the title
 * "Nothing was written", which is a sentence somebody will reword. Both the
 * suffix AND `phase === 'ok'` must match, so a future genuine `declined` phase
 * passes straight through and this predicate simply stops firing.
 *
 * **When `useDeckeChat` gains the phase, delete this and the call in
 * `DeckeChat.tsx`.**
 */
export const DECLINED_ID_SUFFIX = '-declined'

export function toolRowFromChip(chip: ToolRowData): ToolRowData {
  if (chip.phase === 'ok' && chip.id.endsWith(DECLINED_ID_SUFFIX)) {
    return { ...chip, phase: 'declined' }
  }
  return chip
}

/**
 * How loud a row is.
 *
 *   `quiet`    — resting inline text. No chrome. The default, per C16.
 *   `running`  — quiet, plus a travelling indicator. Still no chrome.
 *   `warn`     — a partial. Tinted, ruled, labelled.
 *   `danger`   — a failure. Same, louder.
 *   `declined` — the reader said no. Quiet like a success, because nothing went
 *                wrong, but marked in the error colour with a ✗, because what
 *                did NOT happen is the fact. It is deliberately not `danger`:
 *                a red band across the transcript would tell somebody their own
 *                decision was a problem.
 */
export type ToolTone = 'quiet' | 'running' | 'warn' | 'danger' | 'declined'

export type ToolRowAppearance = {
  tone: ToolTone
  /**
   * The explicit state word shown beside the title.
   *
   * Empty for the quiet phases: a successful call that says "OK" next to it is
   * the pill chrome coming back in through a side door. Never empty for a
   * partial or an error — that is the point of the whole module.
   */
  label: string
  /** Whether the row has anything at all to reveal. */
  expandable: boolean
  /** Whether it starts revealed. True only for a failure that has detail. */
  defaultExpanded: boolean
  /** Whether a travelling "still going" indicator belongs on the row. */
  busy: boolean
  /** Whether to offer a retry control. Failures only. */
  canRetry: boolean
  /** The real text the row reveals: a progress note, or a result summary. */
  detail?: string
  /**
   * A few real words beside the title, so two calls to the same tool are
   * visibly two different calls.
   *
   * The quiet-by-default rule is right for ONE row and produces a stutter for
   * several: asking "how many cards do I have in Pitch Black?" makes three
   * genuine `set_progress` calls, and collapsed they render as the same
   * sentence three times, which reads as a bug rather than as work. The owner
   * saw exactly that — three identical rows stacked — and it is recorded as a
   * complaint in its own right.
   *
   * CLIPPED FROM THE REAL DETAIL, never composed. It is the same string the
   * expander reveals, cut at a clause boundary; there is nothing here a reader
   * could see that did not come out of the tool. Absent on a failure, which
   * already carries a loud explicit label and does not need a second one.
   */
  hint?: string
  /** One complete sentence for assistive tech, since the row is terse. */
  announce: string
  /** How urgently a change to this row should be announced. */
  live: 'off' | 'polite' | 'assertive'
}

/** The phases that are failures, in the sense this module cares about. */
export function isFailedPhase(phase: ToolPhase): boolean {
  return phase === 'partial' || phase === 'error'
}

/** Human wording for why a partial is partial. */
function partialLabel(reason: ToolRowData['reason']): string {
  if (reason === 'timeout') return 'Timed out — incomplete'
  if (reason === 'truncated') return 'Cut short — incomplete'
  // No reason given. Still says incomplete, because that is the fact that
  // matters and it is the fact we do know.
  return 'Incomplete'
}

/**
 * A few real words from the detail, or nothing.
 *
 * Cuts at the first sentence or clause boundary and gives up rather than
 * hard-truncating mid-word past the cap — half a word with an ellipsis reads as
 * broken, and a row with no hint is a perfectly good row.
 */
const HINT_MAX = 52
export function hintFrom(detail?: string): string | undefined {
  if (!detail) return undefined
  const flat = detail.replace(/\s+/g, ' ').trim()
  if (!flat) return undefined
  if (flat.length <= HINT_MAX) return flat
  const cut = flat.slice(0, HINT_MAX + 1)
  const at = Math.max(cut.lastIndexOf(' — '), cut.lastIndexOf('. '), cut.lastIndexOf(', '), cut.lastIndexOf(' '))
  if (at < 16) return undefined
  return flat.slice(0, at).replace(/[.,—:;]+$/, '') + '…'
}

export function toolRowAppearance(data: ToolRowData): ToolRowAppearance {
  const running = data.phase === 'start' || data.phase === 'progress'
  // A running row's detail is the live note; a settled row's is the real
  // result's first line. Never both, never model prose.
  const detail = (running ? data.note : data.summary)?.trim() || undefined
  const failed = isFailedPhase(data.phase)
  const hasDetail = detail !== undefined

  const label =
    data.phase === 'error'
      ? 'Failed'
      : data.phase === 'partial'
        ? partialLabel(data.reason)
        : // THE WORD, NOT JUST THE GLYPH. A ✗ alone is a shape somebody has to
          // interpret, and this row's entire job is to be unmistakable about the
          // fact that nothing was written.
          data.phase === 'declined'
          ? 'Cancelled'
          : ''

  return {
    tone:
      data.phase === 'error'
        ? 'danger'
        : data.phase === 'partial'
          ? 'warn'
          : data.phase === 'declined'
            ? 'declined'
            : running
              ? 'running'
              : 'quiet',
    label,
    expandable: hasDetail,
    // NEVER COLLAPSE A FAILURE. When there is genuinely nothing to reveal the
    // flag is false because there is no region to open — the loud tone, the
    // explicit label and the retry control still carry the state.
    defaultExpanded: failed && hasDetail,
    busy: running,
    canRetry: failed,
    detail,
    hint: failed ? undefined : hintFrom(detail),
    announce: announceFor(data, label, detail),
    // Successes stay silent: the answer itself is about to be announced and
    // narrating every read would bury it. Failures do not get that courtesy.
    live: data.phase === 'error' ? 'assertive' : data.phase === 'partial' ? 'polite' : 'off',
  }
}

function announceFor(data: ToolRowData, label: string, detail?: string): string {
  const title = data.title.trim() || data.name
  switch (data.phase) {
    case 'start':
      return `${title}: running`
    case 'progress':
      return detail ? `${title}: running. ${detail}` : `${title}: running`
    case 'ok':
      return detail ? `${title}: done. ${detail}` : `${title}: done`
    case 'partial':
      return detail ? `${title}: ${label}. ${detail}` : `${title}: ${label}`
    case 'error':
      return detail ? `${title}: failed. ${detail}` : `${title}: failed`
    case 'declined':
      // "NOTHING WAS WRITTEN" IS THE ANNOUNCEMENT. The reader knows they pressed
      // Leave it; what they need told back is the consequence.
      return detail ? `${title}: cancelled, nothing was written. ${detail}` : `${title}: cancelled, nothing was written`
  }
}
