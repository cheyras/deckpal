---
date: "2026-09-27"
title: "Preserve import fixes across manual line edits"
decided_by: "Chey (via Codex)"
areas: ["decks","frontend"]
supersedes: []
---
## 2026-09-27 — Preserve import fixes across manual line edits
**Decided by:** Chey (via Codex)

**Decision:** Tie each Deck-E suggestion to the physical pasted line it came from. An edit or deletion invalidates only that line's suggestion; unchanged lines keep theirs even when their positions move.

**Why:** Clearing the entire repair response after a manual edit discarded paid suggestions for other lines and could leave the reader importing an unfixed original line.

**Implications:** The dialog maps surviving suggestions to current line positions before showing or applying them. Deleting one of several identical lines invalidates their suggestions because the surviving occurrence cannot be identified safely. The import dry run checks the combined text, and a fresh explicit skip is required for any unresolved lines after a manual edit.
