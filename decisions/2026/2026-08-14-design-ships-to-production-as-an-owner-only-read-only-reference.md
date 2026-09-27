---
date: "2026-08-14"
title: "/design ships to production as an owner-only read-only reference"
decided_by: "Chey (voice directive), implemented by Claude Fable 5"
areas: ["frontend"]
supersedes: []
---
## 2026-08-14 — /design ships to production as an owner-only read-only reference
**Decided by:** Chey (voice directive), implemented by Claude Fable 5
**Decision:** The design-system surface at `/design` is no longer dev-only. It
ships in the production bundle, gated to exactly one account: `GET /me` returns
`designEditor: true` only for the account named by the server-side
`DESIGN_EDITOR_USER_ID` env var (cloud) or always in self-host (one user, behind
the owner's auth proxy). The route's `beforeLoad` throws `notFound()` for
everyone else, so an unauthorized visit is indistinguishable from a URL that
does not exist. Unset env var = nobody sees it.
**Why:** The owner wants the token/catalog reference available signed-in on
production, not only on a dev checkout. Gating server-side keeps the owner's
identity out of the public JS bundle (a `VITE_*` var would be baked into it).
**Implications:**
- Editing capability is unchanged and structurally dev-only: the `/__design`
  write endpoints still live exclusively in the Vite dev-server plugin. In
  production the page detects their absence (health probe fails) and renders
  read-only — token values parsed client-side from the bundled `theme.css`
  source (same parser as the plugin, extracted to `routes/design/themeTokens.ts`),
  saves and "Send to agent" composers hidden, live ephemeral overrides still work.
- The design chunk (~92 KB lazy chunk) is now in the prod bundle and SW
  precache. The route component itself is public bytes; nothing sensitive is in
  it, and the gate protects the *rendered surface*, not the code.
- The plan's "prod-exclusion proof" (DESIGN-SYSTEM-PLAN.md §6.4) is superseded
  for the route itself; it still holds for the `/__design` endpoints.
- `DESIGN_EDITOR_USER_ID` documented in DEPLOYMENT.md's env table.

