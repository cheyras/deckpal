---
date: "2026-08-29"
title: "Deck-E harness: failures survive the turn boundary"
decided_by: "owner, via the 2026-08-29 slowking transcript"
areas: ["agents","decks"]
supersedes: []
---
## 2026-08-29 — Deck-E harness: failures survive the turn boundary

**Decided by:** owner, via the 2026-08-29 slowking transcript
**Decision:** Error chips are replayed to the next turn as real `output-error`
tool parts (`lookupRecord.failureParts`, capped at 4 per turn). A new
`decke/failing.ts` rebuilds, per request, how many DISTINCT earlier turns each
tool failed in SINCE ITS LAST SUCCESS (the review fork caught the shipped
version never closing on recovery — it would have refused decks for the
rest of the conversation it had recovered in); at 2 the tool is not called — `aisdk.ts execute` returns a
`[[NO_WORK]] TOOL DOWN` result and emits an `error` chip saying the call was
not made. The reader's own "try again" is the only thing that re-opens it. One
`console.error('[decke] tool-circuit-open tool=… failures=… conversation=…')`
per tool per request; `conversationId` is now on the `/api/chat` body,
log-only. This is v1 of the owner's ask that Deck-E report tooling faults he
keeps hitting.
**Why:** `battle_logs` 500ed on four turns and was re-called every one of them,
once immediately after promising not to. It was not disobeying: `lookupRecord`
replayed `ok`/`partial` chips only and the server keeps nothing between
requests, so no turn's context contained the fact that any tool had ever
failed. No prompt can reach a fact that is not in the window.
**Implications:** The breaker is turn-scoped, not call-scoped — `repeat.ts`
still owns within-turn repetition. The chip is never `ok` (X2) and never
`declined` (that word means the READER stopped it). The synthetic result tells
him to answer from what he already has and NOT to restate prior summaries,
which is the other half of the same transcript. Deep-tier sub-agents get an
empty ledger for now — deliberate, flagged, not forgotten.

