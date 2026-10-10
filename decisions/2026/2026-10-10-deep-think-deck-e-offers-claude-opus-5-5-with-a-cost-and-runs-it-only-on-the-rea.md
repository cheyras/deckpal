---
date: "2026-10-10"
title: "Deep Think: Deck-E offers Claude Opus 5.5 with a cost and runs it only on the reader's signed OK"
decided_by: "@cheyras (the name, \"always ask, with a cost\"); built by Claude Opus 5.5 directing Codex workers and Claude subagents."
areas: ["agents", "frontend", "credits"]
supersedes: []
---
## 2026-10-10 — Deep Think: Deck-E offers Claude Opus 5.5 with a cost and runs it only on the reader's signed OK
**Decided by:** @cheyras (the name, "always ask, with a cost"); built by Claude Opus 5.5 directing Codex workers and Claude subagents.

**Decision:** Deck-E's top tier is **Deep Think**, Claude Opus 5.5 at effort `high`. Deck-E offers it with a `deep_think` tool (`why`, `plan`) only when the request truly benefits — a game with a lot to learn from, a season of results, tournament prep with a meta read — or when the reader asks for depth (triage `wantsDeep`). The tool needs approval, so the AI SDK raises the signed consent card; the card shows the reason, the plan and a server-computed estimate ("About 40–120 credits", `decke/deepThink.ts` `estimateCredits` per pathway), never a model-written number, with the existing top-up route when the balance is below the high estimate. The next leg runs on Opus only when this turn's replay carries an approved `deep_think` part (`deepApprovedThisTurn`); a forged approval fails the SDK's HMAC check before any model call. A Deep Think request holds more credits up front: migration 083 gives `decke_metered_begin` a hold multiplier bounded 1–10 (Deep Think asks for 8× the 25-credit hold); settlement is still the Gateway-reported cost and the unused hold returns. "Keep it quick" is an ordinary decline: the turn stays on Standard.

**Why:** The owner wants the expensive reasoning available "when it truly, truly would benefit", asked for with a name and a cost rather than prompted for constantly (2026-10-10). Opus 5.5 costs $4 / $20 per MTok — twice Sonnet 5.5 — and a deep analysis with research can run well past the ordinary 25-credit hold, which would stop the chat mid-work (`meteredCapReached`). Consent is a signed approval because that is the one mechanism in Deck-E the browser cannot forge.

**Implications:**
- Migration 083 must be applied to production before this deploys; its function body is 081's byte-for-byte except the bounded multiplier, and its grants restore 081's exactly (the CI DB suite, `metered.mjs`, covers default, 8× and out-of-range).
- Approval is per turn; the next reader message starts on whatever triage picks.
- Browser proof: `tests/browser/deepThinkCard.mjs` at 1440 and 390 (docked card, server estimate, approve/decline wire).
