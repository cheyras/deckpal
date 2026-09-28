---
date: "2026-09-27"
title: "Jev is covered by the Gateway's zero-retention agreement"
decided_by: "Chey"
areas: ["general"]
supersedes: []
---
## 2026-09-27 — Jev is covered by the Gateway's zero-retention agreement
**Decided by:** Chey

**Decision:** Jev (`typesafe-ai/jev`) may be switched on with `DECKE_JEV=on`. Its data handling is acceptable, and on
verification it is better than first feared: through the Vercel AI Gateway, TypeSafe is covered by Vercel's
zero-data-retention agreement.

**Why:** Chey first accepted possible retention ("Pokemon cards isn't that sensitive of data, so I think it's probably
OK"), then asked for it to be verified. Verified 2026-09-27: Vercel's AI Gateway ZDR page
(https://vercel.com/docs/ai-gateway/security-and-compliance/zdr, updated 2026-09-22) lists TypeSafe AI as a ZDR provider:
"Except as necessary to comply with its legal obligations, TypeSafe shall not retain (a) prompts that are Customer Data
for any longer than is necessary to generate Output for Customer and (b) Output for any longer than necessary to enable
TypeSafe to fulfil its obligations to Customer under the Agreement." DeckPal sets `zeroDataRetention: true` and
`only: ["typesafe-ai"]` on every Jev request, and the Gateway fails such a request rather than route it to a provider
that retains. TypeSafe's own enterprise-only ZDR offer applies to direct customers, not Gateway traffic. TypeSafe does
not train on requests. The Gateway's model list still shows `zdr: "none"` for Jev; the per-provider agreement is what
governs routing.

**Implications:** Keep `zeroDataRetention: true` on every Jev request. It is what makes the agreement apply, and without
it the Gateway may route to a host that retains. Per-request ZDR needs a Vercel Pro or Enterprise team. If the Gateway
ever drops TypeSafe from its ZDR list, Jev requests fail closed, and Deck-E behaves as if Jev were off. A reader can type
anything, so Jev sees whatever a reader writes, only for as long as it takes to answer. DeckPal has no privacy page yet;
when one is written, it should name TypeSafe among Deck-E's AI processors.
