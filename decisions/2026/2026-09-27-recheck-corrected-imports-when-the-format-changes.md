---
date: "2026-09-27"
title: "Recheck corrected imports when the format changes"
decided_by: "Chey (via Codex)"
areas: ["deck-import", "frontend"]
supersedes: []
---
## 2026-09-27 — Recheck corrected imports when the format changes
**Decided by:** Chey (via Codex)

**Decision:** Changing an import's format checks the current paste-box text again without creating a deck. Accepted Deck-E corrections keep their review rows and Undo controls across format changes. The dry run also reports card-specific format violations; an accepted correction with such a violation returns to an editable unmatched row with the reason, and Import stays disabled until the reader resolves it or selects a format that allows it.

**Why:** The prior check described the original text and format. After accepting corrections and switching Standard to Expanded and back, the corrected text remained while the review and import path disappeared.

**Implications:** The check result is tied to both current text and format. Format changes never auto-import. The existing deck importer still permits deliberately importing an illegal deck through its normal path; this guard applies to accepted Deck-E corrections in the import review.
