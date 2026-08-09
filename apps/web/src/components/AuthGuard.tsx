import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { supabase, isCloudMode } from '../lib/supabase'
import type { Session } from '@supabase/supabase-js'

export function AuthGuard({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(
    isCloudMode ? undefined : null,
  )
  const navigate = useNavigate()

  useEffect(() => {
    if (!isCloudMode) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session === null && isCloudMode) {
      navigate({ to: '/auth' })
    }
  }, [session, navigate])

  if (!isCloudMode) return <>{children}</>

  if (session === undefined) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-primary">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-action-primary border-t-transparent" />
      </div>
    )
  }

  if (session === null) return null

  return <>{children}</>
}
