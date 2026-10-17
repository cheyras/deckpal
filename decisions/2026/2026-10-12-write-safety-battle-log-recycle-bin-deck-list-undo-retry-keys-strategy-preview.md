---
date: "2026-10-12"
title: "Write safety: battle-log recycle bin, deck list undo, retry keys, strategy preview"
decided_by: "@cheyras (owner ruling 2026-10-12)"
areas: ["agents", "data"]
supersedes: []
---
## 2026-10-12 — Write safety: battle-log recycle bin, deck list undo, retry keys, strategy preview
**Decided by:** @cheyras (owner ruling 2026-10-12), choosing four of the write-safety options in `2026-10-12-mcp-tool-surface-and-write-safety.md` §4 D: "Preview strategy rewrites, Keep old deck lists, Battle-log undo + bin, No duplicates on retry". Built by Claude Opus 5.5.

**Decision:** Close the four gaps that audit measured.

1. **`deck_strategy` previews over MCP.** The MCP server advertises it with `dry_run` (default true). A first call reports the old and new heading, the length, and the lines added and removed, and saves nothing. Deck-E keeps the tool without `dry_run`: its approval card shows the whole new guide, so that card already is the preview, and a dry run there would send a 40,000-character guide twice. The two contracts come from one definition through a new optional `mcp` field on `ToolDefinition` (`packages/agent-tools/src/registry.ts`), which only the MCP adapter reads.
2. **Old deck lists are kept.** Every card-list write records the deck's full state before and after it (name, format, GLC type, every card with its printing, and which printings are pinned exactly), as a `deck.cards` event with `v: 2`; when the write also changes the guide (a `deck_history` revert with its strategy, or the undo of one), both sides carry the guide too. This covers a `save_deck` edit, an import, and a `deck_history` revert (which now always records, keyed or not). `revert` on that event puts the earlier state back as a new deck version, through the same `restoreSnapshot` path `deck_history` uses, so the list it replaces stays in history too. If the deck changed after the event, the dry run reports a conflict and the revert skips it unless `force` is given. A real revert locks every deck and log it may change before it checks for conflicts, so a save committing meanwhile is a conflict, never overwritten.
3. **Battle logs get undo and a recycle bin.**
   - A delete moves the log to a new `battle_log_bin` table (migrations 087 and 088). `?purge=true` is the one hard delete. A restore puts the log back with the same id and the same deck version. A log in the bin still counts for the versioning rule, so an edit after deleting a version's last log makes a new version; otherwise the edit would amend the list that game was played with, and a restore would attach it to a list it never saw. The bin is a separate table, not a `deleted_at` column, because fourteen queries read `battle_log` and every one would have needed the filter; the bin cannot leak into a record by omission.
   - Create, edit, delete, restore and purge are recorded in `mutation_history` whether or not the request is keyed. An edit records the fields' old and new values. The raw log is never copied into an event, so a purge still deletes the text.
   - `revert` undoes each one: a create by moving the log to the bin, a delete by restoring it, an edit by putting the old values back, with conflict checks if the log changed since.
   - The web app's battle list gets an Undo on delete and a "Recently deleted" section. MCP gets `battle_logs deleted: true`, and `delete_battle_log` gains `restore` and `purge`.
4. **A retried write lands once.** MCP writes that would double on a retry send an `Idempotency-Key` derived from the request (`packages/agent-tools/src/writeKey.ts`): `add_battle_log`, a `deck_history` revert, an `edit_list` create or bulk add, and a forced `revert`. The key is a hash of the tool, method, path and body (not `source`), within a 30-minute window. A retry just after a window boundary reuses the previous window's key when that write committed, so a repeat within 30 minutes is always absorbed, one 30–60 minutes later is when it falls in the next window, and one more than an hour later never is. A replayed call says so and names how to make a deliberate repeat distinct (`played_at` or `notes` on a battle log, a `note` on a revert).

**Why:**
- Each gap was measured, not hypothetical (the audit's write-safety table). A `save_deck` edit to a version with no battle logs overwrote that list with nothing kept. Battle-log edits and deletes over MCP were not recorded and could not be undone. A retried `add_battle_log` made a second log, and `idempotency.mjs` pinned that. `deck_strategy` was the one write with no preview.
- **Why not key every write.** A key absorbs a deliberate repeat inside its window as well as a retry. For a write that sets a state, that does harm and buys nothing:
  - Repeating such a write already changes nothing: a delete of a binned log says it is already in the bin, and an edit sets the same values again.
  - A key would turn delete → restore → delete within half an hour into a silent no-op.
  - So edits, deletes, restores, renames and removals stay unkeyed. An unforced `revert` stays unkeyed too: it marks what it undid, so a retry finds "already reverted", and "undo everything since 2pm" must stay re-runnable.
- **Why 30 minutes.** It covers a client's own retry and a model re-issuing a call after a dropped connection. A deliberate identical repeat inside it is possible: game 2 of a best-of-three with no notes is the real case. The replay message tells the model how to make the second call distinct, so the loss is one extra call, not a missing game.

**Implications:**
- **Production order:** migrations 087 (the table) and 088 (its RLS, `@supabase-only`) must be applied before this merges. The API reads and writes `battle_log_bin` on every battle-log delete.
- **Older events are skipped, not guessed at.** `deck.cards` events recorded before this change hold only `{cardsReplaced, formatChanged}`, and `battle_log.edit` events before it hold no old values. `revert` reports them as skipped ("recorded before 2026-10-12"). A purge cannot be reverted.
- **Deck-E is unchanged where it matters:**
  - `delete_battle_log` keeps `destructiveHint`, because purge is still irreversible, so it still asks before a preview.
  - Deck-E's own signed key uses the same lowercase header name, so it replaces the derived one rather than sitting beside it.
  - `deck_strategy` behaves exactly as before in Deck-E.
- **Where it is pinned:**
  - `deckIntel-mutations.test.ts` and `wire.test.ts` (agent-tools and apps/mcp) cover the bin, restore, purge, the retry key and the MCP-only strategy preview.
  - `writeSafety.mjs` in the database runner covers the API routes and `revert` end to end.
  - `idempotency.mjs`'s "no batch for an unkeyed battle-log write" assertions now expect a batch.
- **Still open from §4 D** (not chosen this round):
  - an all-or-nothing `revert` when any item conflicts;
  - drift checks for strategy and list-rule reverts;
  - one atomic `edit_list` request;
  - a preview token that makes a preview a gate rather than a default.
