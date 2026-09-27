---
date: "2026-08-22"
title: "Failure is the deliberate exception to a quiet transcript"
decided_by: "Claude, from the owner's recorded incident."
areas: ["frontend"]
supersedes: []
---
## 2026-08-22 — Failure is the deliberate exception to a quiet transcript
**Decided by:** Claude, from the owner's recorded incident.
**Decision:** tool rows are quiet by default; `partial` and `error` get a distinct
tone, an explicit label in words, detail already expanded, and a retry. A
timed-out deep call resolves `partial`, never `ok`.

**Why:** the owner read *"The analyze tool timed out before it could finish
reading your full collection"* on camera and called it *"a great response"*. He
did not notice it had failed.

**Implications:**
- `partial` is a new wire phase, so `previewOf` and the replayed evidence record
  both had to stop filtering on `ok` alone. The replay labels partials as
  incomplete rather than dropping them, or he quotes a half-finished reading with
  more confidence the second time.
- There are **three** ways a deep call is incomplete, not one: the wall clock, the
  output budget, and the step cap.
- A conversational turn that spends its whole step budget without speaking now
  says so, instead of leaving an empty bubble after half a minute.
- `set_progress`'s title was "Set completion progress" — a noun phrase that parses
  just as easily as an imperative. Renamed "Check set completion": a read tool
  whose row tells a reader something wrote to their collection is a trust defect
  in a surface whose entire job is saying truthfully what happened.

