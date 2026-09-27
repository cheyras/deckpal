---
date: "2026-09-26"
title: "Scanner voice target and lifecycle invariants"
decided_by: "Chey (via Codex gpt-6-astra)"
areas: ["scanner","catalog"]
supersedes: []
---
## 2026-09-26 — Scanner voice target and lifecycle invariants

**Decided by:** Chey (via Codex gpt-6-astra)

**Decision:** Separate literal structural tokens from fuzzy printing/name recognition, protect both edges and interiors of fuzzy windows, reserve exact name boundaries, snapshot target context at first speech, and refuse ambiguous targets or conflicting counts. Store unfinished speech and every failed voice action in persistent queue warnings through Verify, cleared only by explicit acknowledgement; deliberate cancellation and supersession remain supported.

**Why:** Repeated review findings came from the same two structural problems: competing fuzzy windows could swallow a card name, and queue exit paths could discard a printing request with only a temporary caption. “The N” versus “then” and an unidentified capture landing during `tick()` are regressions in a larger class, not isolated exceptions.

**Implications:** The closed grammar and opt-in beta remain. Duplicate identical names use latest capture order; ambiguous names require a full name or manual selection. Add is blocked by unresolved voice warnings; accumulated warnings scroll while acknowledgement remains reachable. Table-driven target cases and lifecycle transition tests cover the invariant boundaries; the browser proof covers the shipping hook at 1440px and 390px. Migration 073 and the physical-iPhone speech/camera check remain as previously documented. The supervisor syncs Architecture, Decision Log and Contribution Record to the wiki.

