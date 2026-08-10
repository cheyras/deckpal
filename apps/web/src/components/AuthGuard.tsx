import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { supabase, isCloudMode } from '../lib/supabase'
import type { Session } from '@supabase/supabase-js'

export function AuthGuard({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(
    isCloudMode ? undefined : null,
  )
  const navigate = useNavigate()
  // Did this guard ever hold a session? Arriving signed-out and *losing* a
  // session are different events and deserve different destinations.
  const hadSession = useRef(false)

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
    if (!isCloudMode) return
    if (session) {
      hadSession.current = true
      return
    }
    if (session === null) {
      // Signing out (here or in another tab) and an expiring session both land
      // on the confirmation page — "you're signed out" is true of both, and it
      // is what Profile's Sign out navigates to, so the two cannot race to
      // different destinations. Someone who was never signed in gets the form.
      navigate({ to: hadSession.current ? '/signed-out' : '/auth' })
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
