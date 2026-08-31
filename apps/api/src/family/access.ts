import type { QueryResultRow } from 'pg'

import { q1 } from '../db.js'
import { ApiError } from '../http.js'

export type FamilyRole = 'admin' | 'member'
export type FamilyMemberStatus = 'invited' | 'active' | 'disabled'

export interface FamilyContext {
  familyId: string
  familyName: string
  role: FamilyRole
  status: FamilyMemberStatus
}

interface FamilyContextRow extends QueryResultRow {
  family_id: string
  family_name: string
  role: FamilyRole
  status: FamilyMemberStatus
}

export type FamilyContextReader = (
  userId: string,
) => Promise<FamilyContextRow | null>

const readFamilyContext: FamilyContextReader = (userId) =>
  q1<FamilyContextRow>(
    `SELECT fm.family_id, f.name AS family_name, fm.role, fm.status
       FROM family_member fm
       JOIN family f ON f.id = fm.family_id
      WHERE fm.user_id = $1`,
    [userId],
  )

export async function familyContext(
  userId: string,
  read: FamilyContextReader = readFamilyContext,
): Promise<FamilyContext | null> {
  const row = await read(userId)
  if (!row) return null
  return {
    familyId: row.family_id,
    familyName: row.family_name,
    role: row.role,
    status: row.status,
  }
}

export async function requireActiveFamily(
  userId: string,
  read: FamilyContextReader = readFamilyContext,
): Promise<FamilyContext> {
  const context = await familyContext(userId, read)
  if (!context || context.status !== 'active') {
    throw new ApiError(403, 'active_family_required', 'Active family membership required')
  }
  return context
}

export async function requireFamilyAdmin(
  userId: string,
  read: FamilyContextReader = readFamilyContext,
): Promise<FamilyContext> {
  const context = await requireActiveFamily(userId, read)
  if (context.role !== 'admin') {
    throw new ApiError(403, 'family_admin_required', 'Family administrator access required')
  }
  return context
}

export function familyOwnerGateStatus(): 'configured' | 'unset' {
  return process.env.FAMILY_OWNER_USER_ID ? 'configured' : 'unset'
}
