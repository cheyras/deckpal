import type { SupabaseClient, User } from '@supabase/supabase-js'

export interface ActiveFamilyIdentity {
  user: User
  familyId: string
  role: 'admin' | 'member'
}

export function bearerToken(request: Request): string | null {
  const value = request.headers.get('authorization')?.trim() ?? ''
  const match = /^Bearer\s+(\S+)$/i.exec(value)
  return match?.[1] ?? null
}

/** Authenticate with Supabase and enforce the same active-family boundary as the API. */
export async function requireActiveFamilyIdentity(
  request: Request,
  supabase: SupabaseClient,
): Promise<ActiveFamilyIdentity> {
  const token = bearerToken(request)
  if (!token) throw new FamilyAuthError(401, 'authentication_required')

  const { data: auth, error: authError } = await supabase.auth.getUser(token)
  if (authError || !auth.user) throw new FamilyAuthError(401, 'invalid_session')

  const { data: member, error: memberError } = await supabase
    .from('family_member')
    .select('family_id, role')
    .eq('user_id', auth.user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (memberError) throw new FamilyAuthError(503, 'family_lookup_failed')
  if (!member) throw new FamilyAuthError(403, 'active_family_required')

  return {
    user: auth.user,
    familyId: String(member.family_id),
    role: member.role === 'admin' ? 'admin' : 'member',
  }
}

export class FamilyAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
  }
}
