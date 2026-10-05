---
date: "2026-10-04"
title: "Signed-out visitors at the root always get the marketing page"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["web", "auth"]
supersedes: ["2026-08-20-a-lapsed-session-is-not-a-stranger"]
---
## 2026-10-04 — Signed-out visitors at the root always get the marketing page
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** `deckpal.app/` sends a signed-in visitor straight into the app (`/series`) and shows every signed-out visitor the marketing landing. A visitor who has signed in on this browser before is no longer sent to `/auth`.
- The `deckpal.returning` marker and `lib/returningVisitor.ts` are removed. Nothing else read it.
- Self-host still goes straight to `/series`.
- A session read that times out still goes to `/series` rather than guessing.

**Why:** The owner, 2026-10-04: "If I'm signed in it should take me straight to the app. If I'm not, it should go to the marketing page, not auth." Typing deckpal.app while signed out was landing on the sign-in form. This reverses issue #50's ruling of 2026-08-20. The landing is now the front door, and its nav carries Sign in for anyone who already has an account.

**Implications:**
- Browsers that used DeckPal before this change keep a stale `deckpal.returning` key in localStorage. It is harmless, and SECURITY.md notes it.
- AuthGuard is unchanged. A signed-out visitor who opens a members-only page is still sent to sign in.
