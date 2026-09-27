---
date: "2026-08-11"
title: "Phase 3a: Agent lane with supervised consumer"
decided_by: "agent (implementing approved plan §5, Phase 3a)"
areas: ["agents"]
supersedes: []
---
## 2026-08-11 — Phase 3a: Agent lane with supervised consumer
**Decided by:** agent (implementing approved plan §5, Phase 3a)
**Decision:** Implemented the agent-mediated change-request lane (Lane B) with
three components: (1) `RequestsPanel.tsx` — polls `GET /__design/requests`
every 3s, displays each request with kind/target/intent/status, and for
completed requests shows the agent's summary, files changed, and a
hot-reload hint; (2) "Send to agent" composers on every gallery entry in
`CatalogSection.tsx` — free-text intent box with pre-filled context
(component name, source path, current knob state, active token overrides),
submitting to `POST /__design/requests`; (3) `.claude/skills/design-requests/SKILL.md`
— the playbook for a Claude Code session to drain `design-requests/queue/`,
applying changes with real judgment and writing structured results to
`done/` or `failed/`.

**Why:** This completes the full composer-queue-agent loop. The queue directory
is the contract between the UI and the consumer: the UI writes requests, the
skill drains them, and HMR closes the visual loop. The skill is a supervised
consumer (the owner has a Claude Code session open in the worktree) — it
never commits, leaving `git diff` as the review surface. The done/failed
result file includes both the original request fields and a nested `result`
object so the RequestsPanel can display the full context alongside the
agent's output.

**Implications:**
- Phase 3a is complete: the supervised agent lane is functional end to end.
- The skill asserts it is operating in the `design-system` worktree before
  touching anything (safety check per plan §8.3 risk R5).
- Done/failed result files carry the original request fields (kind, target,
  intent, createdAt, context) alongside the result sub-object — the GET
  endpoint reads whatever is in the file and the panel renders it directly.
- The `.gitignore` entry for `design-requests/` was anchored to `/design-requests/`
  (root-relative) to avoid accidentally ignoring
  `.claude/skills/design-requests/` (the skill playbook that must be tracked).
- Phase 3b (unsupervised SDK daemon) remains explicitly out of scope.
- No new npm dependencies were added.

_Filed by agent on behalf of @cheyras — 2026-08-11._

---

