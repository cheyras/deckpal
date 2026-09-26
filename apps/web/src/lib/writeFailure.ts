import { DeadlineError } from './writeLane'

/**
 * The words for a write that did not save.
 *
 * A failure message is a HEADLINE the caller writes — what did not happen, in
 * the user's terms: `Couldn't add Charizard ex to “Trade binder”.` — plus, when
 * it helps, one sentence of why. The why is only added when it changes what the
 * person should do next (reconnect, wait, look elsewhere); a 500 says nothing
 * actionable beyond the headline, so it adds nothing.
 *
 * Pure (no api.ts import, `online` passed in) so the copy is unit-tested.
 */
export function failureReason(error: unknown, online: boolean): string | null {
  // Checked first: offline, every failure below is really this one, and it is
  // the only one with an obvious fix.
  if (!online) return "You're offline."
  if (error instanceof DeadlineError) return "DeckPal didn't answer in time."
  const status = statusOf(error)
  if (status !== null) {
    if (status === 401) return 'Your session has expired. Sign in again.'
    if (status === 403) return "Your account can't make this change."
    if (status === 404) return 'It may have been deleted.'
    if (status === 429) return 'Too many changes at once. Wait a moment, then try again.'
    // A 4xx names what was wrong with THIS request (a smart list refusing a
    // hand-added card, a name already taken), in words written for a reader.
    if (status >= 400 && status < 500) return asSentence((error as Error).message)
    return null
  }
  // fetch() rejects with a TypeError when the request never got an answer.
  if (error instanceof TypeError) return "DeckPal couldn't be reached. Check your connection."
  return null
}

export function failureMessage(headline: string, error: unknown, online: boolean): string {
  const reason = failureReason(error, online)
  return reason ? `${headline} ${reason}` : headline
}

// ApiError (lib/api.ts) is recognised by shape rather than by class, which keeps
// this module free of the API client and its environment.
function statusOf(error: unknown): number | null {
  if (!(error instanceof Error) || error.name !== 'ApiError') return null
  const status = (error as Error & { status?: unknown }).status
  return typeof status === 'number' ? status : null
}

function asSentence(message: string): string | null {
  const text = message.trim()
  if (!text) return null
  return /[.!?]$/.test(text) ? text : `${text}.`
}
