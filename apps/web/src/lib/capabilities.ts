/** A server-verified capability snapshot. No deployment or role-name shortcuts. */
export interface CapabilitySnapshot {
  permissions: readonly string[]
  ready: boolean
  error?: string
}

export function hasVerifiedPermission(access: CapabilitySnapshot, permission: string): boolean {
  if (!access.ready || access.error) throw new Error('Cannot verify account access. Please reload to try again.')
  return access.permissions.includes(permission)
}

/** Keep an unavailable identity distinct from a verified denial; neither opens the route. */
export async function requireVerifiedCapability(
  permission: string,
  loadAccess: () => Promise<CapabilitySnapshot>,
  denied: () => unknown,
): Promise<void> {
  if (!hasVerifiedPermission(await loadAccess(), permission)) throw denied()
}
