---
date: "2026-09-26"
title: "A claimed deletion gets an admission, never a forced edit"
decided_by: "Chey (via Codex)"
areas: ["general"]
supersedes: []
---
## 2026-09-26 — A claimed deletion gets an admission, never a forced edit
**Decided by:** Chey (via Codex)
**Decision:** Separate claimed deletion of a list, deck or battle log from other changes in Deck-E's after-turn audit. When Jev detects an unperformed deletion, Deck-E admits that nothing changed; it does not force `edit_list`, `save_deck` or `add_battle_log`, because those tools cannot delete. Collection card removals still use `log_cards`, which can change quantities and raises the signed approval card.
**Why:** The original action labels grouped deletion with creation and edits. A phantom "your deck is gone" could therefore pin `save_deck` and ask for an unrelated change. The revised 43-item synthetic eval includes unperformed deletion of each object and one completed deck deletion. In one paid Jev pass, it caught 17/17 phantom claims, flagged 0/26 clean turns, identified all 17 kinds correctly, and chose the deletion labels for all three new/relabeled phantom examples. The pass cost $0.00353; it does not establish live accuracy.
**Implications:** Only collection, non-deletion list, deck and battle-log claims may start a corrective step. Deleted-object claims follow the existing first-person admission. Jev remains off by default, and any slow or uncertain judgment still falls back to the previous guard chain.

