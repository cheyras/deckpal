import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { markReturningVisitor } from './returningVisitor'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

export const isCloudMode = !!supabaseUrl

// In self-host mode (no Supabase URL), create a stub client that does nothing.
// This avoids the "supabaseUrl is required" error from @supabase/supabase-js.
export const supabase: SupabaseClient = isCloudMode
  ? createClient(supabaseUrl, supabaseAnonKey)
  : createClient('http://localhost', 'stub-key-for-self-host')

// The one place that owns the client is the one place that records a session
// has existed here (see returningVisitor.ts for what that is for). Subscribing
// once at module scope, rather than in each component that happens to watch
// auth, is what stops the several existing subscriptions drifting on whether
// they remembered to write it.
if (isCloudMode) {
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session) markReturningVisitor()
  })
}
