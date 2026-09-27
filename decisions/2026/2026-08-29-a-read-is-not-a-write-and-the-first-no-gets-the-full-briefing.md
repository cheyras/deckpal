---
date: "2026-08-29"
title: "A read is not a write, and the first \"no\" gets the full briefing"
decided_by: "owner, in the 2026-08-29 transcript"
areas: ["general"]
supersedes: []
---
## 2026-08-29 — A read is not a write, and the first "no" gets the full briefing

**Decided by:** owner, in the 2026-08-29 transcript
**Decision:** `wouldMutate` treats `deck_strategy` with no `markdown` as a read
(contract-shaped carve-out mirroring `add_battle_log`'s). Error chips keep the
lines their first line was leading into (`summariseError`). `DECLINED_REASON`
now carries the same `[[NO_WORK]]`-led doctrine the server-side repeat refusal
has carried since #138.
**Why:** "the permission prompt asked if you could WRITE this strategy guide,
when the request really only necessitated reading it" — `deck_strategy` has no
`dry_run`, so every shape classified as a write even though the markdown-less
branch returns before the PUT. The `deck_history` resolver miss rendered as
"The closest is:" with the candidates cut off, because the chip summariser took
the first line and that line is a lead-in. And "after i cancelled, you output a
response that seemed canned like it was fore-assuming that i would say yes" —
the first decline told the model four words ("the reader declined"), while a
repeat decline got the full server-side briefing.
**Implications:** The guide REPLACE is untouched: still always-approval, still
unpreviewable, still name-suppressed after a decline. `ABANDONED_REASON` stays
short and distinct — `declined.ts` compares against it exactly, and an
unanswered panel is not a refusal.

