import { hasPermission, invalidateAccess, ACCESS_CHANGED } from '../../lib/access'
import { isCloudMode } from '../../lib/supabase'
// The chat transport is cloud-only; permission cannot create a missing endpoint.
export async function deckeEntitled(): Promise<boolean> {
  if (!isCloudMode) return false
  return hasPermission('decke.use').catch(() => false)
}
export const resetDeckeEntitlement = invalidateAccess
export function onDeckeEntitlementChange(fn: () => void): () => void {
  const notify = () => { fn() }
  window.addEventListener(ACCESS_CHANGED, notify)
  return () => window.removeEventListener(ACCESS_CHANGED, notify)
}
