---
date: "2026-08-21"
title: "`/api/chat` had no server-side entitlement, rate limit or spend cap"
decided_by: "Claude (Opus 5), on behalf of @cheyras."
areas: ["agents","operations"]
supersedes: []
---
## 2026-08-21 — `/api/chat` had no server-side entitlement, rate limit or spend cap
**Decided by:** Claude (Opus 5), on behalf of @cheyras.

**Decision.** Server-side entitlement (`DECKE_ENTITLED_USER_IDS` plus the owner)
checked before the body is parsed, and a durable per-user daily meter in
Postgres (`decke_usage`, migrations 039/040) with the conversational and deep
tiers capped separately.

**Why.** `userFromRequest` checked only that the Supabase JWT was valid. The
gate deciding who gets Deck-E lives in the browser, so what it actually decided
was whether to draw a button. **Verified against the deployed endpoint before
the fix:** an ordinary signed-in account got a full model turn, billed to the
owner's Gateway key, by asking for one. That was survivable at $0.000143 a turn
and stops being survivable the moment this endpoint can invoke Claude
sub-agents, live research and write tools.

**A list, not an id.** The QA account is deliberately an ordinary user (B12) and
several of the spec's browser gates WRITE, so they may never run as the owner.
An owner-only gate would have made this feature unverifiable by anyone permitted
to verify it.

**Check and charge in ONE statement.** SELECT-compare-UPDATE races: two requests
that both read 119 both proceed, which is how a rate limit becomes a suggestion
under exactly the load that made you want one. The `ON CONFLICT … DO UPDATE …
WHERE` clause IS the comparison, under the row lock, and being over cap is
expressed as "nothing came back". Verified against a real Postgres: cap 3 gives
1, 2, 3, then no rows, with the stored value still 3 — the refused call does not
increment.

**A turn is one BILLED REQUEST, not one thing the reader typed.** A journey
spends up to four. Naming the counter after what the reader perceives would make
the cap read four times more generous than it is, and the first person to
discover that would discover it from a bill.

**Migration 040 gives `authenticated` SELECT and deliberately nothing else.** On
Supabase every policied table is also reachable through the Data API with a
user's JWT, so an UPDATE policy would not mean "the app may increment your
counter", it would mean "you may zero it from a browser console". A meter its
subject can edit is not a meter. The write runs as the connection's own role,
outside `withUserContext`.

**Accounting fails OPEN; access control does not.** A database blip must not
take the character down, but it must never widen who can use it. Different
questions, different answers, separate checks — and the open path logs loudly,
because "the meter was off for six hours" has to be discoverable afterwards.

**Implications.** ~90 ms added before first token (one round trip to a database
in another region, against a measured 593 ms TTFT). Unavoidable while the meter
is durable: the refusal must be decided before the spend, so it cannot overlap
the model call. Deploy order is safe either way — with 039 unapplied the meter
throws, logs and fails open, while entitlement works from the first request.
`DECKE_ENTITLED_USER_IDS` must be set in Vercel or Deck-E is owner-only; per B9
and B11 rule 3 that is the maintainer's action, not an agent's.

