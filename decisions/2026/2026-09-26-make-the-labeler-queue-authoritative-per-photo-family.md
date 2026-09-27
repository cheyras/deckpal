---
date: "2026-09-26"
title: "Make the labeler queue authoritative per photo family"
decided_by: "Chey (via Codex gpt-6-astra)"
areas: ["security"]
supersedes: []
---
## 2026-09-26 — Make the labeler queue authoritative per photo family

**Decided by:** Chey (via Codex gpt-6-astra)
**Decision:** Listing, reads, repair, cleanup, and discard resolve an original photo and its deterministic JPEG replacement as one logical queue item under the same server lock. Clients no longer hide photos using device-local cleanup markers. The decoder now uses the upstream `heic-to/csp` build without runtime code evaluation, replacing the patched `heic2any` dependency. The self-host security policy explicitly permits its blob worker.
**Why:** Interrupted storage operations can leave a photo without its sidecar, either copy without the other, or a sidecar without a photo. A saved client hint cannot establish which bytes still exist, especially after another device discards or repairs them.
**Implications:** A surviving photo remains visible exactly once; a sidecar alone is not a photo. Repair acknowledges only a complete JPEG/metadata pair. Cleanup cannot remove the last photo. Discard is retryable after interruption and cannot be followed by a repair that resurrects a successfully discarded item. Queue work is bounded before database checkout, within the worker connection cap; each browser refresh reads the shared queue once and retains its last server snapshot on listing errors. Concurrent thumbnail repairs trigger one refresh when the batch settles, and an unavailable shared queue does not prevent clearing local photos. Table-driven state/failure/interleaving tests and real HEIC browser checks cover these contracts; the full state table lives beside the queue implementation.
