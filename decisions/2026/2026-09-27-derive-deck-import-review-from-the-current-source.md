---
date: "2026-09-27"
title: "Derive deck import review from the current source"
decided_by: "Chey (via Codex)"
areas: ["deck-import", "frontend"]
supersedes: []
---
## 2026-09-27 — Derive deck import review from the current source
**Decided by:** Chey (via Codex)

**Decision:** Replace independently patched import summaries and review rows with one reducer and projection. Current text, format, stable physical line IDs, accepted correction provenance, and a read-only check tagged with the exact source revision determine the rows, Undo, legality, and write gate. Every source change triggers a fresh check after review starts. Only the explicitly labelled “Import without them” action grants skip permission for the unresolved line IDs in that revision; the final check must pass the same gate before creating a deck.

**Why:** Relabelling an old summary as checked let Undo after a format switch silently omit a card, and a blank-line edit erase an illegal-correction guard. Those failures shared a state-design cause, so individual event-handler patches could not establish the invariant.

**Implications:** Deck-E remains beside the lines. Accepted fixes update the paste box immediately; Undo restores the exact occurrence. Whitespace-only edits preserve identity. Ambiguous duplicate deletion drops the active Undo association, while accepted card provenance survives for the dialog lifetime so it cannot bypass legality. Raw decks still retain the existing ability to import illegal cards; only cards accepted as corrections in this dialog receive this guard. No API, database, migration, or infrastructure change is needed for this refactor. Unit and seeded action-sequence tests exercise the same reducer as the UI, with browser regressions at 1440px and 390px. The supervisor publishes the proof board and syncs the wiki under the PR handoff protocol.
