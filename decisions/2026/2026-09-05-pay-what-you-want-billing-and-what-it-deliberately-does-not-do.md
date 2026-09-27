---
date: "2026-09-05"
title: "Pay-what-you-want billing, and what it deliberately does not do"
decided_by: "the owner, opening the work: *\"this will be a 'pay what you"
areas: ["commerce"]
supersedes: []
---
## 2026-09-05 — Pay-what-you-want billing, and what it deliberately does not do

**Decided by:** the owner, opening the work: *"this will be a 'pay what you
want' subscription proposition, so they choose how much they would like to pay
each month, and $0 is a valid selection."* Built by Claude (Opus 5) on branch
`feat/pwyw-billing`.

**Decision:** DeckPal's hosted tier takes money through Stripe, monthly, at an
amount each account chooses — including zero. Migrations 053 (tables) and 054
(RLS, privileges, three write functions). Surfaces: an onboarding ask, a
recurring check-in modal, and a permanent card on the profile page.

### What is NOT here, and why that is the decision

**There is no entitlement column.** Not in `billing_account`, not anywhere. The
moment one exists somebody reads it, and the proposition stops being "pay what
you want" and becomes a price list with a free trial. Every feature works
identically at $0 and at $500, and the schema is shaped so that staying true is
the path of least resistance rather than a promise somebody has to keep.

**$0 is a preset, not an escape hatch.** First in the row, same size and weight
as the others, labelled `$0` rather than "No thanks". A pay-what-you-want
control where declining is a small grey link underneath is a dark pattern with a
generous story attached. Choosing $0 also never shows a card field — "$0 is a
real answer" is falsified the moment answering it costs a payment form.

**No claim that is not true.** Two tempting lines were cut: *"you will never be
asked again"* (false — the check-in is monthly, and the modal now says the
cadence out loud) and *"support DeckPal to keep it running"* (a soft threat, and
nothing here is at risk of stopping).

### The three things that took the design

**1. The Stripe customer id is a capability, so the database guards it.**
Supabase exposes PostgREST to the anon key, and the anon key is in the SPA
bundle by design. If `authenticated` could UPDATE its own `billing_account` row
it could point that row at *somebody else's* Stripe customer — row ownership is
satisfied, it is still their own row — and the billing routes would then read
that stranger's card summary and bill their card. So: RLS SELECT-only,
`REVOKE ALL` / `GRANT SELECT` on top (Supabase's bootstrap grants writes on new
public tables by default, and revoking makes a write fail loudly with `42501`
rather than quietly matching zero rows), and all writes through three
`SECURITY DEFINER` functions that take the account from `auth.uid()` and never
from an argument. The API adds a fourth lock: a stored customer id is only used
when the Stripe customer's own metadata names this account.

The rejected alternatives are worth recording. A second pooled connection per
request violates B2 — that is what exhausted the pool on 2026-08-29. A
`RESET ROLE` / restore dance on the request's own client leaves the rest of the
request running as the table owner with RLS off if anything returns early.

**2. `visit_count` counts sessions, server-side.** "After they've logged in a
few times" needs memory that survives a device change and cannot be reset by
clearing cookies — so it is a column, incremented at most once per six hours in
SQL. A client-side counter would treat one person on a laptop and a phone as two
people who have each been here once, forever.

**3. The migration backfills existing accounts, and stamps `onboarded_at` while
doing it.** The owner's requirement was that people who signed up before this
shipped get the ask on their *next* sign-in, not after three more — so 053 seeds
them at the threshold, which makes them due under the same rule as everybody
else rather than a special case in a route somebody would have to remember to
delete. The second half is subtler: `onboarded_at` is stamped too, marking
onboarding *settled-by-predating-it*, because "Welcome to DeckPal — here's what
it does" is the wrong first thing to say to somebody who has been using it for a
month.

### Stripe shape

Inline `price_data` against one Product, not a $1 Price with quantity. The
quantity trick invoices as "25 × DeckPal Support ($1.00)" and shows a
meaningless quantity column in the dashboard. Amount changes use
`proration_behavior: none` — a voluntary contribution should not produce a
surprise partial charge for a few cents of accuracy. Moving to $0 sets
`cancel_at_period_end` rather than cancelling now: they paid for the month they
are in, and a cancel-at-period-end is reversible in one click where a hard
cancel is not.

Card entry is Stripe's Payment Element — a cross-origin iframe, so no card
number ever enters DeckPal's DOM, memory or error reports, and 053 has no column
that could hold one. The billing portal sits *alongside* the in-app controls for
invoices and receipts, never as the only way to cancel: cancelling is one tap on
the `$0` preset and never requires leaving the app.

### Verified

- **Migrations 053 + 054 run against real Postgres** (PGlite 18, scratchpad
  harness reading the shipped `.sql` files rather than a copy). 34 checks:
  backfill shape, the six-hour visit floor, one-way `onboarded_at`, the
  absent-key / null-key distinction in `billing_apply_stripe`, and the RLS
  attack above. The harness first applies Supabase's own
  `GRANT ALL ... TO anon, authenticated` so the REVOKE is genuinely tested and
  not PGlite's stricter defaults — with it in place an `authenticated` UPDATE
  still errors `42501 permission denied` while the SELECT returns its own row.
- **`pnpm --filter deckpal-api test:pure`** now carries `billing.test.ts` (22
  assertions on `promptDue` and `normalizeAmountCents` — the two parts that fail
  SILENTLY when wrong: a cadence bug nags instead of throwing, an amount bug
  bills). Wired into CI, since CI does not run `pnpm -r test`.
- Full workspace typecheck, both builds, `check-functions` 4/4.

**Not verified, and cannot be from here:** anything requiring a live Stripe
account. No key exists in this environment, and per B9 an agent does not create
one or set Vercel variables. The tier is **UNVERIFIED against real Stripe** until
the owner works through `DEPLOYMENT.md` → "Turning the pay-what-you-want tier
on" in TEST mode and `GET /api/health` reports
`{"billingGate":"configured","stripeMode":"test"}`.

**Implications:** four new environment variables, all four required together
(B11). The dangerous state is `partial` — a secret key with no webhook secret
takes cards and then never hears about a renewal, a failure or a cancellation
again; `/health` names it and the API warns about it on boot. The first
production run of migration 053 asks every existing account for money on their
next visit; that is the intended behaviour and the one part of this that cannot
be rehearsed.


