---
date: "2026-08-22"
title: "Four bugs, one shape: a tool that does not describe its own boundaries"
decided_by: "Claude (Opus 5), on behalf of @cheyras. Recorded as one entry"
areas: ["agents"]
supersedes: []
---
## 2026-08-22 — Four bugs, one shape: a tool that does not describe its own boundaries
**Decided by:** Claude (Opus 5), on behalf of @cheyras. Recorded as one entry
because the pattern is worth more than the four fixes.

Each of these was found by asking the deployed preview a real question, and each
looked like a model defect until the cause was traced:

| What he said | What was actually wrong |
|---|---|
| "No Basic Grass Energy in Pitch Black — checked the catalog, nothing matches" | He had guessed `set_id: 'pbp'`. An unknown set id was just another WHERE clause, so it returned the same empty result as a real miss |
| Drew a grid of five card ids the account does not own, differing between runs | `collection_summary` returned names and no ids; `cardGrid` requires ids |
| Guessed `pb`, `pitchblack`, `pitch-black` before finding `me05` | Nothing mapped a set NAME to an id |
| Four `search_cards` calls for "Pitch Black" before trying `set_progress` | `query` matches CARD names; a set name can never match, and nothing said so |

**The shape: wherever a tool's output cannot answer the obvious next question,
the model fills the gap.** An empty result reads as "not found" rather than
"wrong index". A summary that names things you cannot then display invites you
to invent the missing key.

**So the fixes are in the tools, not the prompt.** `search_cards` checks whether
a filtered-on set exists and says an empty result is NOT evidence the card does
not exist. `collection_summary` returns ids. `search_cards`'s description leads
with what it does not match and points at the tool that does. `set_progress`'s
unknown-id error names the recovery.

This is a better frame than "the model is unreliable", because contract gaps are
findable, fixable and testable, and an instruction not to guess is none of those.

**And one control, because fixing the reason does not remove the capability.**
`grounding.ts` collects the card ids tools actually returned this turn, and
`sanitizeScreen` drops any id that was not among them. An invented id has no
visual tell — it renders as real card art, correctly, for a card that is not
theirs. Chosen over the alternatives on cost, per the research: a Set lookup, no
model call, sub-millisecond, where chain-of-verification and self-consistency
have real measured effect sizes and cost 3-4x per turn. No evidence means
everything passes; it is a check for CONTRADICTED ids, not unproven ones.

