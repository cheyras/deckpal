---
date: "2026-09-12"
title: "Page price-history text before the conversational adapter limit"
decided_by: "Codex in-session worker under Codex supervision on behalf of"
areas: ["commerce","frontend"]
supersedes: []
---
## 2026-09-12 — Page price-history text before the conversational adapter limit

**Decided by:** Codex in-session worker under Codex supervision on behalf of
@cheyras, recording the repair required by the fresh GPT-6 Astra PR review.

**Trigger.** Astra executed the actual conversational `buildDataTools` adapter
with three printing variants and 31 daily points per variant at `30d`.
The shared tool returned 13,137 characters; the adapter's 6000-character limit
cut off the third variant. Although the cutoff was explicit, the tool had no
continuation input to recover the omitted observations. MCP also exposes tool
text without structured metadata, so metadata alone cannot solve this.

**Decision.** Add optional `offset`, a nonnegative safe integer defaulting to
`0`, to `card_price_history`. Each invocation still makes one GET to the
existing card-prices endpoint with the same card, range, and currency; pagination
is tool-side and does not add a REST query parameter. Return complete OHLC
records and printing identity in pages of at most 5500 characters including
headers and continuation. Model-visible `next_offset=<integer>` directs the
caller to repeat the same card/range/currency at that offset;
`next_offset=none` marks completion. Report empty history separately from an
offset past available records. Range/currency defaults, currency-major-unit
values and the full MAY/MAY NOT interpretation contract remain unchanged.

**Why and limits.** Bounded shared-tool output works through both adapters
without increasing Deck-E's global output cap or relying on MCP-invisible
metadata. Callers must follow continuation before claiming a complete history.
Each page is a fresh read of the requested history, not a database snapshot.
Offsets count complete points in API order plus one record per empty variant.
If one complete record and its identity cannot fit the budget, the tool
reports an error instead of returning partial fields.

**Verification scope.** The repair requires an actual-adapter regression for
the truncation case and pagination checks that traverse every record without
loss, duplication, partial fields or a page exceeding the bound. Final checks,
Astra re-review, publication of the repair, GitHub CI, merge and deployment are
pending at this documentation update. This worker edited documentation only
and did not execute tests or access production.

---

