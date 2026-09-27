---
date: "2026-08-20"
title: "A lapsed session is not a stranger"
decided_by: "user (issue #50), implemented by Claude Opus 5."
areas: ["general"]
supersedes: []
---
## 2026-08-20 — A lapsed session is not a stranger
**Decided by:** user (issue #50), implemented by Claude Opus 5.

**Decision:** `/` sends a visitor whose session has lapsed to `/auth`, not to
the marketing landing. "Lapsed" = a session has existed in this browser and was
not deliberately signed out of, recorded as one bit in `localStorage`
(`deckpal.returning`, `lib/returningVisitor.ts`).

**Why:** Pitching "create your free account" to somebody who already has one is
the wrong page. AuthGuard's existing `hadSession` ref cannot answer this: the
visit in question is a COLD load, so nothing is in memory. Supabase's own
storage key cannot either — when a refresh token is rejected, supabase-js
deletes the persisted session, so by the time `getSession()` resolves to null
the evidence that there ever was one is gone.

**Implications:**
- The marker is cleared ONLY by the explicit Sign out control, never by
  AuthGuard's expiry path. Both end in a signed-out state and they mean opposite
  things; clearing on expiry would erase the very fact this exists to remember.
- It is a routing hint and never an authorization input. It holds no identity —
  no email, no user id, no token — and is documented as such in SECURITY.md.
- It is written from ONE place, the `onAuthStateChange` subscription in
  `lib/supabase.ts`, because that module owns the client. The several components
  that also watch auth do not each have to remember to record it.
- Verified all four cases in a browser: new visitor → landing, signed in →
  /series, session dropped with the marker kept → /auth ("Welcome back"),
  marker cleared → landing.

