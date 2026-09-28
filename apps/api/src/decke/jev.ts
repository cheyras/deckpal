/**
 * Jev: a typed judgment in a fraction of a second, and exactly today's
 * behaviour whenever there is not one.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS, AND WHY IT IS NOT THE CLASSIFIER THIS HARNESS REJECTED
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `api/chat.mjs` refused a router in front of every message, for two reasons:
 * "a classifier turn in front of every message taxes the 90% that do not need
 * one, and a misroute is INVISIBLE". Both were true of an LLM turn. Neither is
 * true of this.
 *
 *   THE TAX. Jev (`typesafe-ai/jev`, the Gateway's one `evaluation` model) does
 *   not generate text. It reads a small state once and answers typed questions
 *   in one pass: input tokens only, $0.042 per million, output free. A reflex
 *   read is ~850 input tokens — $0.000036, about 0.3% of a chat turn — and 408
 *   eval calls through the Gateway measured p50 0.28 s, p95 0.4 s
 *   (DECISIONS.md 2026-09-26). It runs under a hard deadline, so the worst it
 *   can add is that deadline.
 *
 *   THE INVISIBLE MISROUTE. Every answer carries a probability, and the harness
 *   acts only above a threshold chosen on a labelled eval set. Below it — and
 *   on a timeout, an HTTP error, a malformed answer, or the kill switch — the
 *   caller gets `null` and does precisely what it did before this file existed.
 *   Nothing in Deck-E may depend on Jev to work; it may only work better.
 *
 * WHAT IT NEVER DECIDES. Jev never approves a write: every change still stops
 * at the signed consent card. It never sees card photos, voice, numbers to
 * compute or ids to ground, and it is not a security control — its own vendor
 * documents that text in its state can move its answers. It reads only what
 * each caller hands it, and each caller keeps that to the reader's latest words
 * and the minimum around them.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE CALL
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Plain HTTP to the Gateway's `/v1/evaluate`, not the AI SDK's
 * `experimental_evaluate`: that needs `ai` 7.0.105 and this repo pins 7.0.94,
 * the version the signed approval replay was verified against. An SDK bump
 * belongs on its own schedule with that suite, not inside this one.
 *
 * `zeroDataRetention: true` and `only: ['typesafe-ai']` on every request.
 * Measured: without them the Gateway routes Jev to a second host (DigitalOcean)
 * first; with them it skips that host as ZDR-ineligible and serves the call
 * from TypeSafe itself. Through the Gateway, TypeSafe is under Vercel's
 * zero-retention agreement (verified 2026-09-27, #260) — and the flag is what
 * makes that agreement apply, so it must never be removed. See SECURITY.md.
 * Same Deck-E Gateway key as the chat model, so the spend stays legible as
 * Deck-E's.
 */
import { EVALUATION } from './models.js'

/** On, off, or a value nobody meant. Read per call, so a redeploy is enough. */
export const JEV_VAR = 'DECKE_JEV'
/** The hard deadline, in milliseconds. */
export const JEV_TIMEOUT_VAR = 'DECKE_JEV_TIMEOUT_MS'

/**
 * The default deadline: twice the eval's measured p95 through the Gateway
 * (0.4 s, from a residential connection — Vercel's own hop should be shorter).
 * Past it the harness proceeds exactly as before Jev, so a slow day costs at
 * most this much, never an answer.
 */
export const JEV_TIMEOUT_DEFAULT_MS = 800

const EVALUATE_URL = 'https://ai-gateway.vercel.sh/v1/evaluate'

export type JevStatus = 'on' | 'off' | 'invalid'

/**
 * `off` when unset. A judgment layer nobody has switched on is a normal state,
 * not a fault, and it behaves exactly like the harness before Jev. `invalid` is
 * the fault B11 exists for — a value somebody typed and meant — and it also
 * behaves as off, loudly.
 */
export function jevStatus(): JevStatus {
  const v = (process.env[JEV_VAR] ?? '').trim().toLowerCase()
  if (!v || v === 'off') return 'off'
  if (v === 'on') return 'on'
  return 'invalid'
}

export function jevTimeoutMs(): number {
  const n = Number.parseInt(process.env[JEV_TIMEOUT_VAR] ?? '', 10)
  return Number.isFinite(n) && n >= 100 && n <= 5_000 ? n : JEV_TIMEOUT_DEFAULT_MS
}

/** What `/health` reports: the switch and the deadline, never a key. */
export function jevHealth(): { status: JevStatus; model: string; timeoutMs: number } {
  return { status: jevStatus(), model: EVALUATION.id, timeoutMs: jevTimeoutMs() }
}

export function jevWarning(): string | null {
  if (jevStatus() !== 'invalid') return null
  return (
    `[deckpal-api] ${JEV_VAR} is set to something other than "on" or "off", so Deck-E's ` +
    `Jev judgments are OFF. He behaves exactly as he did before Jev; set it to "on" to use ` +
    `them, or unset it to silence this.`
  )
}

export type Question =
  | { type: 'boolean'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }

export type Answer =
  | { type: 'boolean'; probability: number }
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number | null }

export interface Judgment<K extends string> {
  answers: Record<K, Answer>
  /** Wall-clock milliseconds, request to parsed answer. */
  ms: number
  inputTokens: number | null
  /** The Gateway's own reported cost, as the decimal string it sent. */
  costUsd: string | null
}

export interface EvaluateOptions {
  key: string | null
  /** A short name for the one log line — `reflex`, `audit`. Never reader text. */
  label: string
  signal?: AbortSignal
  timeoutMs?: number
  /** Injected in tests. Nothing in CI reaches the network. */
  fetchImpl?: typeof fetch
  /** Tests and the eval pass true to run with the switch off. */
  force?: boolean
}

/**
 * Ask Jev, or return `null`.
 *
 * `null` is the whole contract: switched off, no key, aborted, over the
 * deadline, a non-200, an answer missing a question or of the wrong type — all
 * the same null, all meaning "do what you did before". It never throws.
 *
 * ONE LOG LINE, and nothing in it came from the reader: the label, the outcome,
 * the milliseconds, the token count and the Gateway's cost. The state and the
 * answers are not logged.
 */
export async function evaluate<K extends string>(
  state: unknown,
  questions: Record<K, Question>,
  opts: EvaluateOptions,
): Promise<Judgment<K> | null> {
  if (!opts.force && jevStatus() !== 'on') return null
  if (!opts.key || opts.signal?.aborted) return null
  const timeoutMs = opts.timeoutMs ?? jevTimeoutMs()
  const ac = new AbortController()
  const onAbort = () => ac.abort()
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  // Cleared on settle, for the reason `withDeadline` in api/chat.mjs gives: a
  // timer left running holds a serverless instance for the full deadline after
  // an answer that came back in a fifth of it.
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  const started = Date.now()
  let outcome = 'error'
  let result: Judgment<K> | null = null
  try {
    const res = await (opts.fetchImpl ?? fetch)(EVALUATE_URL, {
      method: 'POST',
      signal: ac.signal,
      headers: { authorization: `Bearer ${opts.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: EVALUATION.id,
        state,
        questions,
        providerOptions: { gateway: { zeroDataRetention: true, only: ['typesafe-ai'] } },
      }),
    })
    if (!res.ok) {
      outcome = `http_${res.status}`
    } else {
      const body = (await res.json()) as {
        answers?: Record<string, unknown>
        usage?: { inputTokens?: unknown }
        providerMetadata?: { gateway?: { cost?: unknown }; typesafe?: { confidence?: Record<string, unknown> } }
      }
      const answers = readAnswers(questions, body)
      if (answers) {
        outcome = 'ok'
        const tokens = body.usage?.inputTokens
        const cost = body.providerMetadata?.gateway?.cost
        result = {
          answers,
          ms: Date.now() - started,
          inputTokens: typeof tokens === 'number' && Number.isSafeInteger(tokens) ? tokens : null,
          costUsd: typeof cost === 'string' && /^\d{1,6}(\.\d{1,15})?$/.test(cost) ? cost : null,
        }
      } else {
        outcome = 'malformed'
      }
    }
  } catch {
    outcome = ac.signal.aborted ? (opts.signal?.aborted ? 'aborted' : 'timeout') : 'error'
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
  console.info(
    `[deck-e] jev ${opts.label} ${outcome} ${Date.now() - started}ms` +
      (result ? ` in=${result.inputTokens ?? '?'} cost=${result.costUsd ?? '?'}` : ''),
  )
  return result
}

/**
 * Every asked question, answered with the type it was asked as, or null.
 *
 * A choice must name one of the offered options and carry a probability for
 * it; confidence is optional (booleans never have one). Anything else is a
 * malformed answer, and a malformed answer is not evidence of anything.
 */
function readAnswers<K extends string>(
  questions: Record<K, Question>,
  body: { answers?: Record<string, unknown>; providerMetadata?: { typesafe?: { confidence?: Record<string, unknown> } } },
): Record<K, Answer> | null {
  const out = {} as Record<K, Answer>
  for (const key of Object.keys(questions) as K[]) {
    const q = questions[key]
    const a = body.answers?.[key] as Record<string, unknown> | undefined
    if (!a || a.type !== q.type) return null
    if (q.type === 'boolean') {
      if (!isProbability(a.probability)) return null
      out[key] = { type: 'boolean', probability: a.probability }
      continue
    }
    const choice = a.choice
    const probabilities = a.probabilities as Record<string, unknown> | undefined
    if (typeof choice !== 'string' || !(choice in q.criteria) || !probabilities) return null
    const probs: Record<string, number> = {}
    for (const option of Object.keys(q.criteria)) {
      const p = probabilities[option]
      probs[option] = isProbability(p) ? p : 0
    }
    const c = a.confidence ?? body.providerMetadata?.typesafe?.confidence?.[key]
    out[key] = { type: 'choice', choice, probabilities: probs, confidence: isProbability(c) ? c : null }
  }
  return out
}

function isProbability(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
}

/** The chosen option, if Jev picked it with at least this probability and confidence. */
export function confidentChoice(a: Answer | undefined, minP: number, minConfidence: number): string | null {
  if (!a || a.type !== 'choice') return null
  const p = a.probabilities[a.choice] ?? 0
  if (p < minP) return null
  if (a.confidence !== null && a.confidence < minConfidence) return null
  return a.choice
}

/** A boolean answered true with at least this probability. */
export function confidentTrue(a: Answer | undefined, minP: number): boolean {
  return !!a && a.type === 'boolean' && a.probability >= minP
}
