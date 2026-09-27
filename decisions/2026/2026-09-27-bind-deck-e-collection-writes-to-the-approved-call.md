---
date: "2026-09-27"
title: "Bind Deck-E collection writes to the approved call"
decided_by: "Chey (via Codex)"
areas: ["agent-tools", "decke", "security"]
supersedes: []
---
## 2026-09-27 — Bind Deck-E collection writes to the approved call
**Decided by:** Chey (via Codex)

**Decision:** Deck-E assigns an approved `log_cards` call a stable idempotency key derived from its conversation, SDK tool-call ID and signed exposed input. A caller-supplied key remains authoritative. The shared MCP tool retains its content-and-time-bucket default.
**Why:** A real SDK test failed when an approval and its replay straddled a 15-minute bucket boundary. The derived key changed, so the replay reached the collection endpoint as a second write. A held approval identifies one call regardless of when the browser sends it back.
**Implications:** Replaying that approved call returns the original batch without changing quantities. A separate tool call still receives a different key and can record another acquisition. The signed input is unchanged; the key is added only inside the server adapter after approval.
