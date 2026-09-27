---
date: "2026-09-26"
title: "Deck-E suggests catalogue-verified fixes during deck import"
decided_by: "Chey (via Codex)"
areas: ["agents","data","decks","catalog"]
supersedes: []
---
## 2026-09-26 — Deck-E suggests catalogue-verified fixes during deck import
**Decided by:** Chey (via Codex)
**Decision:** The import dialog can ask Deck-E to suggest replacements for lines the normal importer could not match. The server offers only real catalogue candidates, accepts model-selected keys only, and re-resolves every replacement to the chosen card. The reader can undo each suggestion; confirmed text is checked again before a deck is created. Common legacy and handwritten decklist forms are parsed directly, without a model call. The fix request uses one daily Deck-E turn and no credits.
**Why:** An import should never silently lose cards, and editing every unmatched line by hand requires knowing set codes. A model is useful for ambiguous names but cannot be trusted to invent a card or choose a printing without verification.
**Implications:** The route requires `decke.use`, the dedicated Deck-E Gateway key, and daily accounting. It writes no deck; Confirm remains the reader's write action. Uncertain suggestions abstain and leave the existing Edit/skip flow. The product preferences for hidden Deck-E and owned versus regular printings remain subject to Chey's review.
