---
date: "2026-08-22"
title: "Closing the chat ends the turn"
decided_by: "Claude."
areas: ["agents"]
supersedes: []
---
## 2026-08-22 — Closing the chat ends the turn
**Decided by:** Claude.
**Decision:** closing aborts the turn, settles any pending approval as a denial,
and records that it was stopped.

**Why:** verified — closing did neither, and the listener that would settle an
approval fires on the AbortController, which closing never triggered. The promise
parked for the life of the page: `busy` stayed true, `thinking` stayed sustained,
and the only way out was a reload.

**Implications:** letting a turn run invisibly is worse than it sounds, because a
turn can navigate — the page would move under someone who has just said they are
done, with no surface left to explain why.

