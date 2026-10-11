---
date: "2026-10-10"
title: "Deck-E says what it has found between batches of lookups, nudged by one system line after three silent data steps"
decided_by: "@cheyras (interim progress between groups of tool calls); built by Claude Opus 5.5 and Claude subagents."
areas: ["agents"]
supersedes: []
---
## 2026-10-10 — Deck-E says what it has found between batches of lookups, nudged by one system line after three silent data steps
**Decided by:** @cheyras (interim progress between groups of tool calls); built by Claude Opus 5.5 and Claude subagents.

**Decision:** After three data-tool steps with no words to the reader (`SILENT_DATA_STEPS`), `prepareStep` adds one mid-conversation system message, at most twice per request (`MAX_PROGRESS_NUDGES`, `decke/progressNudge.ts`). The message says: "The reader hasn't heard from you in a while. In one short line, tell them what you've found so far. Only if you're not done, add what you're checking next, then continue."
- The nudge goes in after the cache breakpoint, which stays on the newest non-system message, so it never moves or marks the cached prefix.
- It goes only to Anthropic models (`allowSystemInMessages: isAnthropic(choice)`).
- It never goes on a leg where an ask card is still open.

A nudge must never end a turn on its own:
- The step that answered a nudge is excluded from `spokeAndSettled` (the ledger's `landings`).
- The step-budget and empty-answer guards count only text after the last lookup (`textAfterLastLookup`), so an interim line no longer switches them off.

The replay probe now stops the way production does (`spokeAndSettled` with landings, plus the ask stop) instead of only at the step cap. The gateway probe checks that the message reaches Claude: the lookup after the nudge happens, and the nudged step's input grows.

**Why:** The owner asked for short updates between groups of tool calls ("got it, I'll start doing some research… interesting, I'm finding some good information"), so a long turn is not a silent minute.

A first review found the blocker this design guards against: a nudged "checking your list next" plus a face could settle the turn and become the whole reply. The probe could not see it, because it never ran production's stop rule.

Live A/B after the fixes (routed arm, six long scenarios × 3, 2026-10-11):

| Arm | Long turns with a progress line | Longest silent run | Scenario passes | Early stops | Cost |
|---|---|---|---|---|---|
| Nudge on | 4 of 7 | 4 steps | 14/18 | 0 | $0.70 |
| Nudge off | 1 of 6 | 6 steps | 12/18 | 0 | $0.73 |

A first, smaller A/B pointed the same way: 1/3 vs 0/4. Neither sample is large, but every measure points the same way, and the nudge costs nothing measurable.

**Implications:**
- The cap is per HTTP request, not per reader turn, so a turn split across approval legs can be nudged on each leg.
- Once nudged, every later step of that call carries the system message, so Standard's Gemini failover sees it too. The gateway probe checked it live, and `google/gemini-2.5-flash` accepts it.
- `battle-review-all-decks` failed 0/3 in both arms. That is a new scenario's grader or fixture problem, not the nudge, and it should be looked at before it is used as evidence.
- One `[deck-e] progress nudge` log line (step and count, no content) per nudge says how often it fires in production.
