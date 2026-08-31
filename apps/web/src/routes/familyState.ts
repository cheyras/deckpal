import type { FamilyContext, FamilyMemberSummary } from '../lib/api'

export function sortFamilyMembers(members: FamilyMemberSummary[]): FamilyMemberSummary[] {
  return [...members].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'admin' ? -1 : 1
    return (a.displayName ?? a.username).localeCompare(b.displayName ?? b.username)
  })
}

export function canOpenFamilyAdmin(family: FamilyContext | null | undefined): boolean {
  return family?.role === 'admin' && family.status === 'active'
}

export function selectedFamilyMember(
  members: FamilyMemberSummary[],
  selectedUserId: string | null,
): FamilyMemberSummary | null {
  return members.find((member) => member.userId === selectedUserId) ?? members[0] ?? null
}
