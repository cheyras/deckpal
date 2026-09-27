---
date: "2026-09-26"
title: "Test coverage for every write/revert tool in packages/agent-tools"
decided_by: "Chey (via Claude)"
areas: ["agents"]
supersedes: []
---
## 2026-09-26 — Test coverage for every write/revert tool in packages/agent-tools

**Decided by:** Chey (via Claude)

**Decision:** Added handler-level CONTRACT tests for the 11 write/destructive tools in `@deckpal/agent-tools` (every tool with `readOnlyHint: false` or `destructiveHint: true`), following the package's existing stub-`Ctx` convention (no database, no network — `ctx.db`/`ctx.api` mocks, the same pattern `toolErrors.test.ts` and `deckIntel-infer.test.ts` already use). Five new files under `packages/agent-tools/src/__tests__/`, 68 tests, all passing:

- `logging.test.ts` — `log_cards`, the tool with the documented 2026-08-19 "silent-success incident" (4x quantity inflation from a retried timed-out call). Pins the happy path, that two identical calls derive the SAME idempotency key (so a real retry reads back as `REPLAYED`, never a second application), that `whatLanded` probes more than one 15-minute bucket before giving up (the boundary-crossing case the fix's own comment calls out), `dry_run` always forwarding `dryRun` to the API, the delta/quantity/ambiguity contract per item, the multi-input-row-folds-to-one-result-row case, and that the owned-quantity lookup is scoped by `ctx.userId` (two different users never see or affect each other's counts).
- `decks-mutations.test.ts` — `save_deck`, `delete_deck`.
- `history.test.ts` — `mutation_history`, `revert`.
- `lists-mutations.test.ts` — `edit_list`, `delete_list`.
- `deckIntel-mutations.test.ts` — `deck_strategy`, plus the APPLY paths (dry_run:false) of `add_battle_log`/`edit_battle_log`/`deck_history revert_to` that were previously only pinned in their dry-run form, and `delete_battle_log` in full.

Every write tool now has coverage of: the happy path, `dry_run` sending no mutating call, STRICT (exact-id-or-exact-name) resolution on approximate names, and each tool's destructive shapes (soft-delete/restore/purge) sending exactly the request they claim to.

**Why:** QUAL-04 (quality audit) found every write/revert handler in this package untested, `log_cards` most pointedly — it is the one surface where an AI agent (Claude via MCP, or Deck-E) directly mutates a real user's collection, decks, or lists, and it already has a real production incident on its record. No test caught that incident before it shipped; this closes that gap going forward.

**Implications:** No behavior changed — test-only PR, no bugs found that needed a fix. `pnpm --filter @deckpal/agent-tools test:variants` (`node --test src/__tests__/*.test.ts`) picks up all five new files automatically via the existing glob; no CI workflow edit was needed since `.github/workflows/ci.yml`'s "Variant classification + agent-tools guards" step already runs that script. Two other open PRs touch the same tools: `fix/deck-builder-data` (#216, `deck_history`/`revert`) and `fix/catalog-bugs` (#215, `resolve.ts`/`log_cards` resolution) — once either merges, the corresponding assertions in `logging.test.ts` or `deckIntel-mutations.test.ts` may need a trivial update to match the new behavior.
