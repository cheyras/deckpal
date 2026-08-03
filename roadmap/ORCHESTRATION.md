# Orchestration — how to run the battle-intel / foil fan-out

**You are (probably) the orchestrating Fable agent.** Read `BATTLE-INTEL-SPEC.md` first — it holds
the feature decomposition, contracts, locked UX decisions, and ground truths. This doc is the
*operational* half: branches, worktrees, ports, the dev hub, and the merge protocol.

## The shape of the work

- One feature = one branch = one worktree = one subagent = one reviewable merge.
- **You never merge to main.** Chey reviews and merges each feature himself. Your job ends at
  "ready for review": branch rebased on main, CI-green, done-gate checklist from the plan
  verified, DECISIONS.md entry drafted on the branch.
- Subagents work **only inside their assigned worktree** and follow `roadmap/plans/<branch>.md`.
  Plans state scope and gates; architecture internals are the subagent's judgment within the
  spec's contracts. House rules (`CLAUDE.md`) apply in every worktree — rtk prefixes, connection
  budget, no shared-infra changes.
- Wave boundaries are checkpoints: write a short retro to a co-hosted app (what shipped, what the next
  wave really costs) and **get Chey's explicit go** before fanning out the next wave.

## Branches, worktrees, status

Worktrees live in `~/pokedex-worktrees/<slug>` (outside the deployed main tree — pm2 serves from
`~/pokedex`, so worktrees can never touch prod).

| Wave | Branch | Worktree slug | Plan | Created |
|---|---|---|---|---|
| 0 | `feat/battle-contracts` | `battle-contracts` | plans/battle-contracts.md | yes (scaffold) |
| 1 | `feat/battle-events-parser` | `battle-events-parser` | plans/battle-events-parser.md | yes (scaffold) |
| 1 | `feat/battle-synthesis` | `battle-synthesis` | plans/battle-synthesis.md | yes (scaffold) |
| 1 | `feat/engine-fork` | `engine-fork` | plans/engine-fork.md | yes (scaffold) |
| 1 | `foil/main` (long-lived) | `foil` | plans/foil-main.md | yes (scaffold) |
| 2 | `feat/battle-search-tools` | `battle-search-tools` | plans/battle-search-tools.md | when A2 merges |
| 2 | `feat/board-replay` | `board-replay` | plans/board-replay.md | when A1 merges |
| 2 | `feat/engine-modern-rules` | `engine-modern-rules` | plans/engine-modern-rules.md | when B1 merges |
| 3 | `feat/card-dsl` | `card-dsl` | plans/card-dsl.md | when B2 merges |
| 3 | `feat/replay-validation` | `replay-validation` | plans/replay-validation.md | when A1+B3 merge |
| 3 | `feat/gauntlet` | `gauntlet` | plans/gauntlet.md | when W0 merges |
| 4 | `feat/sim-runner` | `sim-runner` | plans/sim-runner.md | when B3/B4+C1 merge |
| 4 | `feat/match-server` | `match-server` | plans/match-server.md | when B3 merges |
| 4 | `feat/board-live` | `board-live` | plans/board-live.md | when D1+D2 merge |
| 4 | `feat/coach` | `coach` | plans/coach.md | when A3+D1 merge |

Create a worktree when its gate merges:

```bash
rtk git -C ~/pokedex branch <branch> main
rtk git -C ~/pokedex worktree add ~/pokedex-worktrees/<slug> <branch>
cd ~/pokedex-worktrees/<slug> && rtk pnpm install
```

Wave 0/1 branches were scaffolded from pre-W0 main; their plans say what to do before vs.
after rebasing onto W0's merge. After any root-touching merge (W0's migration, B1's
`packages/engine`), rebase all live branches promptly — especially long-lived `foil/main`.

Foil sub-branches (`foil/patterns`, `foil-masks`, …) branch off `foil/main` and merge back into
it; only `foil/main` ever merges to main, on Chey's call, much later.

## Serialization points (the two rules that prevent worktree carnage)

1. **Migrations.** Sequentially numbered (`packages/db/src/migrations/`, 019 is current;
   020 belongs to W0). A branch that needs a migration claims the next free number **at merge
   time** and renumbers on rebase. You (orchestrator) track who holds an unmerged migration —
   never two blind in flight.
2. **Root files.** `pnpm-workspace.yaml` + lockfile churn is scheduled, not suffered: land B1
   early, rebase everyone after.

## Dev hub — one LAN URL for every surface (phone-first review)

`tools/dev-hub-legacy/` is a zero-dependency hub on **http://localhost:3999** (LAN-only: ufw admits LAN
to all ports, the router only forwards 80/443). Runs under pm2 as `legacy-dev-hub-legacy`.

- **`GET /`** — mobile menu page listing every registered surface (bookmark this on the phone).
- **`GET /switcher.js`** — the floating ◐ button. Injected automatically into every Vite **dev**
  server by the `dev-hub-legacySwitcher` plugin in `apps/web/vite.config.ts` (dev-only; prod builds are
  untouched). Tap → overlay menu of all surfaces → jump between pages *and* branches.
- **`POST /register`** — how a surface joins the menu. Registry persists at
  `~/.legacy-dev-hub-legacy/surfaces.json` (outside the repo; survives restarts).

A subagent whose branch has a UI surface starts its dev server LAN-visible on its **assigned
port** and registers:

```bash
# in the worktree
rtk pnpm --filter pokedex-web exec vite --host --port <PORT>
curl -s -X POST http://127.0.0.1:3999/register -H 'content-type: application/json' -d '{
  "branch": "foil/main", "label": "Foil workbench", "port": 5182,
  "pages": [{ "name": "Workbench", "path": "/pokedex/foil-lab" }]
}'
```

Unregister with `POST /unregister {"branch": "..."}` when a worktree is retired.

### Port assignments (fixed — do not improvise)

| Port | Owner |
|---|---|
| 3999 | dev hub |
| 5199 | main-tree vite dev (existing default) |
| 5181 | `feat/board-replay` web dev |
| 5182 | `foil/main` web dev |
| 5183 | `feat/board-live` web dev |
| 5184 | `foil/canon-lab` web dev (workbench split: canon pattern lab) |
| 5185 | `foil/assignments` web dev (per-card pattern assignment review) |
| 5186 | `foil/mask-refine` web dev (window-mask handles + flatten-to-hand-mask) |
| 5187–5189 | spares — allocate here and record in this table |
| 3710–3719 | per-branch api dev instances (set `POKEDEX_API_PORT`, point vite at it with `POKEDEX_DEV_API_PORT`) |

`apps/web/vite.config.ts` reads `POKEDEX_DEV_API_PORT` (default 3700) for its dev proxy, so a
branch that changes the API runs its own api instance instead of polluting prod's.

The hub lists dev surfaces only — no prod entry (removed 2026-08-01; it broke for raw-IP visitors and the hub's job is in-flight work). Reach the live app directly at `http://localhost/pokedex/` when needed.

## Ready-for-review checklist (per feature)

- [ ] Rebased on current main; migration number still the next free one (renumber if not).
- [ ] Done-gate items from `roadmap/plans/<branch>.md` each verified, not assumed.
- [ ] Pure tests pass locally (`pnpm --filter <pkg> test`) and CI is green on the pushed branch.
- [ ] UI features: verified in a real browser at 390px **and** desktop; screenshots taken;
      surface registered in the dev hub so Chey can look from his phone.
- [ ] DECISIONS.md entry drafted (dated, on the branch).
- [ ] `research/SCHEMA.md` updated if schema moved; SKILL.md shipped if the plan requires one.
- [ ] Tell Chey: branch name, one-paragraph summary, dev-hub surface link if visual.

## Reference

- Spec: `../BATTLE-INTEL-SPEC.md` (contracts + ground truths — reread §5 before every merge prep).
- Repo conventions: `../CLAUDE.md`, `../DECISIONS.md`, `../apps/mcp/SPEC.md`.
- Wave DAG: spec §4. Checkpoint rule: spec §4, non-negotiable.
