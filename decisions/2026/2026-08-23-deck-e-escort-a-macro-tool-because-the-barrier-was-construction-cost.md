---
date: "2026-08-23"
title: "Deck-E: `escort`, a macro tool, because the barrier was construction cost"
decided_by: "Claude, on evidence, after an adversarial consult (Fable)."
areas: ["agents","decks"]
supersedes: []
---
## 2026-08-23 — Deck-E: `escort`, a macro tool, because the barrier was construction cost
**Decided by:** Claude, on evidence, after an adversarial consult (Fable).
**Decision:** Add an `escort({ seriesSlug, setId?, opener? })` tool alongside
`journey`. It carries no steps and names no landmark; the browser expands it
into journey steps (`apps/web/src/character/host/escortPlan.ts`) and runs them
on the existing sequencer. `journey` stays for walks the macro cannot express.

**Why.** Asked "help me find Pitch Black", Deck-E described the destination
instead of going there in 8 of 10 measured turns, ending `finishReason: "stop"`
with an empty `toolCalls` array. Every prompt lever tried against it measured at
roughly nothing — including the exact template that had moved writes from 0/20
to 9/20.

The control group is inside our own system and it settles the cause:

| tool | argument | measured |
|---|---|---|
| `goTo` | one route string | 100% nav (`models.ts:159`) |
| `express` | a flat array | called routinely |
| `journey` | a compiled multi-step program | skipped 8/10 |

Same model, same prompt, same turn. **The barrier is not "may I" but "can I".**
Prompt emphasis lowers reluctance; it cannot lower construction cost — which is
why the write-approval doctrine worked there and did nothing here.

And the construction was never necessary. `journey.ts`'s own header states it:
*"the selectors are constructible from ids the data tools return BEFORE anything
moves."* That file argues for one-plan-not-four-turns by proving the path is
deterministic, then hands the deterministic compilation to the model anyway.

**Implications:**
- The model's burden for an escort drops to `goTo`'s difficulty class — two ids
  `search_cards` already returned.
- `escort` has no server `execute`, so it is a `CLIENT_TOOL`; the structural
  test in `tools.test.ts` enforces that pairing.
- `deckpal-web` does not depend on `deckpal-api`, so the two halves meet on a
  literal: `escort.test.ts` asserts the real `journeySchema` accepts the expanded
  plan, and `escortPlan.test.ts` asserts the builder produces it. Verified
  failable — breaking the builder three ways fails five tests.
- Two defects fixed in the same commit: `goTo` claimed "TAKEN **or SHOWN**",
  colliding with `journey`'s "SHOWN the way" on this exact query (contested
  selection is a documented cause of calling *neither*, and the data agrees — 2
  journeys, 0 goTo-only); and the prompt instructed `say` to come *before* the
  move it belongs to, canonising a prose prefix that suppresses the tool call.
- **Unmeasured.** The QA meter was exhausted when this was written. It is
  reasoned, typechecked and unit-tested, not yet demonstrated to move the 2/10.
  `roadmap/plans/decke-experience-pass/ESCORT-PLAN.md` holds the experiment.

