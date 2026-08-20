import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// A dev server that talks to production is the useful default (AGENTS.md B12),
// and it is also the one that can quietly delete somebody's real collection.
// The terminal banner in vite.config.ts is not enough: nobody working in the
// browser looks at it, and an agent driving Playwright cannot see it at all.
// This ribbon can't be missed, and — the actual point — it lands in every
// screenshot, so a reviewer looking at a verification image can tell at a
// glance whether that was real data.
//
// Injected by vite.config.ts, and only when the dev server derived the live
// backend itself. Undefined in every production build, so this renders nothing
// and tree-shakes to approximately nothing.
const LIVE_ORIGIN = import.meta.env.VITE_DEV_LIVE_ORIGIN as string | undefined

export function DevBackendRibbon() {
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    if (!LIVE_ORIGIN) return
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (alive) setEmail(data.session?.user?.email ?? null)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (alive) setEmail(session?.user?.email ?? null)
    })
    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [])

  if (!LIVE_ORIGIN) return null

  const host = LIVE_ORIGIN.replace(/^https?:\/\//, '')
  return (
    <div
      role="status"
      // Fixed and bottom-anchored: the top is where the app's own cover header
      // pins itself to a composited layer (DECISIONS.md 2026-08-13), and
      // overlapping that is how you get a ribbon that flickers on scroll.
      className="fixed bottom-0 inset-x-0 z-[9999] pointer-events-none flex justify-center pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      <div className="pointer-events-auto rounded-full border border-amber-400/40 bg-amber-500/95 px-3 py-1 text-[11px] font-semibold tracking-wide text-stone-950 shadow-lg">
        LIVE DATA · {host}
        {email ? <span className="font-normal"> · signed in as {email}</span> : <span className="font-normal"> · signed out</span>}
      </div>
    </div>
  )
}
