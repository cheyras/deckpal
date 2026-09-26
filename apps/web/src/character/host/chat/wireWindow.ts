/**
 * How much earlier conversation one request carries.
 *
 * ── WHY THE BROWSER TRIMS AT ALL ────────────────────────────────────────────
 *
 * The server keeps nothing between requests, so every leg re-POSTs the whole
 * transcript — and the server used to read all of it. It now shows the model a
 * bounded window and refuses a body past a hard cap (SEC-04,
 * `apps/api/src/decke/wireBounds.ts`). Sending the whole transcript anyway
 * would only move the failure: a long, honest conversation would grow past the
 * cap and start answering 413. So the browser trims to the SAME window the
 * server would, and the body stays small however long the chat gets.
 *
 * ── WHAT IS NEVER TRIMMED ───────────────────────────────────────────────────
 *
 * This is applied to the PRIOR wire only — the turns before the reader's new
 * message. The current turn, its legs and the approval answers at the end of
 * them are appended afterwards and never pass through here, because the SDK
 * collects approvals from the final parts of the final message.
 *
 * MIRRORS `WINDOW_MESSAGES`, `WINDOW_PRIOR_CHARS`, `PART_MAX_CHARS` and `windowForModel` in
 * `apps/api/src/decke/wireBounds.ts`. Change one, change both —
 * `wireBounds.test.ts` there pins the numbers against this file.
 */

import { TOOL_RECORD_PREFIX } from './lookupRecord'

/** Prior messages the model is shown. */
export const WINDOW_MESSAGES = 24

/** Characters of prior history the model is shown. Larger than one pasted
 *  battle log, so "yes, log it" on the turn after a paste still carries it. */
export const WINDOW_PRIOR_CHARS = 64_000

/**
 * The largest part the server reads. A message with a part past this was
 * answered 413 and never reached the model, so replaying it on the next turn
 * would only be refused again — or, being bigger than the whole window, end the
 * window at itself and cost the reader every earlier message. It is left out
 * of the wire instead, the same as it was left out of the conversation.
 */
export const PART_MAX_CHARS = 60_000

/** Dropped replies whose ledger evidence still rides along. MIRRORS `EVIDENCE_MAX`. */
export const EVIDENCE_MAX = 24

type WireLike = { role: string; parts: Record<string, unknown>[] }

/**
 * What a reply that left the window still owes the server's LEDGERS — never
 * the model.
 *
 * Two of them are conversation-wide and read replies from any earlier turn:
 * the failing-tool breaker (`decke/failing.ts` — a tool that failed in two
 * distinct turns is not called again, and a later success resets it) and the
 * already-told record (`decke/toldAlready.ts`). Both read only a reply's
 * replayed failures and its lookup record. Trimming those away with the text
 * would quietly re-close a breaker the reader never asked to retry, so they
 * travel in a separate `evidence` field the server gives to the ledgers and
 * does not show the model. Everything else in the reply stays dropped.
 */
function evidenceOf(m: WireLike): WireLike | null {
  if (m.role !== 'assistant') return null
  const parts = m.parts.filter((p) =>
    p.type === 'text'
      ? typeof p.text === 'string' && p.text.startsWith(TOOL_RECORD_PREFIX)
      : typeof p.type === 'string' && p.type.startsWith('tool-') && p.state === 'output-error',
  )
  return parts.length ? { role: 'assistant', parts } : null
}

function partChars(part: Record<string, unknown>): number {
  if (part.type === 'text') return typeof part.text === 'string' ? part.text.length : 0
  try {
    return JSON.stringify(part)?.length ?? 0
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/**
 * The newest prior messages that fit, starting on one of the reader's.
 *
 * `dropped` is how many were left behind, so the caller can tell the reader
 * once that the start of the chat is out of his view rather than letting him
 * find out by asking about it. `evidence` is what those dropped replies still
 * owe the server's ledgers; see `evidenceOf`.
 */
export function windowPrior<T extends WireLike>(
  all: readonly T[],
): { messages: T[]; dropped: number; evidence: WireLike[] } {
  const prior = all.filter((m) => m.parts.every((p) => partChars(p) <= PART_MAX_CHARS))
  let start = prior.length
  let chars = 0
  while (start > 0 && prior.length - start < WINDOW_MESSAGES) {
    const size = prior[start - 1]!.parts.reduce((n, p) => n + partChars(p), 0)
    if (chars + size > WINDOW_PRIOR_CHARS) break
    chars += size
    start--
  }
  while (start < prior.length && prior[start]!.role !== 'user') start++
  const evidence = prior
    .slice(0, start)
    .map(evidenceOf)
    .filter((e): e is WireLike => e !== null)
    .slice(-EVIDENCE_MAX)
  return { messages: prior.slice(start), dropped: start, evidence }
}
