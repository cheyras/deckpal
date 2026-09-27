---
date: "2026-09-27"
title: "Deck-E show-me walks end on the cards"
decided_by: "Chey (via Claude)"
areas: ["decke"]
supersedes: []
---
## 2026-09-27 — Deck-E show-me walks end on the cards
**Decided by:** Chey (via Claude)

**Decision:** When someone asks to see particular cards, Deck-E's `escort` walk takes their ids (`cardIds`, same set only, at most 8) and ends on the cards rather than the set page: after opening the set it flies to the first card through the grid's reveal handshake (scrolling it into view), then rings every matching card that is on screen.

**Why:** On the owner's phone he walked to SWSH Black Star Promos, said the cards were "in the grid" and stopped. `escort` only accepted a series and a set, so a walk could only end on the set page; the model knew the card ids but had no way to hand them to the walk, so it narrated the last step instead of taking it.

**Implications:** The prompt and tool description tell the model to pass `cardIds` whenever the question named cards. The longest walk is 8 steps. Cards scrolled out of view are not ringed; the result says how many of the N were ringed, so he can speak honestly about the rest.
