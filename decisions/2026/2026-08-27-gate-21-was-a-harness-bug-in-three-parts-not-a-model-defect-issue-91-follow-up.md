---
date: "2026-08-27"
title: "Gate 21 was a harness bug in three parts, not a model defect (issue #91 follow-up)"
decided_by: "Claude Opus 5 on behalf of @cheyras"
areas: ["agents"]
supersedes: []
---
## 2026-08-27 — Gate 21 was a harness bug in three parts, not a model defect (issue #91 follow-up)

**Decided by:** Claude Opus 5 on behalf of @cheyras

**Decision:** Gate 21 is deterministic. Measured **6/6 PASS** against production,
against a baseline of 4/9 and 5/9 in the same hour. Three separate defects, all
in the harness, none in Deck-E.

**It took two wrong diagnoses to get there, and both are worth recording**
because each was plausible and each was refuted by measuring rather than by
argument.

- *Wrong #1 (the original triage):* the failure looked like "a botched rules
  list" — he answered a follow-up about his own progress with no lookup. A
  control run put the branch at 4/9 and `main` at 5/9, which killed it.
- *Wrong #2 (mine):* I read the failing assertion as the cause — the gate
  demanded a data tool on the SECOND turn, which turn one had already done.
  Fixing that changed nothing: the gate still failed, now reporting "asked for a
  percentage and gave none".

**What it actually was.**

1. **A false receipt.** `submitDraft` treated `chatPosts.length > before` as
   proof the message was sent. A late leg of the PREVIOUS turn satisfies it, so
   the harness reported success for a message never sent — then sliced from
   `before`, got turn one's trailing leg, and read its set description as the
   answer to "what percentage?". A harness miss rendered as a verdict about the
   model, which is the exact failure that function's own comment says it exists
   to prevent. It was checking the wrong property. The receipt is now an
   identity check: the post body carries the whole conversation, so a post made
   before this sentence was typed cannot contain it.

2. **A single-sample look at a changing state.** `ensureComposer` looked once,
   clicked the minimise bar if it happened to be there, then waited. The panel's
   state moves underneath that. It polls now.

3. **A state it did not know existed.** The panel has three states, not two.
   Measured on production: ask him to open a set and the panel survives the
   navigation (t+2s) and outlives it (t+3s), then at **t+21s closes outright** —
   "Close chat" and "Stop" go with it, so it is a close and not a minimise.
   `ensureComposer` knew "present" and "minimised behind a bar" and had no route
   back from "closed". Nothing is broken for a reader: the launcher is right
   there. The harness simply had no way home from a room it had never seen.

**The grounding check was still wrong, and is still fixed.** Gates 4 and 21
required a data tool on the follow-up turn; turn one fetches the set and this
account's progress on it, so answering from that is correct. Now
conversation-scoped, with both scopes printed.

**Regression-checked, because these helpers are shared by all 23 gates.** Gates
4, 13 and 20 pass. Gates 3 and 23 fail at the same rate with and without the
change — gate 3 at 1/3 either way, gate 23 failing both arms with *different*
reasons — so both are pre-existing live-model variability on production, and
neither is caused by this.

**Implications.**
- A harness receipt must identify the thing it is a receipt FOR. "Something
  happened" is not "my thing happened".
- Gates 3 and 23 are flaky on production today. Do not read either as a
  regression without running `main` alongside.


---

