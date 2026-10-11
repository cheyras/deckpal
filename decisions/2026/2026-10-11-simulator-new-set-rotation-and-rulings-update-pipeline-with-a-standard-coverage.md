---
date: "2026-10-11"
title: "Simulator: new-set, rotation and rulings-update pipeline with a Standard coverage gate"
decided_by: "@cheyras (asked for the ad-hoc catch-up work behind #318 to become a repeatable, documented pipeline); built by Claude Sonnet 5.5."
areas: ["decks", "agents"]
supersedes: []
---
## 2026-10-11 — Simulator: new-set, rotation and rulings-update pipeline with a Standard coverage gate
**Decided by:** @cheyras (asked for the ad-hoc catch-up work behind #318 to become a repeatable, documented pipeline); built by Claude Sonnet 5.5.

**Decision:** Keeping the battle simulator (`packages/sim`) complete after #318 is a fixed sequence of commands, documented in `packages/sim/CARDS.md` ("New set, rotation, FAQ update"), instead of ad-hoc scripts:

- `scripts/sync-frames.ts` fetches the printed frame of every Standard printing the snapshot lacks from the public catalog.
- `scripts/refresh-card-tables.ts` regenerates `cards/tera.ts`, `cards/tags.ts` and `cards/printed-wr.ts` from pokemontcg.io, matched against the full catalog (every printing, not the frame snapshot's one-per-text), with id and name verified before anything is written, a diff summary, and a `--check` mode. Against the live API it reproduces the three committed tables byte for byte.
- `src/__tests__/standard-coverage.test.ts` is a gate in the normal suite: it fails, listing the cards, when a Standard printing in the snapshot is neither scripted nor vanilla.
- `scripts/new-card-lanes.ts` (replacing `standard-lanes.ts`), then the existing `standard-tiers.ts` and `codegen-cheap.ts` (which now takes `--name` so a new set gets its own generated file instead of overwriting `std-gen.ts`), turn the uncovered cards into scripting batches with their frames and rulings.
- `scripts/rulings-sync.ts` downloads the Pokémon Rulings Compendium's full list, keeps an index of it as `packages/sim/data/rulings-compendium.json` (id, date, the names it is filed under, source label, a hash of question + answer; no ruling text, because the repo is public and the text stays on compendium.pokegym.net), and reports rulings new or changed since the last index that name a scripted card, printing their text from the live page, with the script file and whether a test cites the ruling id. That report is the to-do list after each TPCi FAQ update.

**Rotation:** "Standard" is read from `apps/api/src/deck/data/formats.json` (`standard.legal_marks`) by the gate, the gap report, the lane builder, the frame sync and the table refresh. The sim itself has no list of marks and no legality check (the API's `check_deck` does), so a rotation needs no code change and no script is deleted (they still serve Expanded and old logs). `printed-wr.ts` is never shrunk by a rotation: only printings that are Standard now are recomputed, because a printing's Weakness/Resistance is part of its text key.

**Why:** #318 got every Standard card scripted by hand-run scripts whose inputs lived in a scratch directory. The next set, rotation or FAQ update would repeat that work from memory. One mistake from that run is now closed off structurally: matching pokemontcg.io data against the frame snapshot instead of the full catalog left 184 printings without a Weakness.

**Implications:**
- The gate sees only frames already in the snapshot. Run `scripts/sync-frames.ts` after a set releases, or the gate cannot know. Measured on 2026-10-11: 1,431 Standard printings are not in the snapshot, among them 30th Celebration and the Mega promos, and 120 distinct texts of those (117 Pokémon, 3 Items) have no script. They are not added in this change, because adding the frames makes the gate fail until they are scripted. That is the next piece of work, and the lanes for it come from `new-card-lanes.ts`.
- `refresh-card-tables.ts` reports as gaps (not failures) printings whose set pokemontcg.io does not list yet (30th Celebration `me55`, Mega promos `mep`) and one promo it lacks (`svp-190`). Mapping `me55` to our `30th` set would add Weakness/Resistance to six 30th printings and so change their text keys; do that together with scripting the set.
- Rulings matched by the report are a to-do list, not proof: a `text` match can name a different card. The first run on 2026-10-11: 1,944 rulings; 1,256 name a scripted card (468 filed under a card, attack or Ability name, 788 by a mention in the text); 198 of those are cited by a test, 86 only in a script, 972 by nothing.
- The rulings index is about 300 KB. It is refreshed by running the sync and committing the file. `new-card-lanes.ts` downloads the page for its own run and writes ruling text into lane files only, which are not committed.
