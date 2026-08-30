import assert from 'node:assert/strict'
import test from 'node:test'

import { bearerToken, FamilyAuthError, requireActiveFamilyIdentity } from './family-auth.mts'

test('bearerToken accepts a single bearer token only', () => {
  assert.equal(bearerToken(new Request('https://example.test', { headers: { authorization: 'Bearer abc.123' } })), 'abc.123')
  assert.equal(bearerToken(new Request('https://example.test', { headers: { authorization: 'Basic abc' } })), null)
})

test('active family identity is resolved from the verified Supabase user', async () => {
  const client = {
    auth: { getUser: async (token: string) => ({ data: { user: { id: token } }, error: null }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { family_id: 'family-1', role: 'admin' }, error: null }) }),
        }),
      }),
    }),
  }
  const request = new Request('https://example.test', { headers: { authorization: 'Bearer user-1' } })
  const identity = await requireActiveFamilyIdentity(request, client as never)
  assert.equal(identity.user.id, 'user-1')
  assert.equal(identity.familyId, 'family-1')
  assert.equal(identity.role, 'admin')
})

test('missing bearer token is rejected before database access', async () => {
  await assert.rejects(
    () => requireActiveFamilyIdentity(new Request('https://example.test'), {} as never),
    (error: unknown) => error instanceof FamilyAuthError && error.status === 401,
  )
})
