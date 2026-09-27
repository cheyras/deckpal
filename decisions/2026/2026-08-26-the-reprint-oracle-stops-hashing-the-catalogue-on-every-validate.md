---
date: "2026-08-26"
title: "The reprint oracle stops hashing the catalogue on every validate"
decided_by: "Claude (Opus 5), finishing the item left open by the"
areas: ["scanner","decks","catalog"]
supersedes: []
---
## 2026-08-26 — The reprint oracle stops hashing the catalogue on every validate
**Decided by:** Claude (Opus 5), finishing the item left open by the
card-identity change: *"Make the change you proposed, correctly."*

**Decision:** `buildReprintOracle` reads the stored `playable_fingerprint`
instead of recomputing it per request — and falls back to computing when the
column is not filled, because the alternative failure is silent and severe.

### What it cost

The oracle answers "is this rotated card legal because a fingerprint-identical
reprint carries a legal mark". It hashed everything at request time: the deck,
then per card a candidate lookup plus another five-query hydration to hash the
candidates. Measured against the real catalogue, 30 rotated cards:

| | queries | time |
|---|---|---|
| before | **185** | 5.59 s |
| after | **1** | 0.03 s |

Same verdicts either way — 30/30 true positives, 0 false positives on ten
cards with no legal reprint. This is on `/decks/:id/validate`, which is what
`decks(include: ['validate'])` calls, which is what the agent calls.

It hashed at request time because nothing had ever written the column. 047 and
`fingerprintIndex.ts` fixed that and indexed it for exactly this lookup.

### The failure the fallback exists for

The column is filled by a PASS, not by the importer, so a deployment can
migrate without running it. On such a database every fingerprint is NULL,
`NULL = NULL` is not true, and a naive one-query oracle reports **no card** as
reprint-legal: legal decks turn illegal, with a confident violation, on the
validator whose whole job is to be trusted. Nothing throws.

So a NULL is never read as "no reprint". Those cards fall back to the original
compute path, which consults no column. Verified against production by blanking
all 23,546 fingerprints inside a transaction: **identical 12-of-24 verdict**,
one warning, rolled back with the index intact.

The warning separates the two reasons a fingerprint can be NULL, because only
one is a problem: too thin to hash is legitimately NULL for ever (107 rows),
while hashable-but-unstored means the index is behind. B11’s shape applied to
a derived column.

### Two things caught by measuring rather than by testing

**The benchmark’s own expectation was wrong first.** It selected cards sharing
a `name_normalized` with a legal-marked card and expected 30 true verdicts. It
got zero — correctly: a promo Grookey and a modern Grookey are different cards
with one name. The name is a prefilter; the fingerprint decides. The same
confusion this whole thread is about, reappearing in the tool built to measure
it.

**The fake pool was too loose.** It ignored `= ANY($1)`, so hydrating the
CANDIDATE handed back the subject’s own row, the subject matched itself, and
the "does not invent a reprint" test agreed with the code instead of checking
it. A fake that answers a question it was not asked will confirm whatever it is
given. It honours the id filter now, and the fallback tests are
mutation-checked: disabling the NULL guard fails two of them.

**Implications:**
- `computeFingerprints` and `fingerprintInputs` stay exported and unchanged —
  the fallback and `fingerprint:index` both need them. This removed a hot path,
  not a capability.
- The one-query form depends on 047’s partial index. Dropping that index makes
  this a sequential scan per validate, which is slower than what it replaced.

---
