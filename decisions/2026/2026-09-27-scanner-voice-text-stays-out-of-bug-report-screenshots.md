---
date: "2026-09-27"
title: "Scanner voice text stays out of bug-report screenshots"
decided_by: "Chey (via Codex)"
areas: ["scanner", "bug-report", "privacy"]
supersedes: []
---
## 2026-09-27 — Scanner voice text stays out of bug-report screenshots
**Decided by:** Chey (via Codex)

**Decision:** Mark every scanner voice text surface for the bug reporter's existing screenshot exclusion: live and recent captions, pending chips, screen-reader announcements and Verify warnings. Keep the report description as reporter-entered text only.

**Why:** A screenshot taken while speech was visible contained the transcript and could save it with a private bug report, contradicting the voice beta's privacy promise.

**Implications:** Future voice text surfaces must carry the same marker. A browser proof submits fake reports at desktop and phone widths, verifies the actual JPEG has no caption pixels, and checks that no automatic text payload field copies the spoken phrase.
