/** Compatibility entry points; authorization comes from current server permissions. */
import { hasPermission, useAccess, invalidateAccess, ACCESS_CHANGED } from './access'
export const ownerEntitled = () => hasPermission('scanner.use')
export const resetOwnerEntitlement = invalidateAccess
export function onOwnerEntitlementChange(fn: () => void): () => void {
  window.addEventListener(ACCESS_CHANGED, fn)
  return () => window.removeEventListener(ACCESS_CHANGED, fn)
}
export function useOwnerEntitled(): boolean | undefined {
  const access = useAccess()
  return access.ready ? access.permissions.includes('scanner.use') : undefined
}
