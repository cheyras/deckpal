---
date: "2026-10-11"
title: "Simulator: the 30th Celebration set, with catalog text gaps patched where frames enter the engine"
decided_by: "@cheyras (asked for every Standard-legal card to play by its text and rulings); built by Claude Sonnet 5.5 lanes, verified by Claude Opus 5.5."
areas: ["decks"]
supersedes: []
---
## 2026-10-11 — Simulator: the 30th Celebration set, with catalog text gaps patched where frames enter the engine
**Decided by:** @cheyras (asked for every Standard-legal card to play by its text and rulings); built by Claude Sonnet 5.5 lanes, verified by Claude Opus 5.5.

**Decision:** The 30th Celebration set and the Mega promos (120 texts) are scripted, so every Standard printing in the catalog is covered. Where the catalog's own data for these printings is wrong or missing, the simulator corrects it at the point a frame enters the engine. It does so next to `withPrintedWR`, in `frames-all`, the registry, `createContext`, the replay and `maintenance/gap`, so runtime frames are corrected too:
- `cards/clean-text.ts` (`withCleanText`) turns HTML Energy spans (`<span class="energy-symbol Lightning">`) into `{L}`, strips other tags and decodes entities. Such a printing then has the same text, and the same script, as the card written with `{L}`.
- `cards/evolves-from.ts` (`withEvolvesFrom`) fills in the parent of the 33 Stage 1/Stage 2 printings that lack one. An audit test fails when a Standard evolution has no parent or its parent is not one stage below.
- Trainers with no catalog text (Poké Pad, Switch, Ultra Ball) are scripted from the printings they reprint.

Four new engine capabilities cover the last cards:
- a Weakness multiplier (Illumise);
- Trainer interception by a coin flip (Seismitoad);
- a heal lock that respects Ability protection (Yveltal);
- borrowed attacks run as the borrower's own (Mew ex, rulings pinned).

**Why:** Without the parent, an evolution can't be played onto anything. Without cleaning, an HTML printing looks like a different, unscripted text. Patching at the frame entry points fixes every path at once, and it leaves the catalog untouched: the catalog belongs to the app, not the simulator.

**Implications:**
- Every new set can bring the same gaps. Audit missing `evolvesFrom`, missing Trainer text and markup in text per set; `evolves-from.test.ts` and the coverage gate catch the first two.
- The catalog itself should be fixed upstream eventually. Once it is, the table entries become no-ops and can be deleted.
- A reprint whose cleaned text matches an existing script needs no copy. `dupes.ts` flags identical scripts.
