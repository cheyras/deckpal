/**
 * Is Deck-E's brain configured on this deployment?
 *
 * Contract B11, applied deliberately rather than by rote. That rule exists
 * because `/design` shipped gated on `DESIGN_EDITOR_USER_ID`, the variable was
 * never set in production, and the gate correctly resolved to "nobody" —
 * silently, for four days. The failure was not the fail-closed default, which
 * is right; it was that a deployment-shaped mistake was invisible from both the
 * code and the running system.
 *
 * Deck-E is the same shape of risk, with a bill attached. So the same three
 * mitigations: the variable is declared in `DEPLOYMENT.md` in the commit that
 * reads it, its absence is reported on `GET /health`, and it is warned about
 * once at boot.
 */

/** Where the Gateway credential is read from. One name, one place. */
export const DECKE_KEY_VAR = 'DECKE_VERCEL_AI_GATEWAY_KEY'

export type DeckeGateStatus =
  /** A dedicated key is present. Deck-E is live. */
  | 'configured'
  /** No key at all. Deck-E is off, and every request 503s. */
  | 'unset'
  /** Dev only: running on the shared `AI_GATEWAY_API_KEY`. */
  | 'borrowed'

/**
 * NEVER returns the key, and never a prefix of it. Callers want to know whether
 * the feature can work, which is a different question from what the credential
 * is — and `/health` is unauthenticated.
 */
export function deckeGateStatus(): DeckeGateStatus {
  if (process.env[DECKE_KEY_VAR]) return 'configured'
  if (process.env.NODE_ENV !== 'production' && process.env.AI_GATEWAY_API_KEY) return 'borrowed'
  return 'unset'
}

/** The boot line. Returns null when there is nothing worth saying. */
export function deckeGateWarning(): string | null {
  switch (deckeGateStatus()) {
    case 'unset':
      return (
        `[deckpal-api] ${DECKE_KEY_VAR} is unset — Deck-E's chat is DISABLED and ` +
        `POST /api/chat will 503 for every user. Set it to a Vercel AI Gateway ` +
        `key with paid credits attached and redeploy.`
      )
    case 'borrowed':
      return (
        `[deckpal-api] ${DECKE_KEY_VAR} is unset; falling back to ` +
        `AI_GATEWAY_API_KEY. That key belongs to the marketing image generator, ` +
        `so Deck-E's spend will not be separable. Dev only — production never ` +
        `falls back.`
      )
    default:
      return null
  }
}
