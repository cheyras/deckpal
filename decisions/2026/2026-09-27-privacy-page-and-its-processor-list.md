---
date: "2026-09-27"
title: "Privacy page and its processor list"
decided_by: "Chey (via Claude)"
areas: ["security", "frontend"]
supersedes: []
---
## 2026-09-27 — Privacy page and its processor list
**Decided by:** Chey (via Claude)

**Decision:** deckpal.app gets a public, plain-language privacy page at `/privacy`
(`apps/web/src/routes/Privacy.tsx`), linked from the landing footer (now the shared
`routes/landing/SiteFooter.tsx`) and from the sign-up form. It is chrome-free and public like `/auth`, so a
signed-out reader can open it. It is cloud-only like `/signed-out`: on self-host it redirects to `/series`,
because it describes deckpal.app's processors, which a self-hosted copy does not use. Every fact on it was read
from the code. Legal and business facts are drawn as visible "To decide" markers until Chey supplies them.

The processor list, and the file behind each entry:

- **Supabase:** email, password hash, all stored data, avatars, bug-report screenshots, and IP and browser on
  auth calls. Used for auth, Postgres and Storage. Sign-in goes straight from the browser
  (`apps/web/src/lib/authSession.ts`). The profile is world-readable by design (`021_rls_policies.sql`
  `user_profile_read`, kept by `072_postgrest_reach.sql`).
- **Resend:** email address and auth email content, as Supabase's SMTP (decision 2026-08-10, custom SMTP live).
- **Vercel:** every request (IP, user agent), function logs, and the client crash beacon
  (`apps/api/src/routes/clientErrors.ts`). It also hosts the AI Gateway.
- **Stripe:**
  - Support payments: email, `deckpal_user_id` metadata, and card data typed into Elements
    (`apps/api/src/billing/service.ts`, customer creation and `receipt_email`).
  - Credits: user id and order id in Checkout metadata; we send no email (`apps/api/src/credits/payments.ts`).
  - Stripe.js loads only when a payment form opens (`apps/web/src/lib/billing.ts`).
- **GitHub:**
  - Public bug-report issues: description, page path, viewport, user agent and report id, with no email or user
    id (`apps/api/src/routes/bugs.ts`, `formatIssueBody`).
  - Actions runners that hold database credentials for scheduled jobs (`.github/workflows/price-refresh.yml`).
- **xAI (Grok), `spacexai/grok-4.20-non-reasoning`:** Deck-E chat and the deck-import fix (`api/chat.mjs`,
  `apps/api/src/routes/deckImportFix.ts`). No ZDR.
- **Anthropic:**
  - `claude-sonnet-5` and `claude-opus-5` for Deck-E's deep tools (`apps/api/src/decke/deep.ts`). No ZDR.
  - `claude-haiku-4.5` for issue triage on public bug reports (`scripts/triage-issue.sh`). No ZDR.
- **Perplexity**, `sonar-pro` with `sonar` as fallback: research queries, screened by `researchQuery.ts`. No ZDR.
- **TypeSafe**, `jev`: reflex and audit judgments (`apps/api/src/decke/jev.ts`). The only request with
  `zeroDataRetention: true`. On in production since 2026-09-28 (`DECKE_JEV=on`; `/api/health` reports
  `deckeJev.status: "on"`), so TypeSafe receives this data today.

**Not listed on the page, and why:**

- Configured model fallbacks with no call site: `google/gemini-2.5-flash`, `openai/gpt-5.1-thinking`, and the
  `write` and `vision` jobs.
- The scanner and its browser speech (Apple or Google), the labeler, and the Google Drive training export. Each
  is permission-gated owner tooling today.
- Catalog, price and image upstreams (TCGdex, TCGCSV, Cardmarket, pokemontcg.io, Bulbagarden). These are
  server-side fetches that carry no user data.
- A connected MCP assistant and TCGplayer buy links are on the page, but as places the reader chooses to send
  data rather than as processors. A Mass Entry link carries the reader's missing-card list.

**Why:** Issue #237, item 6. DeckPal takes emails and payments and sends chat to AI providers, but had no
privacy page. The Jev decision (2026-09-27) asked for TypeSafe to be named on one when it was written. Writing it
from the code rather than from memory surfaced several facts a guessed page would have got wrong:

- only Jev requests zero retention;
- profiles are world-readable;
- there is no account deletion or export;
- the support prompt counts visits and A/B-tests amounts;
- battle logs carry opponents' in-game names to the AI models;
- the bug-report dialog named only two of the four fields that go public. Its copy is fixed in the same change.

**Implications:**

- A change to where user data goes is a change to `/privacy`, in the same PR. The triggers are in SECURITY.md,
  "The privacy page".
- The page must not ship looking finished while "To decide" markers remain. Chey's questions are in the PR:
  operator, contact, effective date, retention, deletion, law, age, DPAs, AI ZDR, and change notice.
- Leads for later work, not fixed here:
  - account deletion is manual;
  - `bug_report` rows and the `user_id text` tables (credits, admin, `decke_ai_request`) would not cascade on a
    manual delete;
  - a connector token in `/mcp/<token>` can land in request logs;
  - `card_list.visibility = 'public'` has no reader.
