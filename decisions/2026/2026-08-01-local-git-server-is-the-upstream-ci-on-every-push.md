---
date: "2026-08-01"
title: "Local git server is the upstream + CI on every push"
decided_by: "user."
areas: ["operations"]
supersedes: []
---
## 2026-08-01 — Local git server is the upstream + CI on every push
**Decided by:** user.
**Decision:** `origin` = the local git server. CI runs on every push to main via the
server's built-in Actions on the existing host-mode runner (capacity 1): typecheck all
workspaces -> pure deck/parser tests -> api/mcp/web builds. **Live-DB collection/
versioning tests are deliberately excluded from CI** — they hit the production
Postgres; run them manually. No deploy step: the live app IS the working tree pushes
originate from.
**Gotcha fixed on the way:** the CI runner service PATH pointed at a since-upgraded nvm
dir (`v20.18.0`, only `v20.20.2` exists) — invisible to the host API's absolute-path
deploy script, fatal for anything needing node/pnpm. Fixed with a stable
`~/.node-current` symlink + systemd drop-in; **on node upgrades, re-point the symlink**
(`ln -sfn ~/.nvm/versions/node/<new> ~/.node-current`). Workflow avoids JS actions
(manual git fetch checkout) so CI has no external action-toolchain dependency.

**2026-08-01 addendum — the runs were not missing because of the git server.** The
debugging detour (debug loggers, repo diffing, a throwaway probe repo) ended at a
mundane truth: five
consecutive `rtk git push` invocations reported `ok` while actually failing with
`fatal: no upstream branch` — the workflow files never left the machine. rtk's push filter
plus `| tail` piping masked both the message and the exit code. Fixed with `git push -u`;
after that, run creation was instant and CI went green on run 3 (49/49 tests; the one real
CI catch was `@deckpal/db` needing a build step in a fresh workspace — dist/ doesn't exist
there). **Rule: after any push that matters, verify it landed (`git ls-remote origin main`
vs local HEAD); prefer plain `git push` over rtk for pushes.** Banked as a global memory too.

