---
date: "2026-09-22"
title: "Mixed browser-and-approval legs replay browser results before consent"
decided_by: "DeckPal Todoist implementation worker on behalf of @cheyras"
areas: ["general"]
supersedes: []
---
## 2026-09-22 — Mixed browser-and-approval legs replay browser results before consent

**Decided by:** DeckPal Todoist implementation worker on behalf of @cheyras

**Decision:** A streamed Deck-E leg that contains both browser-executed tools and approval-held writes now runs each pending browser tool exactly once and replays its real output before the approval response. Approval responses remain the final parts of the final assistant replay message, immediately followed by the next request, because AI SDK `collectToolApprovals` silently skips held writes when anything is appended after that message. Approval-only and browser-only legs retain their existing wire shapes.

**Safety:** Navigation does not imply consent: each held call keeps its own signed allow/deny verdict, and a denied write remains denied even when browser work on the same leg succeeds. An abort returns no replay message, stops later pending browser calls, and cannot carry an approval into a subsequent request. Leg-budget, approval-preview, UI-chip, decline, and read-versus-write consent behavior are otherwise unchanged.

**Verification:** The production hook uses `approvalReplay.ts` for leg ordering, with entry and post-await abort guards. The focused approval replay suite and the real AI SDK regression coverage exercise mixed allow/deny ordering, exactly-once execution, signatures, pre-abort, and mid-browser abort. The requested `test:decke` and web typecheck commands were executed, along with the independent SDK regression script; this record does not claim a full browser aggregate pass.

