---
date: "2026-08-29"
title: "An answer they have already been given is not delivered a second time"
decided_by: "owner, in the 2026-08-29 transcript (\"you had already told me"
areas: ["general"]
supersedes: []
---
## 2026-08-29 — An answer they have already been given is not delivered a second time

**Decided by:** owner, in the 2026-08-29 transcript ("you had already told me
about most of these stats")
**Decision:** `decke/toldAlready.ts` rebuilds, per request from the replayed
lookup records, the set of tool+summary pairs the reader has already been shown
— the same reconstruct-from-the-wire shape as `declined.ts` and `failing.ts` —
and the adapter appends one parenthetical to the MODEL's copy of a read whose
one-line summary matches: this was already reported; say only what is new.
`failing.ts`'s block parser is shared, so the breaker's recovery signal and
this annotation cannot disagree about what a turn recorded.
**Why:** The transcript's other repetition had no guard that could reach it:
`decks` returned the same summary on turns 3–7 and SUCCEEDED every time, so the
failing-tool breaker (which only opens on failures) never applied, and the
repeat ledger is rebuilt per request and cannot see a turn boundary. The
comparison is free because the record's `<tool>: <summary>` lines are the
server's own `summarise(result)`.
**Implications:** X2 is satisfied by leaving the chip alone — the lookup really
ran and `ok` is true of it. A per-result annotation, not a turn-end note, so it
does not spend the one-note-per-turn budget. Does not fire for client/cosmetic
tools, writes, breaker-intercepted calls, `health`/`set_cart`, or summaries too
short to be evidence. The `chat.mjs` threading is pinned in
`chatWiring.test.ts` — an unthreaded ledger is this repository's most repeated
defect, and this pass found two more of them in #138.

