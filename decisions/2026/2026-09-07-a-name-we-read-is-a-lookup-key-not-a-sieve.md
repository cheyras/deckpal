---
date: "2026-09-07"
title: "A name we read is a lookup key, not a sieve"
decided_by: "Owner, from a scan with a screenshot: a toploadered Ultra Ball"
areas: ["general"]
supersedes: []
---
## 2026-09-07 — A name we read is a lookup key, not a sieve

**Decided by:** Owner, from a scan with a screenshot: a toploadered Ultra Ball
landed "needs your input", the row's chip said `read "Ultra Ball"`, and the five
candidates offered under it were the perceptual hash's near-random list — Binding
Mochi at 81 %, and not one Ultra Ball. *"As silly as it gets."*

**Decision:** The OCR resolution ladder gains **rung 5b**. A read NAME that
resolves to a catalogue name family returns that family's printings as showable
candidates — `matched: false`, best first, `resolvedBy: 'name-family'` — exactly
as rung 9 already does with the body-text family. It is confident only when the
family has exactly ONE printing and the name was read at tier 0 or 1. A fuzzy
(tier 2) read may offer candidates and may never name a card. A read matching
several distinct catalogue names shows the best three families' top five
printings each and is never confident.

On the client, the needs-input picker now holds BOTH kinds of candidate: the
ladder's first, then the tie-gated phash ranking minus anything already above,
drawn as two groups with a seam between them.

**Why:** The name could previously only FILTER `priorMatches` (rung 7). A filter
can only return cards the hash already nominated — so when the hash had failed,
which is the only reason the ladder is that far down, the filter emptied and the
name evidence was DISCARDED. The catalogue knows every card called Ultra Ball;
not asking it was the whole defect. The same "a family is not a card" rule that
rung 9 was built on applies unchanged, keyed on the name field.

The client rule it reverses was `ocrNarrow.ts`'s: *"NOT the alternates list — the
resolve endpoint's matches carry `distance: null` for cards phash never
nominated, and a list that ranks by distance must not contain entries with no
distance."* The reasoning holds and the conclusion did not. It is satisfied now
by not putting them in the same list: two groups, and no candidate is given a
percentage no hash ever measured.

**Implications:**

* `ResolvedBy` gains `'name-family'`. It is deliberately not `'prior-only'`,
  which would tell a caller these candidates are ranked by Hamming distance when
  most of them have none. Clients switch on this union nowhere; they record and
  display it, and the one branch is `readCandidates`, which refuses to re-offer
  a `prior-only` list as something OCR found.
* `CatalogPort` gains an OPTIONAL `byName(probe)`, on `byTextTokens`'s
  graceful-skip contract: a port without it never reaches the rung, and every
  other rung behaves exactly as before. The Postgres implementation is a SUPERSET
  generator — a prefix of the folded name (tiers 0/1, both directions) OR pg_trgm's
  `%` (tier 2) — and `nameTier` still makes every decision, in one place, testable
  without a database.
* That query SCANS `card`: the prefix half re-folds `name_normalized` with
  `unaccent()` and a parenthetical strip, so no index can serve it (017 declines
  to index `unaccent()` for the same reason), and an OR with an indexable half is
  a scan anyway. It is 23.5k rows of three cheap functions on a request where
  every printed key has already failed, and nothing on the capture path waits for
  it. The alternative — trusting the trigram floor alone — would make an exact
  name read depend on a similarity heuristic.
* Rung 5b sits ABOVE the vector rung, for the reason rungs 3-5 do: once a printed
  field has produced a candidate set, the vector's contribution to it is
  agreement (`corroborate` → `'corroborated'`), not a competing list. A vector
  pointing outside the family corroborates nothing and the candidates go to the
  reader unclaimed.
* `FeedEntry.alternates` and `IdentityState.candidates` widen to `ScanCandidate`
  (nullable distance/confidence, plus `from: 'read'`). `toPickedMatch` converts a
  reader's choice into the row's long-standing `-1`/`0` encoding of "no phash
  opinion" at the picker boundary, so `feed.resolveRow` and the row's meter are
  untouched.

**Tests:** 159 api scan (14 new, incl. the reported Ultra Ball case end to end,
name+vector corroboration, the multi-family guard and the fuzzy-never-confident
rule), 220 api pure, 175 web scan-ui (13 new across `identity.test.ts` and a new
`candidates-picker.test.ts` that renders the shipping popover). API build, web
typecheck and web build all pass.

