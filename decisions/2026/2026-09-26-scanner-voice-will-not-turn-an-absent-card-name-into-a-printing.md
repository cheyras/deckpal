---
date: "2026-09-26"
title: "Scanner voice will not turn an absent card name into a printing"
decided_by: "Chey (via Codex gpt-6-sol)"
areas: ["scanner","catalog"]
supersedes: []
---
## 2026-09-26 — Scanner voice will not turn an absent card name into a printing
**Decided by:** Chey (via Codex gpt-6-sol)
**Decision:** Match Cosmos printing words literally, and refuse a printing-like word in a card-name position when no known card or reference anchors the request.
**Why:** “The Cosmog is a holo” could read the absent Cosmog as a fuzzy Cosmos modifier and change the latest captured card. The parser had full word coverage, so the existing unknown-name refusal did not catch it.
**Implications:** A misheard Cosmos modifier may need to be repeated. Spoken Cosmog is accepted when that card is in the scan list; when absent, it cannot change another capture. No schema or deployment change.
