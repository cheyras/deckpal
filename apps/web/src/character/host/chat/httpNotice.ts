/**
 * What he says when the server refuses a turn — and the one thing to press.
 *
 * ── WHY EACH NOTICE CARRIES AN ACTION ────────────────────────────────────────
 *
 * UXD-08, photographed at 390: a 500 said *"Try that again in a moment"* with no
 * way to, and the question had to be retyped; a 429 said *"Top up and I can pick
 * this straight back up"* with no Top up. `DeckeNotice` has taken an action since
 * it was written. Nothing was ever handed one.
 *
 * ── AND WHY THE 429 IS READ, NOT ASSUMED ─────────────────────────────────────
 *
 * The server's refusal body already says which of three things happened — out
 * of credits, credits on hold, or the legacy daily cap — and the browser threw
 * it away and said "Top up" to all three. A wallet on payment hold cannot buy
 * credits ("Purchases are on hold…" on the wallet page), so telling it to top up
 * sent the reader to a button that would refuse them. Each case now names its
 * own way forward, and a case with none offers none.
 *
 * ── X2 ───────────────────────────────────────────────────────────────────────
 *
 * Numbers come off the body; sentences are fixed here. `held` is a flag the
 * server sets, never inferred from its prose. A missing or malformed field
 * reads as absent, so an older server degrades to the plain out-of-credits
 * sentence rather than to a guess.
 */
import type { NoticeTone } from './DeckeNotice'

/** What the notice's one button does. `DeckeChat` owns the handlers. */
export type NoticeAction = 'retry' | 'top-up' | 'wallet'

export type Notice = { tone: NoticeTone; title: string; detail?: string; action?: NoticeAction }

/** The JSON a refused `/api/chat` answers with, as far as the browser trusts it. */
export type RefusalBody = {
  error?: unknown
  retryAfterDay?: unknown
  credits?: { balance?: unknown; needed?: unknown; held?: unknown } | null
} | null

const count = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null

const credits = (n: number) => `${n} credit${n === 1 ? '' : 's'}`

export function httpNotice(status: number, body: RefusalBody = null): Notice {
  if (status === 503) return { tone: 'neutral', title: "I'm not switched on for this deployment yet." }
  if (status === 401) return { tone: 'neutral', title: 'You need to be signed in for me to help.' }
  if (status === 403) return { tone: 'neutral', title: "I'm not available on this account yet." }
  // The body bound: a message too long to read. Retrying the same text fails
  // the same way, so there is nothing to press.
  if (status === 413) {
    return { tone: 'neutral', title: "That's more than I can read in one go.", detail: 'Nothing was sent. Try something shorter.' }
  }
  if (status === 429) {
    const c = body?.credits ?? null
    if (c?.held === true) {
      return {
        tone: 'limit',
        title: 'Your credits are on hold while a payment issue is sorted out.',
        detail: 'Nothing was spent. Your credit wallet has the details.',
        action: 'wallet',
      }
    }
    if (body?.retryAfterDay === true) {
      // The legacy daily cap comes back on its own; there is nothing to buy.
      return { tone: 'limit', title: "I've done as much as I can for today.", detail: 'Ask me again tomorrow.' }
    }
    const needed = count(c?.needed)
    const balance = count(c?.balance)
    return {
      tone: 'limit',
      title: "I'm out of credits for now.",
      detail:
        needed != null && balance != null
          ? `A reply takes ${credits(needed)} and you have ${balance}.`
          : 'Top up and I can pick this straight back up.',
      action: 'top-up',
    }
  }
  return {
    tone: 'error',
    title: 'Something went wrong reaching my brain.',
    detail: 'Nothing was written.',
    action: 'retry',
  }
}
