import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  familyContext,
  requireActiveFamily,
  requireFamilyAdmin,
  type FamilyContextReader,
} from '../access.js'
import { ApiError } from '../../http.js'

const row = (overrides: Record<string, string> = {}) => ({
  family_id: '4a4b19ac-73f5-4c53-99c4-bad2a3383931',
  family_name: 'Keluarga',
  role: 'admin' as const,
  status: 'active' as const,
  ...overrides,
})

test('no membership returns null', async () => {
  const read: FamilyContextReader = async () => null
  assert.equal(await familyContext('user-a', read), null)
})

test('disabled membership is rejected', async () => {
  const read = (async () => row({ status: 'disabled' })) as FamilyContextReader
  await assert.rejects(() => requireActiveFamily('user-a', read), (error) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.code, 'active_family_required')
    return true
  })
})

test('an active member cannot use administrator actions', async () => {
  const read = (async () => row({ role: 'member' })) as FamilyContextReader
  await assert.rejects(() => requireFamilyAdmin('user-a', read), (error) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.code, 'family_admin_required')
    return true
  })
})

test('an active administrator receives their family context', async () => {
  const read = (async () => row()) as FamilyContextReader
  const context = await requireFamilyAdmin('user-a', read)
  assert.equal(context.role, 'admin')
  assert.equal(context.familyName, 'Keluarga')
})
