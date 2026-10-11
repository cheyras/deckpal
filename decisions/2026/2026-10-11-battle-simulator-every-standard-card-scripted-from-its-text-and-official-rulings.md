---
date: "2026-10-11"
title: "Battle simulator: every Standard card scripted from its text and official rulings"
decided_by: "@cheyras (\"Really we should script every standard legal card... For each card, identify all official rulings regarding them\"; \"Have sonnet write the scripts themselves... Then you verify its work\"); built by Claude Sonnet 5.5 lanes, verified and merged by Claude Opus 5.5."
areas: ["decks", "agents"]
supersedes: []
---
## 2026-10-11 — Battle simulator: every Standard card scripted from its text and official rulings
**Decided by:** @cheyras ("Really we should script every standard legal card... For each card, identify all official rulings regarding them"; "Have sonnet write the scripts themselves... Then you verify its work"); built by Claude Sonnet 5.5 lanes, verified and merged by Claude Opus 5.5.

**Decision:** Every Standard-legal card (regulation marks H, I, J; 3,051 printings, 1,960 distinct game texts) plays by its printed text. A card the engine doesn't script no longer plays "vanilla" (printed damage only) or can't be played: all 1,679 texts with effects are scripted, and the other 281 have no text to script. Each script quotes the printed sentences it implements, and each official ruling about that card's text that changes behaviour is applied, cited (TPCi Rules Team date and Compendium link) and pinned by a test. Rulings come from the Pokémon Rulings Compendium's full by-date list (1,944 rulings), matched to cards by name.

How the work was done and checked:
- **Who wrote what.** Templated Pokémon (an attack worded exactly like one already scripted) are generated deterministically from the tested script with the card's numbers and types (`scripts/codegen-cheap.ts`, 375 cards). Everything else was scripted by Claude Sonnet 5.5 in batches of 25 cards. Seven Sonnet engine batches added the capabilities the batches reported missing (about 60, e.g. Ancient/Future tags, Tera Pokémon, Bench size from Area Zero Underdepths, attacking twice, play locks, reactive attack effects, Knock Out replacement, several Tools, setup-time Abilities). Haiku was tried and dropped: its scripts were plausible but its tests were weak or wrong.
- **Gates every batch passed, re-run by the verifier:** typecheck; the batch's tests; the full suite; the text round-trip (each script rendered back to English must match the printed text, or carry a written allowance); a duplicate-script check; a **mutation gate** (`scripts/mutation-check.ts`: each card's tests must fail when its script is disabled); random-play fuzz of the batch's cards (`scripts/fuzz-cards.ts`); and the real-log replay ratchet.
- **Card data the catalog lacks**, taken from pokemontcg.io's card data and mapped to our ids: Tera Pokémon (`cards/tera.ts`), Ancient/Future tags (`cards/tags.ts`), and the printed Weakness/Resistance of 341 printings, mostly Black Bolt, White Flare and promos (`cards/printed-wr.ts`). The Weakness/Resistance table is applied wherever a frame enters the engine, including frames the app supplies at runtime.

**Why:** The owner wants the simulator usable by other players, not only for their own decks, so every legal card has to behave as printed and as officially ruled. Model routing kept cost down: deterministic generation where the text is a template, Sonnet for the rest, the verifier only for checks, merges and fixes.

**Implications:**
- A new set needs: catalog frames, then `scripts/standard-lanes.ts` / `standard-tiers.ts` / `codegen-cheap.ts`, then Sonnet batches with the same brief, then the same gates. Also refresh `cards/tera.ts`, `cards/tags.ts` and `cards/printed-wr.ts` from pokemontcg.io for the new printings.
- Engine batches must run one at a time (they all edit the flow, interpreter and query code); card batches can run in parallel.
- A real-log replay failure caused by a new correct script is a replay gap, not a script bug: hold the card and fix the replay (three were fixed this way: hidden searches, Ability lines in damage breakdowns, evolutions from a deck search).
- The gates don't catch a wrong reading of the text (one was found by reading a batch report: "if Mightyena is on your Bench" scripted as "this Pokémon is on the Bench"). Scripts marked `status: 'needs_ruling'` record a reading no ruling settles yet.
- Known approximations are written in each card's `notes` (e.g. Pokémon V references treated as ex-only, since no Pokémon V is Standard-legal in 2026).
