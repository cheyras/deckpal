---
date: "2026-10-10"
title: "Every approved Deck-E write happens at most once per signed tool call"
decided_by: "Chey (via Claude Opus 5.5), on a security review finding"
areas: ["agents", "decks", "security"]
supersedes: []
---
## 2026-10-10 — Every approved Deck-E write happens at most once per signed tool call
**Decided by:** Chey (via Claude Opus 5.5), on a security review finding

**Decision:** Every write the reader approves in Deck-E carries a key derived from the SDK-signed tool call. The deck, list, battle-log and revert routes perform that key's write at most once and answer a repeat with the first run's result. Covered: `add_battle_log`, `edit_battle_log`, `delete_battle_log`, `save_deck`, `edit_list`, `delete_list`, `delete_deck`, `deck_strategy`, `deck_history` revert and `revert`. `log_cards` already worked this way, through its body key. There is one mechanism, in two halves.

- **The adapter.** For a call held here, `execute` derives `approvedWriteKey` from the verified user, the tool, the SDK tool-call ID and the signed input, and nothing else. It hands the key to that execution's ctx. `keyedApi` (`decke/ctx.ts`) then puts an `Idempotency-Key` on each write request. The value is `decke-call:` + sha256 of the call key, the method, the path, and how many times this execution has already sent that method and path. Previews (`dryRun: true`) and reads get none.
- **The API.** `writeOnce` (`apps/api/src/writeOnce.ts`) opens the route's own `mutation_batch` with the key, as the first write of its transaction. The existing `UNIQUE (user_id, idempotency_key)` from migration 036 is the whole guarantee. The route's events land in that batch, which is closed with the transaction's return value. A repeat, concurrent or later, gets that value back with `"replayed": true` and writes nothing. Routes that kept no batch (battle-log create, edit and delete, deck revert) open one only when keyed. `/decks/save` and `/decks/import` let the header win over their content key, and it never moves to a new generation.
- **What the model sees.** A replayed write's tool text gains a REPLAYED line, so he does not tell the reader the change happened twice.

**Why:** A held write runs when the browser resumes the turn with the reader's signed approval. The request key (`chatChargeReference`) hashes the whole body, so it stops only a byte-identical resume. A retry after a network blip, a reload mid-turn, or the same approval with the conversation ID or a landmark changed reaches the SDK as a new request. The SDK then runs the held tool a second time. The security review found that only `log_cards` was safe. A second run of the others meant a second battle log, one more deck version from a revert, or a static list's bulk add doubling its rows (a static list is a bag). Set-type writes were worse in a quieter way: a late replay renamed a list back, re-deleted a list the reader had restored, or overwrote the strategy guide the reader wrote afterwards.

The mutation log already had everything this needed: a per-user unique key that commits with the write, and a stored response. That is what `/collection/batch` has always replayed from. So no new table, and no migration. The key is per write request rather than per call because one call can make several writes (`edit_list` renames, bulk-adds and removes), each in its own transaction. It is keyed by method and path rather than by position in the sequence: a replay whose reads differ and which skips a write must not shift the others onto the wrong stored results. A keyed request that changes nothing ("already deleted", "nothing to restore") still records its key, because "it did nothing the first time" is exactly what stops a replay undoing what the reader did since.

**Implications:**
- **No migration.** Nothing has to be applied to production before this merges. The deploy is code only, and it uses columns migration 036 shipped.
- **Without the header, nothing changes.** The MCP server, the web app and every script send no header and run the code they ran before: the same transactions, the same unkeyed batches (or none, for battle logs and deck reverts), and response bodies with no `replayed` field. The `log_cards` key is unchanged too, so an approval in flight across the deploy still replays.
- **Two approved calls are two consents.** A second, separately approved `add_battle_log` of the same game is a second log, as it was for `log_cards`. For Deck-E's `save_deck`, the per-call key replaces the content key that used to fold an identical create into the first deck. The approval card already warns when a deck by that name exists, so what the reader approves is what happens.
- **Raw logs are never copied into a batch.** A keyed battle-log create stores the log's ID, and its replay re-reads the row. If the row has been deleted since, the answer is `410 gone` and nothing is written. Delete and edit events keep the summary fields only, so deleting a log still deletes its text.
- **Not covered:**
  - `approvals: 'upstream'` writes. They have no caller today, are not held here, and carry no signed ID.
  - `save_deck`'s rolling-deploy fallback onto the legacy per-card deck routes. It is unreachable while the API serves `/decks/save`, and it is the same deployment.
  - The single-item `POST /lists/:id/items`, which no tool calls.
- Battle-log edit and delete now send `source: deckpal-mcp`, so a keyed batch is attributed correctly. The unkeyed routes ignore it, as before.
- **Proved in two places.**
  - `__integration__/idempotency.mjs`, against real PostgreSQL 16 with every migration. A held `add_battle_log` is approved through the real SDK and resumed twice, the second time with the conversation ID changed: one battle log. The same suite covers route replays for every route above, and a different key writing. It also covers concurrent duplicates, which write once, and unkeyed requests, which keep their old behaviour (static bags still duplicate; an unkeyed revert still adds a version).
  - `decke/__tests__/writeIdempotency.test.ts` pins the adapter half. It fails when the key is dropped.
