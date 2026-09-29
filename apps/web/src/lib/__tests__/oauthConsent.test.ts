import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { ApiTokenRow } from '../api.js'
import { consentView, lifetimeText, redirectBadge, SCOPE_OPTIONS, supportsScopedConsent, tokenState } from '../oauthConsent.js'

// Security audit SEC-07: an app's registered name is a claim, the redirect is
// the truth. These pin what the consent screen and Profile say for each case.

const CLAUDE = { clientName: 'claudeai', redirectUri: 'https://claude.ai/api/mcp/auth_callback' }

describe('consent screen', () => {
  test('a verified callback is named by us, with no warning', () => {
    const v = consentView({ ...CLAUDE, redirectHost: 'claude.ai', trust: 'verified', verifiedName: 'Claude' })
    assert.equal(v.trust, 'verified')
    assert.equal(v.heading, 'Claude')
    assert.equal(v.badge, 'Verified')
    assert.equal(v.detail, 'Your approval goes to claude.ai.')
    assert.equal(v.caution, null)
    // The registered name is irrelevant once we know who it is.
    assert.doesNotMatch(JSON.stringify(v), /claudeai/)
  })

  test('a lookalike calling itself "Claude" leads with its host and is quoted, never named', () => {
    const v = consentView({ clientName: 'Claude', redirectUri: 'https://evil.example/cb', redirectHost: 'evil.example', trust: 'unverified', verifiedName: null })
    assert.equal(v.heading, 'evil.example')
    assert.equal(v.badge, 'Unverified')
    assert.equal(v.detail, 'Your approval goes to this site. It calls itself “Claude”, which DeckPal can’t confirm.')
    assert.ok(v.caution)
    assert.notEqual(v.heading, 'Claude')
  })

  test('a loopback callback is "an app on this computer", with the warning the MCP spec asks for', () => {
    const v = consentView({ clientName: 'Claude Code', redirectUri: 'http://localhost:3118/callback', redirectHost: 'localhost:3118', trust: 'local', verifiedName: null })
    assert.equal(v.heading, 'An app on this computer')
    assert.equal(v.badge, 'Unverified', 'any local program can claim any name')
    assert.match(v.detail, /“Claude Code”/)
    assert.match(v.detail, /localhost:3118/)
    assert.ok(v.caution)
  })

  test('an older server that sends no trust is read as unverified, host from the redirect', () => {
    const v = consentView({ clientName: 'Claude', redirectUri: 'https://claude.ai/api/mcp/auth_callback' })
    assert.equal(v.trust, 'unverified')
    assert.equal(v.heading, 'claude.ai')
    assert.match(v.detail, /calls itself “Claude”/)
  })

  test('"verified" without a name we supplied is not trusted', () => {
    const v = consentView({ ...CLAUDE, trust: 'verified', verifiedName: null })
    assert.equal(v.trust, 'unverified')
  })

  test('an empty registered name still reads as a claim', () => {
    assert.match(consentView({ clientName: ' ', redirectUri: 'https://x.example/cb' }).detail, /“an unnamed app”/)
  })

  test('full access is the first choice, read-only the second', () => {
    assert.deepEqual(SCOPE_OPTIONS.map((o) => o.value), ['full', 'read'])
  })

  test('only a server that sends redirect trust may offer read-only access', () => {
    const oldClient = { clientName: 'Claude', redirectUri: 'https://claude.ai/api/mcp/auth_callback' }
    assert.equal(supportsScopedConsent(oldClient), false)
    for (const trust of ['verified', 'unverified', 'local'] as const) {
      assert.equal(supportsScopedConsent({ ...oldClient, trust }), true)
    }
  })
})

describe('Profile → Agent access', () => {
  const NOW = Date.parse('2026-09-26T12:00:00Z')
  const base: ApiTokenRow = {
    id: 't',
    name: 'laptop',
    prefix: 'dsk_abcdefgh',
    createdAt: '2026-09-01T00:00:00Z',
    lastUsedAt: null,
    revokedAt: null,
    deckeImprovementRead: false,
  }

  test('a hand-made token, or any token from before expiry existed, has none', () => {
    assert.equal(tokenState(base, NOW), 'active')
    assert.equal(lifetimeText(base, NOW), 'No expiry')
    assert.equal(lifetimeText({ ...base, expiresAt: null }, NOW), 'No expiry')
    assert.equal(redirectBadge(base), null)
  })

  test('a connection in use says it renews, and when it would lapse', () => {
    const t: ApiTokenRow = {
      ...base,
      expiresAt: '2026-12-25T12:00:00Z',
      redirect: { host: 'claude.ai', trust: 'verified', verifiedName: 'Claude' },
    }
    assert.equal(tokenState(t, NOW), 'active')
    assert.match(lifetimeText(t, NOW), /^Renews while in use · ends .+ if unused$/)
    assert.equal(redirectBadge(t), 'Verified')
  })

  test('a lapsed connection is expired, not active, and says why', () => {
    const t: ApiTokenRow = { ...base, expiresAt: '2026-09-25T00:00:00Z', redirect: { host: 'evil.example', trust: 'unverified', verifiedName: null } }
    assert.equal(tokenState(t, NOW), 'expired')
    assert.match(lifetimeText(t, NOW), /^Ended .+ after going unused$/)
    assert.equal(redirectBadge(t), 'Unverified')
  })

  test('revoked wins over expired', () => {
    const t: ApiTokenRow = { ...base, revokedAt: '2026-09-20T00:00:00Z', expiresAt: '2026-09-25T00:00:00Z' }
    assert.equal(tokenState(t, NOW), 'revoked')
    assert.match(lifetimeText(t, NOW), /^Revoked /)
  })
})
