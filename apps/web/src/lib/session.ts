import { useEffect, useState } from 'react'
import { supabase, isCloudMode } from './supabase'

/**
 * "Is somebody signed in?" — the one answer the catalog UI needs.
 *
 * The catalog (series, sets, cards, Pokédex, search) renders for logged-out
 * visitors, so every surface that shows per-user state has to choose between a
 * collection control and a sign-up affordance. This hook is that choice's input,
 * and it is deliberately a *boolean-ish* rather than a Session: nothing in the
 * catalog needs the token, and handing components a Session invites them to read
 * `session.user.id` and start branching on identity in the client.
 *
 *   • `undefined` — not known yet. Render neither control nor CTA; a flash of
 *     "Sign in to track your collection" in front of a signed-in user is worse
 *     than a beat of nothing.
 *   • `true` / `false` — settled.
 *
 * Self-host resolves synchronously to `true`: there is no signed-out state
 * there, the reverse proxy is the auth boundary, and the single local user is
 * always the caller (SECURITY.md). So every `signedIn === false` branch below
 * is cloud-only by construction and self-host renders exactly as it always has.
 *
 * AuthGuard keeps its own subscription rather than using this hook: it needs the
 * had-a-session-then-lost-it distinction to pick between /signed-out and /auth,
 * which is a different question from the one asked here.
 */
export function useSignedIn(): boolean | undefined {
  const [signedIn, setSignedIn] = useState<boolean | undefined>(isCloudMode ? undefined : true)

  useEffect(() => {
    if (!isCloudMode) return
    let live = true
    // getSession() reads the persisted session out of localStorage, so the
    // common case settles in a tick with no network round trip.
    void supabase.auth.getSession().then(({ data }) => {
      if (live) setSignedIn(!!data.session)
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => setSignedIn(!!s))
    return () => {
      live = false
      subscription.unsubscribe()
    }
  }, [])

  return signedIn
}
