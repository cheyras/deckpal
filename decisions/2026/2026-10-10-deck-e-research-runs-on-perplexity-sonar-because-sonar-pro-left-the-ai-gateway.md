---
date: "2026-10-10"
title: "Deck-E research runs on perplexity/sonar because sonar-pro left the AI Gateway"
decided_by: "Claude Opus 5.5, on @cheyras's instruction to get everything working; found by a live smoke test of PR #293."
areas: ["agents"]
supersedes: []
---
## 2026-10-10 — Deck-E research runs on perplexity/sonar because sonar-pro left the AI Gateway
**Decided by:** Claude Opus 5.5, on @cheyras's instruction to get everything working; found by a live smoke test of PR #293.

**Decision:** `MODELS.research` is `perplexity/sonar` with no fallback (`decke/models.ts`). `ModelChoice.fallback` is now optional, for a job that no second model can do.

**Why:** The AI Gateway catalogue (`/v1/models`, read 2026-10-10) no longer lists `perplexity/sonar-pro`; `perplexity/sonar` is the only Perplexity search model left. Production's startup check logged the missing model on every cold start: "1 configured model id(s) DO NOT EXIST on this Gateway key: perplexity/sonar-pro". Each `web_research` call 404'd on the primary before falling back to sonar. Readers were already getting sonar's answers, plus a failed call's latency. Dropping the dead hop only changes the speed. The 2026-08-25 rule still holds: research falls back only to something that can search, or fails loudly. The Gateway has no other Perplexity search model, so research has no fallback.

**Implications:**
- Research quality is sonar's. The 2026-08 measurement called it "thin: one card on a list question" next to sonar-pro's "real findings, real numbers". A stronger engine is a measured follow-up, not part of this fix. The likely candidate is a Claude model with Anthropic's web search tool through the Gateway, which would also keep research queries with the provider that already writes the reply. It needs a probe before it replaces sonar.
- The privacy page's processor list names Perplexity, which is still true. The 2026-09-27 decision's wording ("`sonar-pro` with `sonar` as fallback") now describes the old configuration.
- `modelCheck.test.ts` pins sonar as the research primary and sonar-pro as absent.
