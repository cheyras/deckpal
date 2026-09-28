---
date: "2026-09-27"
title: "Accept TypeSafe retention for Deck-E's Jev judgments"
decided_by: "Chey"
areas: ["general"]
supersedes: []
---
## 2026-09-27 — Accept TypeSafe retention for Deck-E's Jev judgments
**Decided by:** Chey

**Decision:** Jev (`typesafe-ai/jev`) may be switched on with `DECKE_JEV=on` even though TypeSafe may retain what it is
sent. Zero data retention is offered only to TypeSafe enterprise customers on request, and DeckPal is not one.

**Why:** Chey, 2026-09-27: "Pokemon cards isn't that sensitive of data, so I think it's probably OK." Jev receives the
reader's latest message (clipped to 2,000 characters), Deck-E's previous reply (last 800), the page path, and for the
after-turn audit the reply he just gave. That is card-collection conversation. TypeSafe states it does not train Jev
on customer requests or responses. The Vercel AI Gateway lists Jev with `zdr: "none"`.

**Implications:** A reader can type anything, so Jev can see whatever a reader writes, including account details they
choose to share. SECURITY.md now records the retention as accepted rather than unconfirmed. Requests keep
`zeroDataRetention: true` and the `only: ["typesafe-ai"]` pin: the flag costs nothing and applies if TypeSafe ever
honours it through the Gateway, and the pin keeps Jev off the second, non-ZDR host. DeckPal has no privacy page yet;
when one is written, it should name TypeSafe among Deck-E's AI processors.
