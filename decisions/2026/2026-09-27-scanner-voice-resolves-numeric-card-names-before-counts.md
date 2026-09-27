---
date: "2026-09-27"
title: "Scanner voice resolves numeric card names before counts"
decided_by: "Chey (via Codex)"
areas: ["scanner", "voice"]
supersedes: []
---
## 2026-09-27 — Scanner voice resolves numeric card names before counts
**Decided by:** Chey (via Codex)

**Decision:** Reserve the longest scanned catalog name before interpreting a count. Recognize literal names, separated digits and spoken number aliases without removing identity-bearing numeric punctuation. Keep a shorter name-plus-count reading until interpretation; if both readings make valid commands, refuse with “Which card did you mean?” Numeric names use exact aliases rather than fuzzy matching.

**Why:** “Porygon two reverse holo” could change Porygon's printing and quantity even when the reader meant Porygon2. Joined “Porygon2” was also misclassified as an invalid count. Names such as Pokégear 3.0 and Energy Removal 2 show why a Porygon-specific exception would not fix the design.

**Implications:** A numeric name never supplies a quantity. When Porygon and Porygon2 are both scanned, the ambiguous printing command leaves both unchanged; a clear joined name or a manual tap resolves it. Removal can still name “Porygon two” because name-plus-count is not a valid removal. The existing alternative-recognition veto and full-count validation remain in force. The contract matrix covers row order, recognizer alternatives, Porygon-Z, Type: Null and Zygarde 10%. Property checks cover all 52 digit/number-word names from a provenance-recorded 23,736-card upstream snapshot and synthetic suffixes 0–150. Browser checks verify the actual pending queue and no writes after refusal. The supervisor publishes the refreshed board and syncs Architecture, Decision Log and Contribution Record; the separate evaluator performs Astra review.
