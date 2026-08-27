/* ─────────────────────────────────────────────────────────────────────────────
 * /signed-out — where signing out actually lands you.
 *
 * Before this page, Sign out dropped straight onto the login form, which reads
 * like the app rejected you rather than like it did what you asked. This is a
 * real destination: it confirms the sign-out, and offers the only two things
 * anyone wants next.
 *
 * Two callers navigate here and they agree on purpose: Profile's explicit Sign
 * out, and AuthGuard when a session it was holding disappears (sign-out from
 * another tab, or an expired session). The copy is written to be true of both.
 * ───────────────────────────────────────────────────────────────────────────── */
import { useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { supabase } from '../../lib/supabase'
import { readSession } from '../../lib/authSession'
import { AuthPage, CTA_PRIMARY, CTA_QUIET } from './authUi'
import { StatusPanel } from '../../components/ui/StatusPanel'

export function SignedOut() {
  // Landing here means the session should be gone. If anything left one behind
  // (a failed signOut, a second tab), clear it locally so "Sign back in" is a
  // real sign-in and not a silent resume of the session you just ended.
  useEffect(() => {
    void readSession().then(({ session }) => {
      if (session) void supabase.auth.signOut({ scope: 'local' })
    })
  }, [])

  return (
    <AuthPage>
      <StatusPanel
        icon="logout"
        tone="neutral"
        title="You're signed out"
        actions={
          <>
            <Link to="/auth" search={{}} className={CTA_PRIMARY}>
              Sign back in
            </Link>
            <Link to="/" className={CTA_QUIET}>
              Back to home
            </Link>
          </>
        }
      >
        <p>
          Your collection is safe. Nothing was deleted — sign back in on any device and everything is exactly
          where you left it.
        </p>
      </StatusPanel>
    </AuthPage>
  )
}
