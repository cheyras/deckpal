---
date: "2026-10-26"
title: "Knowledge notes are reviewed in Administration and in Dev tools"
decided_by: "Chey (via Claude)"
areas: ["web", "admin"]
supersedes: []
---
## 2026-10-26 — Knowledge notes are reviewed in Administration and in Dev tools
**Decided by:** Chey (via Claude)

**Decision:** The review screen for knowledge notes (Phase 6, part two) is one component (`routes/admin/Knowledge.tsx`), mounted in two places:
- **Administration:** the "Knowledge notes" tab at `/admin/knowledge`, for admins.
- **Dev tools:** the "Knowledge notes" entry at `/dev/knowledge`, for anyone else holding `knowledge.review`.

Both routes require `knowledge.review` and nothing else. The screen does not use `useAdminQuery`, which requires `admin.access`.

On the screen, a reviewer:
- sees what is waiting, approved or rejected;
- reads each note's cards, statement, quote, full source link and automatic-check flags;
- approves (a reason is optional);
- or rejects (a reason is required).

Each decision is final and audited (#358).

**Why:**
- The owner asked for an administration surface that "users/admins of a certain reasonable tier" can reach. #358 lets a contributor role (tier 30) be given `knowledge.review`.
- `/admin` requires `admin.access`, which a contributor can never hold (the tier ceiling). A tab only under Administration would make that grant useless.
- Contributors already reach Dev tools.

**Implications:**
- The source link opens in a new tab with `noopener noreferrer nofollow` and is printed in full, so the reviewer sees where it goes first. All proposer text renders as text.
- The browser suite covers the screen at 1280 px: text stays text, flags show, a rejection without a reason is not sent, and decided notes move to their tab.
- The chunk is precached like the other Administration screens. Only dev-only routes are excluded from the precache.
