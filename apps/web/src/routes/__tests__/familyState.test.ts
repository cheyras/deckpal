import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { FamilyMemberSummary } from '../../lib/api'
import { canOpenFamilyAdmin, selectedFamilyMember, sortFamilyMembers } from '../familyState'

const member = (
  userId: string,
  username: string,
  role: 'admin' | 'member' = 'member',
): FamilyMemberSummary => ({
  userId,
  username,
  displayName: null,
  role,
  status: 'active',
  joinedAt: null,
  uniqueCards: 0,
  totalQuantity: 0,
})

test('family members sort admin first then by display name', () => {
  const sorted = sortFamilyMembers([
    member('2', 'Zain'),
    member('1', 'Admin', 'admin'),
    { ...member('3', 'user'), displayName: 'Aina' },
  ])
  assert.deepEqual(sorted.map((item) => item.userId), ['1', '3', '2'])
})

test('only an active admin can open family administration', () => {
  assert.equal(canOpenFamilyAdmin({ familyId: 'f', familyName: 'F', role: 'admin', status: 'active' }), true)
  assert.equal(canOpenFamilyAdmin({ familyId: 'f', familyName: 'F', role: 'member', status: 'active' }), false)
  assert.equal(canOpenFamilyAdmin({ familyId: 'f', familyName: 'F', role: 'admin', status: 'disabled' }), false)
})

test('selected member persists when still present and falls back safely', () => {
  const members = [member('1', 'A'), member('2', 'B')]
  assert.equal(selectedFamilyMember(members, '2')?.userId, '2')
  assert.equal(selectedFamilyMember(members, 'missing')?.userId, '1')
})
