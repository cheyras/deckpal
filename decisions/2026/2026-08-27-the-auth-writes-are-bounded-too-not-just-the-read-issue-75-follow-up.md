---
date: "2026-08-27"
title: "The auth WRITES are bounded too, not just the read (issue #75 follow-up)"
decided_by: "Claude Opus 5 on behalf of @cheyras"
areas: ["security"]
supersedes: []
---
## 2026-08-27 — The auth WRITES are bounded too, not just the read (issue #75 follow-up)

**Decided by:** Claude Opus 5 on behalf of @cheyras

**Decision:** `signInWithPassword`, `signUp`, `resetPasswordForEmail`,
`updateUser` and `signOut` now go through bounded wrappers in
`lib/authSession.ts`, and `check-auth-deadlines.mjs` refuses a raw call to any
of them.

**Why the first pass stopped short, and why that was the wrong place to stop.**
The read is what produced the grey screen, because it is awaited before first
paint. These are not: every one is behind a button the reader pressed, with a
busy state beside it, so a stall here is visible rather than silent. That is a
real difference and it is why they were deliberately left alone.

It is still not enough. `@supabase/auth-js` puts no `AbortSignal` and no timeout
on **any** of its fetches — the same fact that let the read hang forever — so a
stalled write does not produce an error the reader can act on, it produces a
button that spins until the tab is closed. **Sign-out is the worst case in the
set:** the one action whose entire purpose is to stop being signed in, on a
machine that may not be yours, had no way to tell you it had not happened.

**Two deliberate differences from the read.** The deadline is 15s rather than
4s, because nothing is blocked on these except the button that started them and
a person who just pressed one will wait. And a timeout **surfaces** as an
ordinary `error` the existing form code already renders, instead of falling back
to a quiet default — there is no safe assumption to make about whether a write
landed, so the honest answer is "this did not finish", not a guess.

**Implications.**
- Add an auth call and the gate will name it. Add the wrapper, not an exception.
- A timeout on a write is NOT an auth failure and must not sign the reader out.
