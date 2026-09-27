---
date: "2026-08-23"
title: "C21: the thinking beat fires on real events, and never on failure"
decided_by: "Claude, resolving C21 + OR3."
areas: ["general"]
supersedes: []
---
## 2026-08-23 — C21: the thinking beat fires on real events, and never on failure
**Decided by:** Claude, resolving C21 + OR3.
**Decision:** `character/host/thinkingBeat.ts` decides, as a pure function,
whether a tool chip earns a brief `once` state change. It fires on a call that
FINISHED (`ok`) and on a progress note that LANDED — the owner's *"little
responses in between"* — rate-limited to one per 4s, and never under reduced
motion.

**Why.** C21: *"he's just kind of stuck in this one thing … he can kind of show
a different emotion for a sec and then go back to thinking."* The brief filed it
as blocked on there being no tool-boundary hook. C20 shipped one — the single
chip writer every real tool event passes through — so the hook exists and this
is the orchestration the brief said was missing. It hangs on that writer rather
than a timer because a timer would fire while nothing was happening, which is
the fabricated status surface X2 forbids.

**Implications:**
- **No beat on `error` or `partial`.** Crolic et al., *Journal of Marketing*
  86(1) 2022: anthropomorphic warmth aimed at someone whose thing just broke
  measurably lowers satisfaction, with no offsetting gain on anyone else. The
  failure row is already loud and auto-expanded by design (D2); a character
  flourish beside it competes with the one row that has to be read. **When
  something breaks, he goes plain.**
- `nod_yes`, not `happy`: punctuation, not a claim about a result nobody has
  read yet. Distinct from the `curious` beat that marks the answer ARRIVING
  (OR3, `useDeckeChat.ts`), so the two moments do not blur into one gesture.
- The allow-list line IS the rule. An earlier draft had a separate
  `error || partial` guard that was **unreachable**, and it was caught only by
  mutating the code and noticing the failure test did not go red.
- **OR3/C54 was already shipped** and `COVERAGE.md` recorded it as NOT SHIPPED —
  the audit predates the commit.

