---
date: "2026-08-21"
title: "Deck-E's conversational model was re-baked and kept its job"
decided_by: "Claude (Opus 5), on behalf of @cheyras."
areas: ["agents","decks"]
supersedes: []
---
## 2026-08-21 — Deck-E's conversational model was re-baked and kept its job
**Decided by:** Claude (Opus 5), on behalf of @cheyras.

**Why re-bake.** `MODELS.chat` was chosen on 593 ms TTFT for a six-tool cosmetic
loop. The job changed: converse, LOOK THINGS UP, and know when to escalate. A
model chosen for how fast it can nod is not automatically right for that, and
the spec's instruction was explicit — "do not assume the incumbent wins; do not
replace it on vibes."

**Method.** 5 trials per scenario, 150 calls, against the real system prompt and
a tool set including the data tools. Scenarios: does it look up rather than
invent; does it stay looked-up when contradicted; navigation; body-language
schema validity; restraint on "hey"/"thanks".

| model | lookup | correction | nav | malformed | restraint | TTFT |
|---|---|---|---|---|---|---|
| grok-4.1-fast-non-reasoning | 100% | 100% | 100% | 2/19 | 100% | 663 ms |
| gemini-2.5-flash | 100% | 100% | 100% | 0/5 | 80% | 1251 ms |
| gpt-5-mini | 0% | 100% | 40% | 6/6 | 10% | 618 ms |
| claude-haiku-4.5 | 100% | 100% | 40% | never fired | 20% | 999 ms |
| gpt-4.1-mini | 100% | 100% | 0% | never fired | 70% | 505 ms |

**Decision.** No change. The incumbent was the only model clean on all five and
also the fastest; `gemini-2.5-flash` stays the fallback.

**The finding that matters most is not in the table.** Lookup rate went from
NEVER — a 20-sample probe of the shipped system saw not one attempt — to 100%.
The model was never the problem. There was nothing to look with.

**Two failures worth keeping**, because both look like model quality and are
not. `gpt-5-mini` answered "which one should I look up?" and then never looked,
and stuffed every optional field onto every `express` command (6/6 malformed) —
the pattern `tools.ts` already records for it. `gpt-4.1-mini` treated "take me
to my decks" as an in-page gesture, calling `flyTo` 5/5 and never `goTo`; it
never leaves the page.

**Also re-checked:** the grok `minLength` bug still reproduces, but now as a
hard HTTP 400 with an EMPTY message rather than an `error` part on a 200. Same
cause, same fix, even less to go on if someone re-adds the constraint.

