---
date: "2026-09-26"
title: "Keep list card removal confirmation above virtual rows"
decided_by: "Chey (via Codex)"
areas: ["catalog"]
supersedes: []
---
## 2026-09-26 — Keep list card removal confirmation above virtual rows
**Decided by:** Chey (via Codex)
**Decision:** The list grid owns the selected card and removal confirmation; a tile only requests removal. The confirmation renders outside the virtual rows and outside the tile's `CardLink`.
**Why:** Locking scroll for the confirmation can unmount a tile far down a long list. A dialog owned by that tile disappears before the reader can confirm.
**Implications:** The list write still runs through #219's per-list lane after confirmation. Browser coverage opens removal near the bottom of an 80-card list and checks the dialog remains visible.

