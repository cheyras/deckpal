---
date: "2026-08-10"
title: "four hono advisories closed, and why a pnpm override looked like it did nothing"
decided_by: "Not recorded"
areas: ["general"]
supersedes: []
---
## 2026-08-10 — four hono advisories closed, and why a pnpm override looked like it did nothing

**What:** five open Dependabot alerts on `main`, all hono-family, all transitive:
`@modelcontextprotocol/node` → `@hono/node-server` → `hono`. Nothing here imports
hono directly; the MCP server is the only thing that pulls it in.

**Four are closed by `hono@4.13.1`** (alerts 7/8/9/10: `memo()` retaining SSR
output across requests, CORS ReDoS, Language-middleware algorithmic DoS, and the
proxy helper leaking `Connection`-listed response headers). `@hono/node-server`
peer-requires `hono: ^4`, so this is a patch bump inside a range the parent
already accepts, not a forced major.

**The override silently did nothing twice, in two different ways.** Worth writing
down, because both failures reported success.

1. **`pnpm.overrides` in `package.json` is ignored by pnpm 10 in a workspace.**
   It belongs in `pnpm-workspace.yaml`. `pnpm install` exits 0 and resolves the
   old version anyway — there is no warning that the key was read and discarded.
2. **Even in the right file, the override did not move the resolution**, through
   `pnpm install`, `--force`, and `pnpm update hono -r`. The lockfile showed
   `overrides: hono: ^4.12.34` and `pnpm config list` showed it parsed, while
   `pnpm why hono -r` kept answering `4.12.32`. The reason is that hono arrives as
   an **auto-installed peer** (`autoInstallPeers: true`; hono is an *optional*
   peer of `@modelcontextprotocol/node` at `^4.11.4`), and overrides do not rewrite
   a peer resolution that is already pinned in the lockfile. The tell was visible
   in the lockfile the whole time: `@hono/node-server@1.19.17` declares
   `peerDependencies: hono: ^4.12.34` — upstream had already raised the floor to
   force this fix — while the snapshot next to it still read `(hono@4.12.32)`, a
   resolution that violates its own dependent's range. That mismatch is what the
   generic "Issues with peer dependencies found" line was pointing at.

   Fix: delete the `hono` / `@hono/node-server` blocks from the lockfile and
   reinstall, so the peer has to be resolved fresh. It then picked `4.13.1`.

**The fifth alert is not actionable and not reachable.** `@hono/node-server`
< 2.0.5 has a path traversal in `serve-static` via an encoded backslash. The
patched **2.0.5 is not published** — npm tops out at 2.0.3 — and
`@modelcontextprotocol/node@2.0.0`, the current latest, pins `^1.19.9`, so there is
no version to move to in either direction. It is also Windows-only (`%5C`), and
this deploys on Linux only (Pi + Vercel). Nothing in `apps/mcp` or in
`@modelcontextprotocol/node`'s dist calls `serveStatic`. Left open deliberately
rather than dismissed: it should close by itself when upstream ships, and an open
alert with a written reason is more honest than a dismissal that hides it.

**Verification.** `pnpm why hono -r` → `4.13.1`; lockfile carries no `4.12.32`
reference. Full workspace `tsc --noEmit` exit 0. `deckpal-mcp` builds, and the
server boots for real: DB ok, deckpal-api reachable, `deckpal-mcp listening on
127.0.0.1:3704`.

**Implications.**

- An override that "did not work" is worth one `pnpm why` before it is worth a
  second attempt. Both failure modes here exit 0, and one of them is silent
  discarding of a config key — so a clean install proves nothing about whether the
  pin took. Check the resolution, not the exit code.
- Transitive peer pins survive `--force`. When upstream raises a peer floor to
  push a security fix, the lockfile can keep serving the old resolution
  indefinitely, and the only loud symptom is a generic peer-dependency warning
  that is easy to read as noise.
- `:3704` was free when the smoke test ran, which means the MCP server was not up
  at the time. Unrelated to this change and not touched here, but it should be
  running.

_Filed by agent on behalf of @cheyras — 2026-08-10._

