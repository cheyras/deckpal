import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

export const isCloudMode = !!supabaseUrl

// In self-host mode (no Supabase URL), create a stub client that does nothing.
// This avoids the "supabaseUrl is required" error from @supabase/supabase-js.
export const supabase: SupabaseClient = isCloudMode
  ? createClient(supabaseUrl, supabaseAnonKey)
  : createClient('http://localhost', 'stub-key-for-self-host')
