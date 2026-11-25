---
date: "2026-11-23"
title: "Privacy page legal and business answers"
decided_by: "Chey (via Claude)"
areas: ["security", "frontend"]
supersedes: []
---
## 2026-11-23 — Privacy page legal and business answers
**Decided by:** Chey (via Claude)

**Decision:** The twelve "To decide" markers on `/privacy` (`apps/web/src/routes/Privacy.tsx`, from the
2026-09-27 privacy page decision) are filled, and the `ToDecide` component is gone. Chey chose:

- **Who runs DeckPal:** an independent developer based in Utah, USA (no company).
- **Contact:** `support@deckpal.app`, the one address for privacy requests, account deletion and support.
- **Zero data retention:** keep today's wording. Only TypeSafe's Jev asks for it (`apps/api/src/decke/jev.ts`);
  the other Deck-E providers' own terms decide retention.
- **Privacy rights:** offered to everyone wherever they live, with GDPR wording for the EU and UK.
- **Minimum age:** 13, with under-18s told to check with a parent or guardian.

The rest is worded to be true of the code today:

- **Data-processing agreements:** Supabase, Resend and Stripe make theirs part of their terms; Vercel's covers
  Pro, and deckpal.app is billed for Vercel Pro. Deck-E's AI providers are reached only through the Vercel AI
  Gateway. GitHub and DuckDuckGo run on their own terms.
- **Payment and usage records:** "at least 7 years", because nothing deletes them.
- **Bug-report private copy and screenshot:** kept "until you ask us to delete them", because no job prunes them.
- **Backups:** no day count, because the Supabase backup window was not confirmed.
- **Change notices:** only the date at the top changes; there is no email or in-app notice yet.

**Why:** The page cannot go live with markers on it, and the Claude connector directory asks for a privacy
policy and a verified support contact. Each answer was checked against the code or a bill before it went in,
and promises the code does not keep yet were reworded instead of made.

**Implications:**
- Account deletion is a manual job until there is a button. Deleting the `auth.users` row cascades through
  `app_user`, but three things stay behind and must be cleared by hand to keep the 30-day promise:
  `bug_report.reporter_email` (that table sets `user_id` to null and keeps the email, `022_bug_report.sql`);
  rows keyed on `user_id text` with no foreign key (credit, Deck-E usage and admin tables, migrations 064, 066,
  067, 070, 071, 081); and avatar and bug-screenshot files in Supabase Storage.
- `support@deckpal.app` must reach a person. Mail for deckpal.app is forwarded by ImprovMX.
- Sign-up asks no age question. The page makes no claim that it does; a neutral one is worth adding.
- A new processor, a cleanup job for bug reports or usage records, or a change-notice email changes this page.
