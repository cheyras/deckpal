---
date: "2026-08-21"
title: "Deck-E's model routing: escalation is a tool, Sonnet is the default"
decided_by: "@cheyras, on Claude's recommendation."
areas: ["agents","decks"]
supersedes: []
---
## 2026-08-21 — Deck-E's model routing: escalation is a tool, Sonnet is the default
**Decided by:** @cheyras, on Claude's recommendation.

**Decision.** Four deep tools — `plan_deck`, `write_strategy_guide`,
`research_meta`, `analyze_collection` — each a sub-agent with its own model,
step budget and tool subset. `MODELS.analysis` becomes `claude-sonnet-5` with
`claude-opus-5` reachable only when the person explicitly asks for the best
work. Research is `openai/o3-deep-research`.

**Why a tool and not a router.** A classifier turn in front of every message
taxes the 90% that do not need one, and a misroute is INVISIBLE — the answer
still arrives, quietly worse, and nothing says a cheap model answered a question
that needed an expensive one. A tool call appears in the log.

**Why Sonnet by default.** `models.ts` measured one `claude-opus-4.8` analysis
call at $0.0356 against $0.000143 for the chat tier — ~250x — and a realistic
`plan_deck` with a collection in context plus research plus thinking runs
$0.50–$1. Opus-by-default made one to three questions a user's entire monthly
budget. The measurement that originally chose Opus (it found a buried 4x
Charizard / 0 Charmander consistency bug a cheaper model missed) still stands,
which is why `escalate` exists rather than the tier simply being cheapened.

**Why o3-deep-research and not Perplexity or Exa.** Live research sends query
text to a third party. `perplexity/sonar`, `sonar-pro`, `sonar-reasoning-pro`
and Exa are all present on the Gateway key and are all cheaper and faster — and
none is on the US-frontier-labs list `models.ts` records as the owner's
constraint. Adding a vendor to that list is the owner's call; it was made the
other way.

**What that costs, stated rather than glossed.** `gatewayTools.exaSearch`
exposes `include_domains`, which is the real injection control for live
research — an allowlist enforced rather than requested. `o3-deep-research`
searches provider-side, so that control is unavailable. (Separately:
`gatewayTools` is not exported at runtime by the pinned
`@ai-sdk/gateway@4.0.52` — `'gatewayTools' in require(…)` is `false` while the
`.d.ts` declares it, so a typecheck would not have caught a usage. Same class as
the recorded `providerOptions.gateway.cacheControl` defect.)

The compensating controls are structural rather than prompted: the research
sub-agent holds **no tools at all**, so nothing it reads can become an action;
its output is inserted as DATA under a heading saying so; and queries carry card
and archetype names, never collection context.

**A gap recorded honestly.** `ModelChoice.effort` currently only sizes the token
reserve — nothing in this codebase actually sends a reasoning-effort parameter
to any provider. The reserve is the mitigation that matters (four measurements
of reasoning models returning empty content with `finish_reason: "length"`), but
the parameter itself is unwired. Wiring it needs a live probe per vendor, not an
inference — see the `cacheControl` scar.

