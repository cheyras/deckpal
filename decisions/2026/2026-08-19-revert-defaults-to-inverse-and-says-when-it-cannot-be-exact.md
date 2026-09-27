---
date: "2026-08-19"
title: "Revert defaults to `inverse`, and says when it cannot be exact"
decided_by: "Claude (on behalf of @cheyras)."
areas: ["general"]
supersedes: []
---
## 2026-08-19 — Revert defaults to `inverse`, and says when it cannot be exact
**Decided by:** Claude (on behalf of @cheyras).
**Decision:** `POST /mutations/revert` (MCP: `revert`) undoes a batch, an event,
a time window, or one entity. `dry_run` defaults to true. For quantities the
default strategy is `inverse` — apply the opposite change — because that leaves
unrelated later edits standing, which is what you want when undoing one of four
duplicate batches after legitimately buying more cards. `restore` forces the old
value back and is the only sensible meaning for a name, a strategy guide, or a
deleted row.

**Where an exact undo is impossible, it refuses.** Three cases are reported as
conflicts and skipped without `force`:
1. the original event clamped (`requested ≠ effective`) — its own record is lossy;
2. the inverse would itself clamp;
3. a later event asserted an ABSOLUTE quantity on the same entity — subtracting
   from an asserted count means something different from what was asked.

An event is never marked reverted unless the applied change equalled the exact
inverse; a partial undo is recorded as an ordinary change, so the original keeps
showing as outstanding, which is the truth.

**Worked example of case 1** (why no strategy can fix it): quantity 2 → event A
sets it to 0 (effective −2) → event B asks for −1, floors to an effective 0 and
is therefore never recorded. Reverting A by inverse gives 2. The counterfactual
history without A is 2 − 1 = 1. B's intent was destroyed at write time.

