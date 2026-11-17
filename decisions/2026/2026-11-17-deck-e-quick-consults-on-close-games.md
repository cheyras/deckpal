---
date: "2026-11-17"
title: "Deck-E Quick consults on close games"
decided_by: "Chey (via Claude)"
areas: ["agents", "decke"]
supersedes: []
---
## 2026-11-17 — Deck-E Quick consults on close games
**Decided by:** Chey (via Claude)

**Decision:** On the Quick tier, a `battle_digest` result for a close game now ends with one line addressed to the model: call `consult` once before writing the review, with the digest and the reader's own words as the brief and "what decided this game, and the one lesson" as the question. The shared tool reports `closeGame` in its `structured` echo (text unchanged); Deck-E's adapter appends the line (`apps/api/src/decke/closeGameConsult.ts`) only when the request holds `consult`, a predicate shared with `toolsForTier` (`tierOffersConsult`, Quick only). The battle_log pathway gains the same rule: a close game is worth the consult whatever its depth line says, called before any review is written.

**Why:** The live replay probe `battle-log-digest-consult` (a close 4–6 loss on Quick) read the digest and skipped `consult` in 2 of 2 runs, so Haiku wrote the review himself. The pathway is read once, long before the digest arrives; the digest result is the last thing he reads before writing. The other options were a firmer pathway line alone (kept as well, but a prompt line is what already failed) or routing close games to Standard (triage cannot see closeness before the game is logged).

**Implications:** MCP output is unchanged: `toCallToolResult` never sends `structured`, and tests in `packages/agent-tools` and `apps/mcp` pin that the shared text never names `consult`. The consult's limits are unchanged (at most 2 per request, metered at cost, answer never grounding). Close games with a `brief` depth line (possible: `closeGame` allows a 2-Prize gap that the review score may not count) now also cost a consult on Quick; the backlog item asked for a consult on every close game, so this is intended, and the place to narrow it is `closeGameConsultNote`. Re-run the probe after merge to confirm the behavior moved: `node scripts/decke-replay-probe.mjs --arms routed --n 3 --scenarios battle-log-digest-consult --budget-usd 1`.
