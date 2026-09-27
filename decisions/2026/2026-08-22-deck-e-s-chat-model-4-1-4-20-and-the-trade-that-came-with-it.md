---
date: "2026-08-22"
title: "Deck-E's chat model: 4.1 → 4.20, and the trade that came with it"
decided_by: "@cheyras, on a measured recommendation."
areas: ["agents","decks"]
supersedes: []
---
## 2026-08-22 — Deck-E's chat model: 4.1 → 4.20, and the trade that came with it
**Decided by:** @cheyras, on a measured recommendation.

**The defect.** Asked "where do I change my completion goal?" with a real
landmark and a set route, `grok-4.1-fast-non-reasoning` called `flyTo` **0/5**.
It wrote the call out as bare prose instead — `flyTo [data-decke-goal-switcher]
with point: true` — 5/5. The flight never happened, on every page with a
landmark, which is half of what makes him a character rather than a text box.

**What was ruled out first**, with numbers, because "change the model" is the
expensive answer and should be the last one. Five prompt rewrites moved it 0/5
each: making "movement is a TOOL CALL, never text" explicit, quoting the failure
back at him, moving the section for recency, hardening `flyTo`'s description,
and typing the landmarks as an enum. Tool count was not it (7 tools scored 1/5
against 34 tools' 0/5). The `express` schema was not implicated — he never
called `express` on those turns either, and the successor produced 0/10
malformed commands against the identical flat schema.

Same prompt, same 34 tools, only the model changed: **4.20 calls it 5/5**, clean,
with zero narration across 32 turns.

**What the switch cost, both recorded because a table of measurements is worth
nothing if the inconvenient half is left out:**

*Restraint changed.* 4.1 was silent 6/6 on plain "hey"/"thanks"; 4.20 fires a
small nod 6/6. Measured as a regression against the prompt's governing rule
("silence is a valid emission") and **accepted as a direction by the owner** —
more expressive is the character being aimed at, and a nod on "hey" is a
different thing from an emotion fired at random. The rule stays in the prompt,
because it still governs the states that mean something.

*It costs 7.49x, not the 6.25x on the pricing page.* $0.01153/turn against
$0.00154. The gap is caching, and it was verified directly rather than taken
from the report: identical 2k-token prompt, second call, 4.1 read 663 tokens
from cache and 4.20 read 128. Across the bake-off, 98.4% cache-hit and 365
no-cache input tokens per turn versus 67.1% and 10,078. The heavy implicit
caching that helped pick 4.1 largely does not apply. Also ~340 ms slower TTFT,
in all six scenarios rather than on average.

**Held:** lookup 5/5, correction 5/5, navigation 5/5 with the canonical route.
Schema validity *improved* — 0/16 malformed against 4.1's 3/30.

**One consequence checked rather than inherited.** `models.ts` records that
grok-4.20 accepts the `minLength`-nested-in-array-items constraint 4.1 rejects,
and we now run 4.20. Confirmed on the same nested shape: 4.1 silently made no
call, 4.20 called the tool. The `.min(1)` workaround in `tools.ts` stays anyway
— it costs nothing, and the declared fallback is still a model where the defect
is live, so restoring the constraint would buy a tighter schema and reintroduce
a silent failure the day the fallback is used.

