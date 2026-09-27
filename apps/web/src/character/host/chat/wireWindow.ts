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

/** Evidence messages one request may carry. MIRRORS `EVIDENCE_MAX`. */
export const EVIDENCE_MAX = 24

/**
 * How many dropped turns of one still-failing tool ride along. At least the
 * breaker's own budget (`CIRCUIT_BUDGET` in `decke/failing.ts`, 2 turns), so a
 * circuit that was open stays open; more would only spend the evidence cap.
 */
export const BREAKER_PER_TOOL = 4

type WireLike = { role: string; parts: Record<string, unknown>[] }

/** The line-anchored `<tool>: …` names in a lookup record. MIRRORS `recordedLookups`. */
function recordedNames(text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n').slice(1)) {
    const m = /^([a-z][a-z0-9_]*): /.exec(line)
    if (m) out.push(m[1]!)
  }
  return out
}

/**
 * What the replies that left the window still owe the server's LEDGERS — never
 * the model.
 *
 * Two of them are conversation-wide: the failing-tool breaker
 * (`decke/failing.ts` — a tool that failed in two distinct turns is not called
 * again until it succeeds) and the already-told record (`decke/toldAlready.ts`).
 * Trimming their evidence away with the text would quietly re-close a breaker
 * the reader never asked to retry, so it travels in a separate `evidence` field
 * the server hands to those two ledgers and does not show the model.
 *
 * COMPACTED, NOT SLICED. A plain "last N replies" drops the oldest first, and
 * the oldest are exactly where an unrecovered failure lives once a long chat of
 * successful lookups has piled up behind it (found by Astra in review). So the
 * breaker's STATE is carried instead: each tool still failing at the end of the
 * dropped turns, one replayed failure per turn it failed in since it last
 * worked, capped at `BREAKER_PER_TOOL`. Lookup records fill what room is left,
 * newest kept, and go FIRST — the server replays evidence in order, and a
 * record naming a tool after its failures would read as a recovery that never
 * happened.
 */
function compactEvidence(dropped: readonly WireLike[]): WireLike[] {
  const open = new Map<string, Record<string, unknown>[]>()
  const records: WireLike[] = []
  for (const m of dropped) {
    if (m.role !== 'assistant') continue
    const ok = new Set<string>()
    const failed = new Map<string, Record<string, unknown>>()
    const recordParts: Record<string, unknown>[] = []
    for (const p of m.parts) {
      if (p.type === 'text' && typeof p.text === 'string' && p.text.startsWith(TOOL_RECORD_PREFIX)) {
        recordParts.push(p)
        for (const name of recordedNames(p.text)) ok.add(name)
      } else if (typeof p.type === 'string' && p.type.startsWith('tool-')) {
        const name = p.type.slice('tool-'.length)
        if (p.state === 'output-error') failed.set(name, p)
        else if (p.state === 'output-available') ok.add(name)
      }
    }
    // Within one turn success dominates, exactly as the breaker reads it.
    for (const name of ok) {
      open.delete(name)
      failed.delete(name)
    }
    for (const [name, part] of failed) open.set(name, [...(open.get(name) ?? []), part].slice(-BREAKER_PER_TOOL))
    if (recordParts.length) records.push({ role: 'assistant', parts: recordParts })
  }
  // One message per TURN DEPTH, shared by every open tool, because the
  // breaker counts messages per tool: a tool that failed in three turns is
  // in the first three. So all open state fits in `BREAKER_PER_TOOL`
  // messages however many tools are failing, and nothing has to be cut.
  const depth = Math.max(0, ...[...open.values()].map((f) => f.length))
  const breaker: WireLike[] = Array.from({ length: depth }, (_, k) => ({
    role: 'assistant',
    parts: [...open.values()].filter((f) => f.length > k).map((f) => f[f.length - 1 - k]!),
  }))
  return [...records.slice(Math.max(0, records.length - (EVIDENCE_MAX - breaker.length))), ...breaker]
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
 * owe the server's ledgers; see `compactEvidence`.
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
  return { messages: prior.slice(start), dropped: start, evidence: compactEvidence(prior.slice(0, start)) }
}
