---
date: "2026-10-10"
title: "set_progress answers the regular numbered set: goal numbered, cards 1 to the printed total"
decided_by: "@cheyras, on an audit of the questions set_progress could not answer; built by Claude Opus 5.5."
areas: ["agents", "catalog"]
supersedes: []
---
## 2026-10-10 — set_progress answers the regular numbered set: goal numbered, cards 1 to the printed total
**Decided by:** @cheyras, on an audit of the questions set_progress could not answer; built by Claude Opus 5.5.

**Decision:** The `set_progress` agent tool (Deck-E and MCP) takes a fourth goal, `numbered`: one of any variant of each card whose `local_id_numeric` is between 1 and the set's `card_set.card_count_official` (the 165 in "006/165"). Secret rares numbered above the printed total and unnumbered subset cards (TG01, GG01) are outside it. It is a goal value rather than a `numbered_only` flag because it is one goal, `complete`'s card-level rule over fewer cards; a flag would also have combined with master and grandmaster into goals nobody asked for. It is computed live in the tool's own SQL. No migration, no `user_set_progress` row, no API route. With `set_id` it prints the three stored goals for context, a `numbered owned/total` line that says how many cards fell outside the range, then the missing list and cost to finish for the numbered cards only (`rarity` filters still apply). The overview ranks the same sets by numbered completion. A set whose printed total is NULL or 0 gets "numbered: not available" (overview: `numbered n/a`) and no missing list.

**Why:** "What am I missing for the regular numbered Pitch Black set" could only be asked through `rarity_exclude`, which needs that set's exact secret-rare rarity names, and the model got them wrong. The stored goals count secret rares on purpose (SCHEMA §9.2, BEHAVIOR-SPEC §2.1), so changing them was never the fix. The printed total is the only boundary the catalog has for "numbered"; with no printed total there is no honest answer, so the tool says so rather than estimate from `card_count_total` or a rarity list.

**Implications:**
- `card_count_official` gets its first non-display use, as a membership bound only. The denominator is still `COUNT(*)` over real card rows, and the tool says when the catalog holds fewer cards in the range than the printed total. SCHEMA §6/§9.2 note the exception.
- `GOALS` in `packages/agent-tools/src/shared.ts` stays the three stored goals. `numbered` is local to `set_progress`, so `set_cart`, `edit_list` `add_missing`, `user_settings.default_goal` and the `user_set_progress` CHECK are untouched. Adding it to cart or list building would mean teaching `apps/api/src/missing.ts` the same predicate, which is a separate decision.
- The output and structured result for complete, master and grandmaster are unchanged. The unit tests pin the stored goals' text verbatim, and they pass against the pre-change renderer too.
- The membership predicate is SQL, so `apps/api/src/__integration__/numberedSet.mjs` (wired into `scripts/test-db-integration.mjs`) proves it on real PostgreSQL with every migration applied. It covers numbered against secret rares and a TG card, variants collapsing to one row at the cheapest printing, a set with no printed total, the overview, and an owned secret rare not moving the count.
- The web app has no numbered bar. If it gets one, the bar should read the same predicate rather than store a fourth goal row.
