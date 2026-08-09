# Orchestration — how to run parallel work

**You are (probably) the orchestrating Fable agent.** This doc covers the
operational shape: branches, worktrees, review, and the merge protocol.

## The shape of the work

- One feature = one branch = one worktree = one subagent = one reviewable merge.
- **You never merge to main.** Chey reviews and merges each feature himself.
  Your job ends at "ready for review": branch rebased on main, CI-green,
  done-gate checklist from the plan verified, DECISIONS.md entry drafted on
  the branch.
- Subagents work **only inside their assigned worktree** and follow
  `roadmap/plans/<branch>.md`. Plans state scope and gates; architecture
  internals are the subagent's judgment within the spec's contracts. House
  rules (`CLAUDE.md`, `AGENTS.md`) apply in every worktree.
- Wave boundaries are checkpoints: write a short retro (what
  shipped, what the next wave really costs) and **get Chey's explicit go**
  before fanning out the next wave.

## Branches, worktrees, status

Worktrees live outside the main tree to avoid interfering with the deployed
code.

| Wave | Branch | Plan | Status |
|---|---|---|---|
| 0 | `feat/battle-contracts` | plans/battle-contracts.md | scaffold |
| 1 | `feat/battle-events-parser` | plans/battle-events-parser.md | scaffold |
| 1 | `feat/battle-synthesis` | plans/battle-synthesis.md | scaffold |
| 1 | `feat/engine-fork` | plans/engine-fork.md | scaffold |
| 1 | `foil/main` (long-lived) | plans/foil-main.md | scaffold |
| 2 | `feat/battle-search-tools` | plans/battle-search-tools.md | pending |
| 2 | `feat/board-replay` | plans/board-replay.md | pending |
| 2 | `feat/engine-modern-rules` | plans/engine-modern-rules.md | pending |
| 3+ | See remaining plan files | | pending |

Create a worktree when its gate merges:

```bash
git -C ~/pokedex branch <branch> main
git -C ~/pokedex worktree add <path>/<slug> <branch>
cd <path>/<slug> && pnpm install
```

## Review via Vercel preview deploys

Every pushed branch gets a Vercel preview deployment automatically. Use the
preview URL for review instead of a local dev server.

## Serialization points

1. **Migrations.** Sequentially numbered (`packages/db/src/migrations/`). A
   branch that needs a migration claims the next free number **at merge time**
   and renumbers on rebase. Track who holds an unmerged migration -- never two
   blind in flight.
2. **Root files.** `pnpm-workspace.yaml` + lockfile churn is scheduled, not
   suffered: land foundational branches early, rebase everyone after.

## Ready-for-review checklist (per feature)

- [ ] Rebased on current main; migration number still the next free one
      (renumber if not).
- [ ] Done-gate items from `roadmap/plans/<branch>.md` each verified, not
      assumed.
- [ ] Pure tests pass locally (`pnpm --filter <pkg> test`) and CI is green on
      the pushed branch.
- [ ] UI features: verified in a real browser at 390px **and** desktop;
      screenshots taken.
- [ ] DECISIONS.md entry drafted (dated, on the branch).
- [ ] `research/SCHEMA.md` updated if schema moved; SKILL.md shipped if the
      plan requires one.
- [ ] Tell Chey: branch name, one-paragraph summary, Vercel preview URL if
      visual.

## Reference

- Spec: `../BATTLE-INTEL-SPEC.md` (contracts + ground truths).
- Repo conventions: `../CLAUDE.md`, `../AGENTS.md`, `../DECISIONS.md`,
  `../apps/mcp/SPEC.md`.
