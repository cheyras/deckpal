---
date: "2026-08-27"
title: "GLC §2.3.4 item 6 was never missing, and the `cel25` prefix is not a gap (issue #93 follow-up)"
decided_by: "Claude Opus 5 on behalf of @cheyras"
areas: ["general"]
supersedes: []
---
## 2026-08-27 — GLC §2.3.4 item 6 was never missing, and the `cel25` prefix is not a gap (issue #93 follow-up)

**Decided by:** Claude Opus 5 on behalf of @cheyras

**Decision:** No code or data change. Two things that were carried as deferred
gaps are recorded as already-correct, and pinned by tests so they stop reading
as unfinished.

**Item 6 (Pokémon TCG Classic).** It has no row in `glc-rules.json`, which reads
like the gap item 5 actually had. It is not one. The spec resolves item 6 to
*"fingerprint-based allow, same primitive as §2.1.5"* — the reprint oracle the
pool rule already consults — so the rule is live with no vendored data. A
set-keyed `deny_except` row would be the wrong shape entirely: **item 5 names
two cards, item 6 names a property.** Two fixtures now prove it, using a
DISCRIMINATING oracle rather than the always-true one the item-5 tests use,
because an always-true oracle cannot tell "admits reprints" from "admits
everything".

**The `cel25` prefix.** GLC's `pool_from_series_prefixes` omits `cel25`, so the
two cards item 5 excepts reach the pool only via the reprint rule. That looked
like a second gap. It is what item 5 *says*: *"unless they are from Black &
White or later"*. Adding `cel25` to the prefix list would admit the whole set,
which is the opposite of the rule.

**What did need doing was the invariant underneath both.** The oracle is
optional in `ValidateContext` because pure tests inject their own — load-bearing
optionality, and also the hole. A caller that forgets it does not get a slightly
different answer; it reports a legal GLC deck as **illegal**, which is the worse
direction. A source guard now asserts every production `validateDeck` call
supplies one; mutation-tested by removing it from `routes/decks.ts`, which the
guard names.

**Implications.**
- Do not add `cel25` to GLC's prefix list, and do not vendor an item-6 row.
- Never call `validateDeck` without the oracle outside a test. The guard says so.
