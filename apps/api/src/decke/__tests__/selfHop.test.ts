/**
 * Most of Deck-E's data tools failed on a protected preview, and one missing
 * branch was the whole cause.
 *
 * `ctx.api` is how 17 of the tools reach deckpal-api — `decks`, `lists`,
 * `battle_logs`, `deck_history`, `mutation_history`, `revert`, `set_cart`,
 * every deck and list write. The chat function calls its OWN deployment over
 * the public hostname to make those, so anything guarding that hostname guards
 * the self-hop.
 *
 * Deployment Protection was already handled for `x-vercel-protection-bypass`,
 * which curl and the visual harness send. A person in a browser sends neither:
 * they arrive through Vercel SSO, which leaves a `_vercel_jwt` COOKIE. So the
 * forward found nothing, and every one of those tools was answered with an SSO
 * redirect instead of JSON. Reported from real use as "there are a lot of failed
 * calls; browsing decks always fails, battle logs fails".
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { selfHopHeadersFor } from '../ctx.js'

/** A minimal stand-in for the `Headers` of a web `Request`. */
const headers = (map: Record<string, string>) => ({
  get: (name: string) => map[name.toLowerCase()] ?? null,
})

test('the bypass header still wins, because automation depends on it', () => {
  assert.deepEqual(
    selfHopHeadersFor(headers({ 'x-vercel-protection-bypass': 'tok' })),
    { 'x-vercel-protection-bypass': 'tok' },
  )
})

test('a browser session forwards its Vercel SSO cookie — the fix', () => {
  assert.deepEqual(selfHopHeadersFor(headers({ cookie: '_vercel_jwt=abc123' })), {
    cookie: '_vercel_jwt=abc123',
  })
})

test('it is found among other cookies, and whitespace does not defeat it', () => {
  assert.deepEqual(
    selfHopHeadersFor(headers({ cookie: 'sb-access-token=xyz; _vercel_jwt=abc ; other=1' })),
    { cookie: '_vercel_jwt=abc' },
  )
})

test('ONLY `_vercel_jwt` is forwarded, never the whole jar', () => {
  // The jar can carry anything else the origin has set — a Supabase session,
  // for one. A blanket forward would hand all of it to an outbound call that
  // needs exactly one value.
  const out = selfHopHeadersFor(
    headers({ cookie: 'sb-access-token=SECRET; _vercel_jwt=abc; analytics=nope' }),
  )
  assert.equal(out?.cookie, '_vercel_jwt=abc')
  assert.ok(!JSON.stringify(out).includes('SECRET'), 'a user session leaked into the self-hop')
  assert.ok(!JSON.stringify(out).includes('analytics'))
})

test('production forwards nothing, because there is nothing to bypass', () => {
  // Present exactly when the platform put it there. An unprotected deployment
  // sends neither, and the self-hop must not invent a header.
  assert.equal(selfHopHeadersFor(headers({})), undefined)
  assert.equal(selfHopHeadersFor(headers({ cookie: 'sb-access-token=xyz' })), undefined)
  assert.equal(selfHopHeadersFor(undefined), undefined)
})

test('a name that merely contains the cookie name is not the cookie', () => {
  // `not_vercel_jwt` and `_vercel_jwt_old` both contain it as a substring. A
  // `startsWith`/`includes` implementation would forward the wrong value, and
  // the failure would look exactly like the bug this fixes.
  assert.equal(selfHopHeadersFor(headers({ cookie: 'not_vercel_jwt=abc' })), undefined)
  assert.equal(selfHopHeadersFor(headers({ cookie: '_vercel_jwt_old=abc' })), undefined)
})

test('an empty value is not a credential', () => {
  assert.equal(selfHopHeadersFor(headers({ cookie: '_vercel_jwt=' })), undefined)
  assert.equal(selfHopHeadersFor(headers({ cookie: '_vercel_jwt=   ' })), undefined)
})

test('a malformed jar does not throw', () => {
  // Cookie headers are attacker-influenceable. A throw here takes down the turn.
  assert.equal(selfHopHeadersFor(headers({ cookie: ';;;' })), undefined)
  assert.equal(selfHopHeadersFor(headers({ cookie: 'novalue' })), undefined)
  assert.deepEqual(selfHopHeadersFor(headers({ cookie: ';_vercel_jwt=a;;' })), {
    cookie: '_vercel_jwt=a',
  })
})
