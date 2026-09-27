---
date: "2026-08-11"
title: "Design-system editor: change-application model approved (Phase 0 gate)"
decided_by: "product owner (user), in conversation with the orchestrating session."
areas: ["agents","frontend"]
supersedes: []
---
## 2026-08-11 — Design-system editor: change-application model approved (Phase 0 gate)
**Decided by:** product owner (user), in conversation with the orchestrating session.
**Decision:** The following change-application capabilities are approved for the
design-system editor initiative described in `DESIGN-SYSTEM-PLAN.md`:

1. **Write capability as a category (B9 approval):** A Vite dev-server plugin
   (`apps/web/vite-plugins/design-editor.ts`) may expose endpoints that write to
   `apps/web/src/theme.css`, and (in a later phase) an agent may edit files under
   `apps/web/src/**`. Both are scoped to the local worktree, never committing.
   The endpoints exist only while `vite dev` runs — they are absent from
   production builds by construction, not by configuration.

2. **Lane A for deterministic token value swaps (plan §1.2):** Pure token-value
   changes (e.g. swapping `#ffd54a` for `#f5c832` in a `--color-*` declaration)
   are applied deterministically by the dev-server plugin via
   `POST /__design/tokens/apply`, without routing through an agent. This deviates
   from the literal "everything through an agent" framing but was explicitly
   approved as strictly better UX for mechanically unambiguous substitutions. The
   plugin's `tokenLane: 'direct' | 'agent'` option remains available to revert
   this if the owner later wants agent mediation for tokens too.

**Explicitly NOT approved — out of scope for this and future phases unless
separately requested:**

3. **Phase 3b (unsupervised SDK daemon):** The `scripts/design-agent/agent.mjs`
   daemon that uses `@anthropic-ai/claude-agent-sdk` to drain the change-request
   queue without a human-supervised Claude Code session. This requires separate,
   later approval and must not be built or scaffolded without it.

**Why:** B9 ("no unilateral infrastructure mutations") requires explicit
maintainer approval for any agent or endpoint that writes to source files. This
entry records that approval was granted for items 1 and 2 above, and withheld for
item 3, before any implementation work begins — per the plan's Phase 0 gate (§5).

**Implications:**
- Phase 1 implementation may proceed: the dev-server plugin, the `/design` route,
  the token panel with live overrides and save, and the read-only component catalog.
- Phase 3a (supervised skill-based queue consumer) is covered by approval #1.
- Phase 3b (unsupervised daemon) remains blocked until a separate approval is granted.
- No new npm dependencies are added in phases 1-3a.

_Filed by agent on behalf of @cheyras — 2026-08-11._

