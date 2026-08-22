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

/**
 * Are Deck-E's write approvals SIGNED?
 *
 * The SDK holds a write until an approval arrives — but it verifies that
 * approval's signature only when a secret is configured
 * (`ai/dist/index.js:5164`, read rather than assumed). Without one there is no
 * check at all: the approval is taken at face value.
 *
 * That matters here more than it would elsewhere, because this client is
 * hand-rolled and replays the whole conversation on every leg. A crafted caller
 * could append `state: 'approval-responded', approval: { approved: true }` to a
 * tool call it was never granted — or approve "add 1 card" and send back "add
 * 4000" against the same approval. The tool INPUT is inside the signature;
 * without the signature nothing binds the two together.
 *
 * Unsigned is not broken — it is what every deployment did until now — so this
 * does not fail closed and must not, or setting up a deployment would begin
 * with Deck-E being down. But it is a security control that is OFF, and B11
 * exists precisely because a control that is off silently is the expensive
 * kind.
 */
export function deckeApprovalSigning(): 'signed' | 'unsigned' {
  return process.env.DECKE_APPROVAL_SECRET ? 'signed' : 'unsigned'
}

/** The boot line. Returns null when there is nothing worth saying. */
/**
 * Said at boot when approvals are unsigned.
 *
 * Separate from `deckeGateWarning` because they are different states: that one
 * says the feature is OFF, this one says the feature is on with a control
 * disabled. Conflating them would let the more alarming message hide the
 * quieter, more dangerous one.
 */
export function deckeApprovalWarning(): string | null {
  if (deckeApprovalSigning() === 'signed') return null
  return (
    '[deckpal-api] DECKE_APPROVAL_SECRET is unset — Deck-E write approvals are ' +
    'NOT signed. The SDK still holds every write for a human, but nothing proves ' +
    'the approval it receives came from a request this server issued, so a ' +
    'crafted client could approve a write it was never offered or change the ' +
    'arguments after approval. Set it to a long random string and redeploy.'
  )
}

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
