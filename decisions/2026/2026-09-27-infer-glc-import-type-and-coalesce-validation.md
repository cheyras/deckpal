---
date: "2026-09-27"
title: "Infer GLC import type and coalesce validation"
decided_by: "Chey (via Codex)"
areas: ["deck-import", "frontend", "api"]
supersedes: []
---
## 2026-09-27 — Infer GLC import type and coalesce validation
**Decided by:** Chey (via Codex)

**Decision:** Infer the GLC deck type from the intersection of resolved Pokémon types only when one shared type remains. Return an explicit unknown type and pending card IDs otherwise; show affected corrections as waiting for a type. Debounce automatic import checks by 300 ms, abort superseded requests, and guard both successes and errors by request sequence and source revision. Keep the derived-state review and its final immediate check.

**Why:** An implicit Grass default rejected valid Water corrections. Checking every keystroke also sent ten full-deck requests for ten rapid edits, with up to nine concurrent requests in the independent evaluation.

**Implications:** Import remains disabled and says “Checking…” throughout the idle wait and request. Unknown GLC type is not a legality verdict; independent violations still appear, and writing a GLC deck requires an inferred or explicit type. Tests cover Water, Grass, ambiguity, missing metadata, cancellation, late responses, and the existing 20,000 randomized review actions. CI scheduling now budgets 720 seconds for cloud-writes: the prior head measured 537 seconds against an obsolete 85-second estimate, and the expanded shared shard exceeded its existing 15-minute timeout. The corrected estimate separates that suite without raising timeouts. No migration or infrastructure setting changes. The supervisor publishes the board and syncs Architecture, Decision Log, and Contribution Record under the handoff protocol.
