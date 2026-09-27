---
date: "2026-09-26"
title: "Let the labeler repair HEIC photos in place"
decided_by: "Chey (via Codex gpt-6-sol)"
areas: ["general"]
supersedes: []
---
## 2026-09-26 — Let the labeler repair HEIC photos in place

**Decided by:** Chey (via Codex gpt-6-sol)
**Decision:** The quad labeler lazily decodes HEIC in browsers that cannot read it, converts every upload to upright JPEG, and repairs older server HEIC objects by posting a JPEG before deleting the original. A missing server photo leaves the grid with an explanation; temporary object-store failures are not reported as missing photos.
**Why:** Chrome stranded local HEIC photos in the outbox, while older clients could store HEIC bytes under `.jpg`. The server also translated every failed object fetch into “no such queued photo,” even for a temporary storage error. Local rows already use an IndexedDB lookup, so the reported 404 is not caused by treating a local ID as a server ID.
**Implications:** The decoder is confined to the labeler, loaded only on HEIC fallback, and excluded from the service worker's eager precache. `heic2any` 0.0.4's wrapper is MIT; its bundled libheif and HEVC decoder carry LGPL-3.0 terms (see `apps/web/public/HEIC-DECODER-NOTICE.md`). Repairs use an original-ID-derived replacement path so two devices cannot create separate copies; failed original deletion is retained for retry. A real HEIC fixture is covered by unit and Chromium checks at desktop and phone widths.

