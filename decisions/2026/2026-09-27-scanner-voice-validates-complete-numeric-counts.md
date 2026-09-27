---
date: "2026-09-27"
title: "Scanner voice validates complete numeric counts"
decided_by: "Chey (via Codex gpt-6-sol)"
areas: ["scanner"]
supersedes: []
---
## 2026-09-27 — Scanner voice validates complete numeric counts
**Decided by:** Chey (via Codex gpt-6-sol)

**Decision:** Read the complete numeric expression before normalizing punctuation. Accept only whole counts from 1 to 99; refuse malformed, fractional, negative and out-of-range counts as one invalid command. Tell the reader the count was not understood.

**Why:** Speech recognition can return “1,001” or “1.5”. Splitting those at punctuation silently changed them to one or five, so a voice edit could apply a different count than the one spoken.

**Implications:** Grouped thousands are interpreted as one number and rejected by the range limit. A comma after a valid count remains sentence punctuation. Recognizer alternatives cannot override an invalid-count refusal. No schema or deployment change.
