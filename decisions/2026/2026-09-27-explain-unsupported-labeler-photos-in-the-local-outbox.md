---
date: "2026-09-27"
title: "Explain unsupported labeler photos in the local outbox"
decided_by: "Chey (via Codex)"
areas: ["labeler", "uploads", "browser-security"]
supersedes: []
---
## 2026-09-27 — Explain unsupported labeler photos in the local outbox
**Decided by:** Chey (via Codex)

**Decision:** The quad labeler converts HEIC to upright JPEG in the browser and keeps the production content security policy unchanged. JPEG XL is refused at selection because neither Chromium nor the deployed Sharp build can decode it. A format, decode, or non-retryable upload failure stays in the local outbox with its own reason and a Discard action; reconnects do not retry it.

**Why:** The recovered September 9 photos predate the September 27 HEIC fix and production policy. A real 4032 × 3024 iPhone HEIC decoded upright under that policy in Chromium with no violations; the policy already permits the decoder's blob worker and WebAssembly, so loosening it would add risk without fixing an observed failure. The API accepts JPEG bytes only, while the deployed Sharp build reports JPEG XL input support as false. Previously, every conversion failure was stored as an unexplained "local" row and retried indefinitely.

**Implications:** Keep HEIC orientation and upload regression coverage under the actual production policy. A failed download of the HEIC converter remains retryable; only a photo that the loaded converter cannot decode is marked permanent. JPEG XL needs a verified decoder and a new end-to-end contract before it can be accepted. Outbox records now carry an optional permanent failure reason without changing the IndexedDB schema version; older records are classified when their next retry fails. A late retry must update only a row that still exists, so Discard cannot be undone by that retry.
