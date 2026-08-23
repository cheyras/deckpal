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
export type ToolPhase = 'start' | 'progress' | 'ok' | 'partial' | 'error'

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
 * How loud a row is.
 *
 *   `quiet`   — resting inline text. No chrome. The default, per C16.
 *   `running` — quiet, plus a travelling indicator. Still no chrome.
 *   `warn`    — a partial. Tinted, ruled, labelled.
 *   `danger`  — a failure. Same, louder.
 */
export type ToolTone = 'quiet' | 'running' | 'warn' | 'danger'

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

export function toolRowAppearance(data: ToolRowData): ToolRowAppearance {
  const running = data.phase === 'start' || data.phase === 'progress'
  // A running row's detail is the live note; a settled row's is the real
  // result's first line. Never both, never model prose.
  const detail = (running ? data.note : data.summary)?.trim() || undefined
  const failed = isFailedPhase(data.phase)
  const hasDetail = detail !== undefined

  const label = data.phase === 'error' ? 'Failed' : data.phase === 'partial' ? partialLabel(data.reason) : ''

  return {
    tone: data.phase === 'error' ? 'danger' : data.phase === 'partial' ? 'warn' : running ? 'running' : 'quiet',
    label,
    expandable: hasDetail,
    // NEVER COLLAPSE A FAILURE. When there is genuinely nothing to reveal the
    // flag is false because there is no region to open — the loud tone, the
    // explicit label and the retry control still carry the state.
    defaultExpanded: failed && hasDetail,
    busy: running,
    canRetry: failed,
    detail,
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
  }
}
