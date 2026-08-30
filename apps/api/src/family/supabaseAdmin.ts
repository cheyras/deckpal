import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { ApiError } from '../http.js'

let cached: SupabaseClient | null | undefined
let warned = false

export function supabaseAdminStatus(): 'configured' | 'unset' {
  return process.env.VITE_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? 'configured'
    : 'unset'
}

export function getSupabaseAdmin(): SupabaseClient | null {
  if (cached !== undefined) return cached
  const url = process.env.VITE_SUPABASE_URL
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRole) {
    if (!warned) {
      warned = true
      console.warn('[deckpal-family] Supabase admin invitation service is not configured')
    }
    cached = null
    return null
  }
  cached = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return cached
}

export function requireSupabaseAdmin(): SupabaseClient {
  const client = getSupabaseAdmin()
  if (!client) {
    throw new ApiError(503, 'family_invites_unconfigured', 'Family invitation email is not configured')
  }
  return client
}

export function normalizeInvitationEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    throw new ApiError(400, 'invalid_email', 'Enter a valid email address')
  }
  return email
}

export function invitationExpiry(now = new Date()): Date {
  return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
}

export function resetSupabaseAdminForTests(): void {
  cached = undefined
  warned = false
}
