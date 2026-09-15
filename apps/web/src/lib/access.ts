import type { ActorCapabilities, FeatureAccess, RoleRef } from './adminTypes'
import { useSyncExternalStore } from 'react'
import { api } from './api'
import { isCloudMode, supabase } from './supabase'
import { readSession } from './authSession'
import { hasVerifiedPermission } from './capabilities'

export interface Access { role: RoleRef | null; isOwner: boolean; revision: string; actorCapabilities: ActorCapabilities; features: readonly FeatureAccess[]; permissions: readonly string[]; roles: readonly { id: string; name: string }[]; ready: boolean; identity: string; error?: string }
const EMPTY: Access = { role: null, isOwner: false, revision: '', actorCapabilities: { canEditRoles: false, canAssignRoles: false, canManageUserOverrides: false, canReadSharedConversations: false, assignableRoleIds: [] }, features: [], permissions: [], roles: [], ready: false, identity: '' }
let value = EMPTY
let pending: Promise<Access> | undefined
let expires = 0
let generation = 0
let identity = ''
const listeners = new Set<() => void>()
export const ACCESS_CHANGED = 'deckpal:access-changed'
export const IDENTITY_CHANGED = 'deckpal:identity-changed'
const emit = () => { for (const listener of listeners) listener() }
export function invalidateAccess(): void {
  generation++; expires = 0; pending = undefined
  value = { ...EMPTY, identity }; emit()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ACCESS_CHANGED))
    queueMicrotask(() => { void getAccess() })
  }
}
export function getAccess(force = false): Promise<Access> {
  if (!force && expires > Date.now()) return Promise.resolve(value)
  if (pending) return pending
  const version = generation
  pending = (async () => {
    let nextIdentity = 'selfhost'
    if (isCloudMode) {
      const { session } = await readSession()
      nextIdentity = session?.user.id ?? ''
    }
    if (version !== generation) return value
    if (identity !== nextIdentity) {
      identity = nextIdentity
      value = { ...EMPTY, identity }; emit()
      window.dispatchEvent(new Event(IDENTITY_CHANGED))
    }
    if (!nextIdentity) return { ...EMPTY, ready: true }
    const me = await api.me()
    return { role: me.role ?? null, isOwner: me.isOwner === true, revision: me.accessRevision ?? '', actorCapabilities: me.actorCapabilities ?? EMPTY.actorCapabilities, features: me.features ?? [], permissions: me.permissions ?? [], roles: me.role ? [me.role] : me.roles ?? [], ready: me.adminReady !== false, identity: nextIdentity }
  })().catch((error: unknown) => ({ ...EMPTY, ready: true, identity, error: error instanceof Error ? error.message : 'Unable to verify access.' })).then(next => {
    if (version === generation) {
      const changed = JSON.stringify([value.permissions, value.role, value.revision, value.actorCapabilities, value.features]) !== JSON.stringify([next.permissions, next.role, next.revision, next.actorCapabilities, next.features])
      value = next; expires = Date.now() + 20_000; pending = undefined; emit()
      if (changed) window.dispatchEvent(new Event(ACCESS_CHANGED))
    }
    return value
  })
  return pending
}
function subscribe(listener: () => void) {
  listeners.add(listener); void getAccess()
  return () => { listeners.delete(listener) }
}
export function useAccess(): Access { return useSyncExternalStore(subscribe, () => value, () => EMPTY) }
export function usePermission(key: string): boolean { return useAccess().permissions.includes(key) }
export async function hasPermission(key: string): Promise<boolean> { const access = await getAccess(); return hasVerifiedPermission(access, key) }
if (typeof window !== 'undefined') {
  window.addEventListener('deckpal:forbidden', () => { invalidateAccess(); void getAccess() })
  window.addEventListener('focus', () => { void getAccess(true) })
  window.setInterval(() => { if (listeners.size && document.visibilityState === 'visible') void getAccess() }, 20_000)
}
if (isCloudMode) supabase.auth.onAuthStateChange((_event, session) => {
  const next = session?.user.id ?? ''
  const changed = identity !== next
  identity = next
  if (changed) invalidateAccess()
  if (changed) window.dispatchEvent(new Event(IDENTITY_CHANGED))
  // No Supabase calls inside its auth-state callback (its auth lock is held).
  window.setTimeout(() => { void getAccess(true) }, 0)
})
