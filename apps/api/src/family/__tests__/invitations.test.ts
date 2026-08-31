import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import { ApiError } from '../../http.js'
import {
  invitationExpiry,
  normalizeInvitationEmail,
  requireSupabaseAdmin,
  resetSupabaseAdminForTests,
} from '../supabaseAdmin.js'

const saved = {
  url: process.env.VITE_SUPABASE_URL,
  key: process.env.SUPABASE_SERVICE_ROLE_KEY,
}

afterEach(() => {
  if (saved.url === undefined) delete process.env.VITE_SUPABASE_URL
  else process.env.VITE_SUPABASE_URL = saved.url
  if (saved.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
  else process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key
  resetSupabaseAdminForTests()
})

test('invitation email is trimmed and normalized', () => {
  assert.equal(normalizeInvitationEmail('  Family.Member@Example.COM '), 'family.member@example.com')
})

test('invalid invitation email is rejected', () => {
  assert.throws(() => normalizeInvitationEmail('not-an-email'), ApiError)
})

test('invitations expire after seven days', () => {
  const start = new Date('2026-08-30T00:00:00.000Z')
  assert.equal(invitationExpiry(start).toISOString(), '2026-09-06T00:00:00.000Z')
})

test('missing service role fails closed', () => {
  delete process.env.VITE_SUPABASE_URL
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  assert.throws(() => requireSupabaseAdmin(), (error) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.status, 503)
    return true
  })
})
