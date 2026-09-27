---
date: "2026-08-27"
title: "The narration filter covers all 36 tools, in the shape each can safely be matched (issue #90 follow-up)"
decided_by: "Claude Opus 5 on behalf of @cheyras"
areas: ["agents"]
supersedes: []
---
## 2026-08-27 — The narration filter covers all 36 tools, in the shape each can safely be matched (issue #90 follow-up)

**Decided by:** Claude Opus 5 on behalf of @cheyras

**Decision:** The 23 data tools and 4 deep tools are now stripped as **element
names** (`<search_cards>…`, `<xai:plan_deck>…`). They are deliberately still
**not** matched by the `name="…"` attribute rule, which stays anchored on the
nine cosmetic tools.

**Why the previous answer was half right.** The first pass excluded these 27
entirely, reasoning that their names are ordinary English — `decks`, `lists`,
`health`, `revert` — and the attribute rule strips a WHOLE ELEMENT on a bare
`name="…"` match, so including them would eat `<input name="decks">`. That
reasoning is correct, and it is a reason to exclude them from **one of the three
shapes**, not from the filter.

The element form carries no such risk. `<decks>` is not a thing prose contains:
a model discussing decks writes the word, not the word in angle brackets — and
this filter already strips `<express>` and `<click>`, words at least as
ordinary, on exactly that reasoning. Treating "ordinary English name" as
disqualifying would have argued against the nine that were already there.

**Both halves are pinned.** New tests assert every data and deep tool is
stripped plain and namespaced, AND that `<input name="decks">`,
`<field name="health">` and `<button name="revert">` still survive — the exact
false positive the exclusion existed to prevent. The survival test passes both
before and after the change, which is what makes it evidence rather than
decoration.

**`DEEP_TOOLS` is a written-out copy, and now a checked one.** `buildDeepTools`
needs live options to construct and the filter runs on a streaming hot path, so
it cannot build a tool set to ask for names. `deep.test.ts` asserts the copy
against `Object.keys(buildDeepTools(…))` — because an unchecked cheap copy is
precisely how `TOOL_TAGS` came to say "seven" while the factory returned nine.

**Implications.**
- Adding a data or deep tool extends the filter automatically via `allTools()`.
- Adding a DEEP tool needs its name in `DEEP_TOOLS`; the test says so if not.
- The attribute rule stays cosmetic-only. Widening it needs its own evidence.
