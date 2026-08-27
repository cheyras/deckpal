import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { supabase, isCloudMode } from '../lib/supabase'
import { readSession, SESSION_DEADLINE_MS } from '../lib/authSession'
import { Spinner } from './ui'
import { StatusPanel } from './ui/StatusPanel'
import { Button } from './ui/Button'
import type { Session } from '@supabase/supabase-js'

export function AuthGuard({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(
    isCloudMode ? undefined : null,
  )
  // The session read passed its deadline and there is still no answer. This is
  // NOT `session === null`, and that distinction is the whole point: reading a
  // stalled network as a sign-out is how a bad connection becomes a logout
  // (issue #75, lib/sessionDeadline.ts). It is a display state only — the read
  // is still in flight, and `onLate` clears it the moment it lands.
  const [stalled, setStalled] = useState(false)
  const navigate = useNavigate()
  // Did this guard ever hold a session? Arriving signed-out and *losing* a
  // session are different events and deserve different destinations.
  const hadSession = useRef(false)

  useEffect(() => {
    if (!isCloudMode) return
    let live = true
    const settle = (s: Session | null) => {
      if (!live) return
      setStalled(false)
      setSession(s)
    }
    void readSession(settle).then(({ session: s, timedOut }) => {
      if (timedOut) {
        if (live) setStalled(true)
        return
      }
      settle(s)
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      settle(s)
    })
    return () => {
      live = false
      subscription.unsubscribe()
    }
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
    // Past the deadline, say so and offer the one action that helps, rather
    // than spinning forever. Deliberately NOT a redirect: this branch is
    // reached because the network did not answer, and bouncing a signed-in
    // visitor to /auth over a bad connection is worse than the blank screen it
    // replaces.
    if (stalled) {
      return (
        <div className="flex h-screen items-center justify-center bg-surface-primary px-[20px]">
          <div className="w-full max-w-[420px]">
            <StatusPanel
              icon="alert"
              tone="neutral"
              title="Still checking your session"
              actions={<Button onClick={() => window.location.reload()}>Reload</Button>}
            >
              <p>
                The sign-in service has not answered in{' '}
                {Math.round(SESSION_DEADLINE_MS / 1000)} seconds. You have not been signed out —
                this is a slow or stalled connection, and the page will carry on by itself if the
                answer arrives.
              </p>
            </StatusPanel>
          </div>
        </div>
      )
    }
    return (
      <div className="flex h-screen items-center justify-center bg-surface-primary">
        <Spinner inline size={32} className="text-action-primary" />
      </div>
    )
  }

  if (session === null) return null

  return <>{children}</>
}
