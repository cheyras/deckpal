---
date: "2026-09-26"
title: "Serialize labeler repair and discard per photo"
decided_by: "Chey (via Codex gpt-6-sol)"
areas: ["catalog"]
supersedes: []
---
## 2026-09-26 — Serialize labeler repair and discard per photo

**Decided by:** Chey (via Codex gpt-6-sol)
**Decision:** HEIC repair and queue discard take the same database transaction lock for an original photo. A retry completes a missing or unreadable replacement sidecar before reporting success. Repair cleanup removes only the old HEIC after verifying the JPEG and sidecar; user discard removes both copies.
**Why:** Two devices can otherwise race: one may delete the photo while the other writes a replacement after the deletion. An interrupted upload can also leave a JPEG without the metadata needed to list it accurately.
**Implications:** The lock works across serverless instances. Cloud uses one dedicated worker connection so a browser disconnect cannot release its lock while storage writes continue; self-host uses the request pool without a second checkout. Repair may wait briefly for a concurrent discard; after discard succeeds, retry cannot recreate the photo. Viewing a thumbnail cannot delete its replacement. A missing harvest thumbnail now explains that the photo is unavailable. A small pinned `heic2any` patch removes each completed conversion's worker listener so batches do not retain their input buffers.
