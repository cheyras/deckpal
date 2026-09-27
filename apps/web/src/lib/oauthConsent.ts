/* ─────────────────────────────────────────────────────────────────────────────
 * What the consent screen and Profile → Agent access say about a connection.
 *
 * Kept apart from the components so the decisions — who we name, which badge,
 * which warning — are plain functions with their own tests, and the two
 * screens cannot describe the same connection two different ways.
 *
 * The rule (security audit SEC-07): an app's name is something it typed when
 * it registered, so it is only ever quoted as a claim. What a person is really
 * trusting is the host their approval is sent to, so that leads. We name an
 * app ourselves only when the server recognised its exact callback.
 * ───────────────────────────────────────────────────────────────────────────── */
import type { ApiTokenRow, OAuthClientInfo, RedirectTrust } from './api'

export type ConsentScope = 'full' | 'read'

export interface ConsentView {
  trust: RedirectTrust
  /** The identity card's name line: our name for a verified app, otherwise where the approval goes. */
  heading: string
  badge: string
  /** Where the approval goes, and the app's own claim when we can't vouch for it. */
  detail: string
  /** An extra warning, or null when there is nothing to add. */
  caution: string | null
}

function hostOf(uri: string): string {
  try {
    return new URL(uri).host
  } catch {
    return uri
  }
}

export function consentView(client: OAuthClientInfo): ConsentView {
  const host = client.redirectHost ?? hostOf(client.redirectUri)
  const claimed = client.clientName.trim() || 'an unnamed app'
  // An older server sends no `trust`. Unverified is the only safe reading.
  const trust: RedirectTrust = client.trust ?? 'unverified'

  if (trust === 'verified' && client.verifiedName) {
    return { trust, heading: client.verifiedName, badge: 'Verified', detail: `Your approval goes to ${host}.`, caution: null }
  }
  if (trust === 'local') {
    return {
      trust,
      heading: 'An app on this computer',
      badge: 'Unverified',
      detail: `It calls itself “${claimed}” and receives your approval at ${host}.`,
      caution: 'Any program on this computer can ask this way. Approve only if you just started this yourself, from an app like Claude Code.',
    }
  }
  return {
    trust: 'unverified',
    heading: host,
    badge: 'Unverified',
    detail: `Your approval goes to this site. It calls itself “${claimed}”, which DeckPal can’t confirm.`,
    caution: 'Approve only if you trust this site.',
  }
}

export const SCOPE_OPTIONS: ReadonlyArray<{ value: ConsentScope; label: string; detail: string }> = [
  { value: 'full', label: 'Read and change', detail: 'See and update your collection, decks, lists and battle logs.' },
  { value: 'read', label: 'Read only', detail: 'See them, but change nothing.' },
]

/** Older APIs omit trust and ignore scope, so only promise a choice when the API can enforce it. */
export function supportsScopedConsent(client: OAuthClientInfo): boolean {
  return client.trust === 'verified' || client.trust === 'unverified' || client.trust === 'local'
}

// ── Profile → Agent access ─────────────────────────────────────────────────

export type TokenState = 'active' | 'expired' | 'revoked'

export function tokenState(t: ApiTokenRow, now: number = Date.now()): TokenState {
  if (t.revokedAt) return 'revoked'
  if (t.expiresAt && Date.parse(t.expiresAt) <= now) return 'expired'
  return 'active'
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * The lifetime clause of a token's row. An OAuth connection renews itself
 * whenever its app uses it, so the date shown is the one it lapses on if the
 * app stops; a hand-made token (and any connection made before expiry existed)
 * simply has none.
 */
export function lifetimeText(t: ApiTokenRow, now: number = Date.now()): string {
  const state = tokenState(t, now)
  if (state === 'revoked') return `Revoked ${shortDate(t.revokedAt!)}`
  if (!t.expiresAt) return 'No expiry'
  if (state === 'expired') return `Ended ${shortDate(t.expiresAt)} after going unused`
  return t.redirect ? `Renews while in use · ends ${shortDate(t.expiresAt)} if unused` : `Expires ${shortDate(t.expiresAt)}`
}

/** The badge beside an OAuth connection: the same word the consent screen used. */
export function redirectBadge(t: ApiTokenRow): 'Verified' | 'Unverified' | null {
  if (!t.redirect) return null
  return t.redirect.trust === 'verified' ? 'Verified' : 'Unverified'
}
