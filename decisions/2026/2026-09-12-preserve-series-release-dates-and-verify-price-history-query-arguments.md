---
date: "2026-09-12"
title: "Preserve series release dates and verify price-history query arguments"
decided_by: "Codex in-session worker under Codex supervision on behalf of"
areas: ["data","commerce"]
supersedes: []
---
## 2026-09-12 — Preserve series release dates and verify price-history query arguments

**Decided by:** Codex in-session worker under Codex supervision on behalf of
@cheyras, recording the authorized repairs after adversarial review.

**Decision.** Normalize calendar fields at the series SQL boundary:
`first_release_on` in both the list and detail queries and `released_on` in
detail set rows use `to_char(..., 'YYYY-MM-DD')`, preserving nulls. This supplies
the existing comparator and JSON response with one calendar-date representation.
Real sets and upcoming placeholders sort newest first, unknown dates last, and
by name on equal dates. The shared `fmtDate` formatter continues to preserve
calendar dates while interpreting genuine timestamps as local instants. Only
the series endpoint fields change; there is no global PostgreSQL type-parser
override or claim that every catalog endpoint now has this representation.

**Why.** Review findings R1 and R2 exposed an untested driver boundary:
node-postgres returns SQL `DATE` as JavaScript `Date` objects. Mixing those
objects with placeholder strings broke interleaving and same-day name ordering;
serializing midnight as a timestamp also displayed the prior day in Denver.
Normalizing in the query prevents both failures before sorting or serialization.

**Verification scope.** The new actual-route regression is wired into API
`test:pure` and uses an isolated query adapter with actual PostgreSQL OID parser
controls, without a live database. The `card_price_history` tests now capture
outgoing requests for non-default `2y`/`JPY` and `30d`/`EUR` range/currency
pairs, closing the review's test gap instead of trusting mocked response labels.
The supervisor's independent mutation checks must reject hardcoded range and
currency defaults separately. The upcoming row also gains `role="group"` so its
existing accessible name has an explicit role; it remains non-clickable.

At this documentation update, final verification, a fresh Astra review, GitHub
CI, merge, and deployment are pending. Earlier test and browser counts describe
the preceding integration, not acceptance of these repairs. This worker changed
documentation only and did not execute tests or access production.

---

