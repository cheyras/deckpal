---
date: "2026-08-10"
title: "custom SMTP live: Resend on deckpal.app, and four traps on the way"
decided_by: "Not recorded"
areas: ["decks"]
supersedes: []
---
## 2026-08-10 — custom SMTP live: Resend on deckpal.app, and four traps on the way

**What:** Supabase auth now sends through Resend as `DeckPal <noreply@deckpal.app>`.
The built-in shared sender capped signup mail at **2/hour**, which
`apps/web/src/lib/authErrors.ts` apologises for in copy; the cap is now **100/hour**
and the apology is no longer load-bearing.

**Config:** `smtp.resend.com:465`, user `resend`, sender `noreply@deckpal.app`,
`rate_limit_email_sent = 100`, `smtp_max_frequency = 60`, `mailer_autoconfirm`
still false. DNS is three records on Vercel (`deck-pal` scope): a DKIM TXT at
`resend._domainkey`, an SPF TXT at `send`, and an MX at `send` → `feedback-smtp.
us-east-1.amazonses.com` priority 10.

**Least privilege, deliberately.** Two Resend keys exist and they are not
interchangeable. A **full-access** key created the domain and read its records —
used once, in memory, never written to the repo, and safe to delete now. What sits
in Supabase as `smtp_pass` is the **restricted, sending-only** key. The credential
that lives indefinitely in third-party config should be the one that can do the
least; setup is the only thing that ever needed more.

**Four traps, each of which reported success while being wrong:**

1. **A sending-only key cannot verify a domain.** `GET /domains` returns
   `401 restricted_api_key`, and sending as `noreply@deckpal.app` returns
   `403 domain is not verified`. SMTP *auth* succeeds on that key the whole time
   (`235 AUTH OK`), so "the credential works" and "mail will reach anyone" are
   separate questions and the first does not imply the second.
2. **`vercel dns` needs `--scope deck-pal` explicitly.** Without it the CLI says
   "You don't have permission to list the domain record" — a permissions error for
   what is actually a scope-resolution problem, on a domain `vercel domains ls`
   happily lists.
3. **Resend's `record` field is a purpose, not a DNS type.** It returns `"DKIM"`
   and `"SPF"`; passing those to `vercel dns add` as the type fails. The mapping
   is TXT, except where a `priority` is present, which means MX. Both SPF rows
   share the name `send` and differ only by that field.
4. **`smtp_port` must be a JSON string.** The Management API rejects `465` with
   `expected string, received number` — while every other numeric field on the
   same PATCH, `rate_limit_email_sent` included, takes a real number.

**Verification.** Domain `verified` (DKIM, both SPF rows). A real signup driven
through the public `POST /auth/v1/signup` — the same path a visitor takes — was
accepted, and **Resend logs the message as `delivered`**, from
`"DeckPal" <noreply@deckpal.app>`, subject "Confirm your email address".

**The first delivery test was a false positive, and the shape of it is worth
keeping.** Signing up as `cheyras@gmail.com` returned `200` with a *user id that
was not the owner's*. Supabase returns a fabricated user object for an
already-registered address so signup cannot be used to enumerate accounts — no
mail is sent. Two things gave it away: the id did not match the known owner UUID,
and the request took 478ms against 1821ms for a real send. **Testing delivery
against an address that already has an account cannot fail**, so it proves
nothing; use a fresh identity (a `+alias` reaches the same inbox) and confirm
against the provider's own log rather than the API's status code.

**Implications.**

- `deckpal.app` has no MX record, so it can send but never receive. That is fine
  for transactional mail and is why the QA account can never use password reset.
- Free tier is 3,000/month and 100/day; `rate_limit_email_sent = 100`/hour sits
  inside the daily cap rather than at it. Raise the Resend plan before the
  Supabase number.
- Vercel Marketplace was evaluated and rejected: the CLI advertises a `free` plan
  that is not purchasable — after installation both the API and the CLI's own help
  list only pro ($20/mo) and scale ($90/mo), and provisioning `free` returns
  `Billing plan not found`. An installation record exists on the team from that
  attempt; it holds no resource and bills nothing.

_Filed by agent on behalf of @cheyras — 2026-08-10._

