/**
 * The pure half of the thinking row: what it says, and how long it has said it.
 *
 * The bug being fixed is a measurement, not an opinion. The owner sat through a
 * 210-second wait in which the chat panel was PIXEL-IDENTICAL for 61 seconds.
 * The assistant message is inserted with `text: ''` and no bubble renders for
 * empty text, so between send and first token the transcript showed literally
 * nothing new.
 *
 * Two rules come out of that, and both live here rather than in the component:
 *
 *  1. THE ELAPSED COUNTER IS THE LIVENESS GUARANTEE, not the animation. Text
 *     that changes twice a second is not motion, so it survives
 *     `prefers-reduced-motion: reduce`, where a spinner does not. It is the
 *     reason this row cannot be pixel-identical for 61 seconds for ANY reader.
 *
 *  2. THE LABEL IS NEVER INVENTED. Labels arrive from the server, describing
 *     work that actually happened (X2). When there are none, the fallback says
 *     something true and claims no activity: it does not say "Searching the
 *     web" because nothing here knows whether anything is searching anything.
 */

import type { ToolRowData } from './toolRowState'
import { isFailedPhase } from './toolRowState'

/**
 * What the row says when the server has told it nothing.
 *
 * "Working" is true the whole time a request is in flight and describes no
 * specific activity — which is the entire requirement. "Thinking" would be a
 * claim about reasoning that may be false while a tool is blocking, and
 * "Searching" would be a claim about a capability Deck-E does not have.
 */
export const THINKING_FALLBACK_LABEL = 'Working'

/**
 * Newest label wins.
 *
 * `labels` is append-only and newest-last, so this is a `findLast` for the
 * first non-blank entry rather than a cycle — the beautifului.dev reference
 * cycles a canned script on a timer, which would be a fabricated status here.
 * Its labels are a demo; ours are events.
 */
export function pickThinkingLabel(labels: readonly string[] | undefined): string {
  if (labels) {
    for (let i = labels.length - 1; i >= 0; i--) {
      const text = (labels[i] ?? '').trim()
      if (text) return text
    }
  }
  return THINKING_FALLBACK_LABEL
}

/**
 * Elapsed time, as a reader reads it.
 *
 * One decimal below a minute, because tenths are what make the number visibly
 * alive at a glance; whole seconds after, because at 3m 20s nobody is reading
 * tenths and the extra digit is just jitter. Rounds DOWN — a timer that has
 * been running 4.99s has not been running 5s, and a status surface that rounds
 * up is a status surface that overstates.
 *
 * Negative input (a clock that stepped backwards, or a `startedAt` in the
 * future) clamps to zero rather than rendering "-0.3s".
 */
export function formatElapsed(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0
  if (safe < 60_000) {
    const tenths = Math.floor(safe / 100)
    return `${Math.floor(tenths / 10)}.${tenths % 10}s`
  }
  const totalSeconds = Math.floor(safe / 1000)
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`
}

/** The same duration as a sentence, for the screen-reader label. */
export function describeElapsed(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0
  const seconds = Math.floor(safe / 1000)
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  const m = `${minutes} minute${minutes === 1 ? '' : 's'}`
  return rest ? `${m} ${rest} second${rest === 1 ? '' : 's'}` : m
}

/**
 * Should the step detail start open?
 *
 * Collapsed by default — the steps are reassurance, and the answer is the
 * answer. EXCEPT when one of them has failed or come back partial, because
 * `toolRowState`'s rule ("never collapse a failure") is worth nothing if the
 * container holding the failure is itself collapsed.
 */
export function shouldAutoExpandSteps(steps: readonly ToolRowData[] | undefined): boolean {
  return Boolean(steps?.some((s) => isFailedPhase(s.phase)))
}
