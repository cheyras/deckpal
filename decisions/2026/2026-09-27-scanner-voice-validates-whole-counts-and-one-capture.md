---
date: "2026-09-27"
title: "Scanner voice validates whole counts and one capture"
decided_by: "Chey (via Codex)"
areas: ["scanner", "voice"]
supersedes: []
---
## 2026-09-27 — Scanner voice validates whole counts and one capture
**Decided by:** Chey (via Codex)

**Decision:** Parse counts through one whole-token reader before punctuation normalization, accepting only the existing number-word forms or correctly grouped digits within 1–99. Resolve one capture for the entire utterance independently of whether it changes a count, printing or removal. Refuse multiple card subjects or an unclear second clause. Only a bare “that” or “this” immediately before a name qualifies that name; additional references are separate subjects. Preserve the explicit shared-target phrase “two of those and they’re reverse.”

**Why:** Repeated punctuation patches still converted “.5 copies” into five. Printing-specific target guards still combined “this one is two copies and that one is a holo” onto one capture and silently removed only one target from “remove this one and that one.” Both defects came from discarding structure before validating it.

**Implications:** Invalid numeric expressions use the existing count feedback; target ambiguity uses the existing request to name one card. Neither refusal can be overridden by an alternate recognizer guess. The grammar stays closed: punctuation and numeric syntax outside the allowlist are refused, including a trailing dot on a digit count. A matrix covers accepted and refused forms, a seeded property test exercises 6,000 punctuation/whitespace wrappers, and the browser proof verifies that refusals leave every capture unchanged. The supervisor publishes the refreshed board and syncs Architecture, Decision Log and Contribution Record; the independent evaluator reviews this implementation separately.
