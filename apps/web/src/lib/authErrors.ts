/* ─────────────────────────────────────────────────────────────────────────────
 * Supabase Auth → human copy.
 *
 * GoTrue's own strings are written for developers ("Invalid login credentials",
 * "For security purposes, you can only request this after 47 seconds") and a
 * couple of them are actively misleading to an end user. Every auth surface in
 * the app funnels its failures through `friendlyAuthError` so the same failure
 * always reads the same way, and so a raw API string can never reach the UI.
 *
 * Codes are matched on `error.code` — GoTrue's stable machine-readable
 * `error_code`, surfaced by supabase-js as `AuthError.code` (the full union
 * lives in @supabase/auth-js `lib/error-codes`). supabase-js does not re-export
 * the AuthError class, so this narrows structurally rather than with
 * `instanceof` — that also means a plain `{ code, message }` from a hand-rolled
 * fetch maps identically.
 *
 * The policy numbers below are the project's real Supabase config, read from
 * the Management API on 2026-08-10:
 *   password_min_length = 6, password_required_characters = null
 *   mailer_autoconfirm  = false  (a confirmation email is required)
 *   rate_limit_email_sent = 2 per hour  (built-in SMTP — see RATE_LIMIT_HINT)
 *   mailer_otp_exp = 3600  (recovery links are valid for one hour)
 * ───────────────────────────────────────────────────────────────────────────── */

/** Supabase `password_min_length` for this project. */
export const PASSWORD_MIN_LENGTH = 6

/**
 * Shown wherever an email send can be throttled. The project runs on Supabase's
 * built-in SMTP, which allows 2 messages/hour across the whole project — so
 * "try again in a few minutes" is the honest thing to say, not "failed".
 */
export const RATE_LIMIT_HINT =
  'Too many requests right now. Wait a few minutes and try again.'

interface AuthErrorish {
  code?: string
  status?: number
  message?: string
  name?: string
}

function asAuthError(err: unknown): AuthErrorish {
  if (typeof err !== 'object' || err === null) return {}
  const e = err as Record<string, unknown>
  return {
    code: typeof e.code === 'string' ? e.code : undefined,
    status: typeof e.status === 'number' ? e.status : undefined,
    message: typeof e.message === 'string' ? e.message : undefined,
    name: typeof e.name === 'string' ? e.name : undefined,
  }
}

/**
 * GoTrue's throttle message carries the wait in seconds:
 *   "For security purposes, you can only request this after 47 seconds."
 * Quoting the real number beats a vague "in a few minutes" when we have it.
 */
function retryAfterSeconds(message: string | undefined): number | null {
  const m = /after (\d+) seconds?/i.exec(message ?? '')
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

function rateLimitCopy(message: string | undefined): string {
  const secs = retryAfterSeconds(message)
  if (secs === null) return RATE_LIMIT_HINT
  if (secs < 60) return `Too many requests. Try again in ${secs} seconds.`
  const mins = Math.ceil(secs / 60)
  return `Too many requests. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`
}

/** Maps any thrown auth failure to one sentence a person can act on. */
export function friendlyAuthError(err: unknown): string {
  const { code, status, message, name } = asAuthError(err)

  // Network/offline — supabase-js retries fetch failures then throws this.
  if (name === 'AuthRetryableFetchError' || name === 'TypeError') {
    return "Couldn't reach DeckPal. Check your connection and try again."
  }

  switch (code) {
    case 'invalid_credentials':
      return "That email and password don't match an account. Check them and try again."
    case 'email_not_confirmed':
      return 'This account still needs confirming. Open the link in the email we sent you, then sign in.'
    case 'user_already_exists':
    case 'email_exists':
      return 'An account already uses that email. Sign in instead, or reset your password.'
    case 'user_not_found':
      return 'No account matches that email.'
    case 'user_banned':
      return 'This account is suspended. Contact support if you think that is a mistake.'
    case 'weak_password':
      return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
    case 'same_password':
      return 'That is already your password. Choose a different one.'
    case 'validation_failed':
    case 'email_address_invalid':
      return "That email address doesn't look valid."
    case 'email_address_not_authorized':
      return 'That email address is not allowed to sign up.'
    case 'signup_disabled':
    case 'email_provider_disabled':
    case 'provider_disabled':
      return 'New accounts are closed right now. Try again later.'
    case 'otp_expired':
    case 'flow_state_expired':
      return 'That link has expired. Request a new one and use it within the hour.'
    case 'session_expired':
    case 'session_not_found':
    case 'refresh_token_not_found':
    case 'refresh_token_already_used':
    case 'bad_jwt':
      return 'Your session has expired. Sign in again to continue.'
    case 'reauthentication_needed':
      return 'For security, sign in again before changing your password.'
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
    case 'over_sms_send_rate_limit':
      return rateLimitCopy(message)
    case 'captcha_failed':
      return 'The security check failed. Reload the page and try again.'
    case 'request_timeout':
      return 'That took too long. Try again.'
    default:
      break
  }

  // Some throttles arrive as a bare 429 with no code.
  if (status === 429) return rateLimitCopy(message)

  // Older GoTrue builds (and the /verify redirect) can send the message without
  // a code; match the two that actually reach users.
  if (message) {
    const m = message.toLowerCase()
    if (m.includes('invalid login credentials')) {
      return "That email and password don't match an account. Check them and try again."
    }
    if (m.includes('email not confirmed')) {
      return 'This account still needs confirming. Open the link in the email we sent you, then sign in.'
    }
    if (m.includes('already registered')) {
      return 'An account already uses that email. Sign in instead, or reset your password.'
    }
    if (m.includes('for security purposes')) return rateLimitCopy(message)
  }

  return 'Something went wrong. Please try again.'
}

/**
 * Deliberately permissive: the browser already applies HTML5 `type="email"`
 * validation, and the authority on whether an address exists is the
 * confirmation email. This only catches the obvious typo (no @, no dot in the
 * domain, stray whitespace) before we spend a network round-trip on it.
 */
export function emailProblem(email: string): string | null {
  const value = email.trim()
  if (!value) return 'Enter your email address.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return "That email address doesn't look valid."
  return null
}

/** Client-side mirror of Supabase's `password_min_length`. */
export function passwordProblem(password: string): string | null {
  if (!password) return 'Enter a password.'
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
  }
  return null
}
