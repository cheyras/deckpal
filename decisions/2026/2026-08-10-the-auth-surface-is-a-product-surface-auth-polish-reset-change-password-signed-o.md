---
date: "2026-08-10"
title: "the auth surface is a product surface: /auth polish, reset, change-password, /signed-out"
decided_by: "Not recorded"
areas: ["security","catalog"]
supersedes: []
---
## 2026-08-10 — the auth surface is a product surface: /auth polish, reset, change-password, /signed-out
**What:** cloud DeckPal shipped with a single-screen `/auth` (sign in / sign up) and
nothing else. There was **no password reset**, **no way for a signed-in user — including
the owner — to change their password from inside the app**, and Sign out dumped you on
the login form as if you had been rejected. Auth failures rendered GoTrue's developer
strings verbatim ("Invalid login credentials", "For security purposes, you can only
request this after 47 seconds").

**Decision:** treat auth as part of the product, at the landing page's visual bar.
- `/auth` — mode lives in the **URL** (`?mode=signup`, `?mode=forgot`), so the landing
  CTA, the toggle, Back/Forward and a pasted link cannot disagree. Inline validation,
  loading/disabled states, and a signup success state that is honest about Supabase's
  account-existence obfuscation (an existing address is sent nothing, and we say so
  rather than claiming an email is always on its way).
- `/auth/reset` — target of the recovery email. `/signed-out` — a real confirmation.
  Both public, both cloud-only (`beforeLoad` redirects self-hosters to `/series`).
- Profile grows an **Account** card (change password), rendered *outside* the overview
  query's `ov &&` guard so rotating a password does not depend on the insights API.
- `lib/authErrors.ts` maps GoTrue `error.code` → one actionable sentence, and is the
  only path from an auth failure to the screen. Raw API strings never reach the UI.

**Password policy is read, not assumed:** Supabase Management API reports
`password_min_length = 6`, `password_required_characters = null`,
`mailer_autoconfirm = false`, `rate_limit_email_sent = 2/hour`, `mailer_otp_exp = 3600`,
`uri_allow_list = https://deckpal.app/**`. `PASSWORD_MIN_LENGTH` mirrors the first;
the rate-limit copy ("try again in a few minutes") is honest about the second-to-last —
the built-in SMTP allows two messages an hour, and custom SMTP is a separate follow-up.

**Recovery-link handling is read from @supabase/auth-js 2.112.2, not from memory.** The
client defaults to `flowType: 'implicit'`, so tokens arrive in the URL *fragment*;
`detectSessionInUrl` consumes it during `_initialize()` and emits `PASSWORD_RECOVERY`
on a `setTimeout(…, 0)` — which React can miss by mounting late, and auth-js does not
replay to late subscribers. `/auth/reset` therefore subscribes (documented path) **and**
treats any session as permission to set a new password (`INITIAL_SESSION` closes the
race), and captures `#error=…&error_code=otp_expired` at **module scope**, before
auth-js's async continuation rewrites the URL.

**One predicate, three call sites.** `isPublicPathname` in `lib/landingRoute.ts` now
owns the whole public set (`/`, `/auth`, `/auth/reset`, `/signed-out`, `/overlay`) and is
used by RootComponent (skip AuthGuard), AppShell (render chrome-free) and `api.ts`
`handle401` (do not hard-redirect). Three drifting string tests is exactly how the
401 → `location.assign('/auth')` → reload → 401 loop got in.

**Two bugs found while verifying, both fixed:**
1. Profile's identity row (name, gear, **Sign out**) is `-mt-[54px]` over the banner and
   got its height solely from the `LevelRing`, which renders only after the overview
   query resolves. With that query failing the row collapsed *into* the banner, whose
   absolutely-positioned scrim then swallowed every click — an insights outage left
   nobody able to sign out. Fixed with `relative z-[1]` + `min-h-[96px]`.
2. The landing's drifting hero glow (`ls-hero-glow`) is wrong behind a form: a permanent
   compositor animation under the card, which also made the composited layer jitter a
   subpixel or two. The auth pages use the same gold bloom, static.

