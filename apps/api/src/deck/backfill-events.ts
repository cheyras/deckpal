/**
 * Backfill battle_events for existing battle_log rows (battle-intel A1).
 *
 *   pnpm --filter pokedex-api backfill:events              # dry-run (default)
 *   pnpm --filter pokedex-api backfill:events -- --write   # persist
 *
 * ⚠ GATED on migration 020 (W0 · feat/battle-contracts): --write refuses to run
 * until the battle_events table exists. Dry-run works regardless — it parses
 * every stored log and reports what would be written (per-log event counts,
 * unknown-line rates, owner identification), which doubles as the live census.
 *
 * House rules: ONE connection (pool max 1 — the cluster budget is shared),
 * open briefly, closed in finally. Idempotent: each log's stream is replaced
 * wholesale in its own transaction (DELETE + batched INSERT).
 */
import { loadEnv, makePool } from '@deckscout/db';
import { parseBattleLog } from './battlelog.js';
import { parseBattleEvents } from './battleevents.js';
import { battleEventsTableExists, replaceBattleEvents, toEventRows } from './battleevents-db.js';

const WRITE = process.argv.includes('--write');

async function main(): Promise<void> {
  loadEnv();
  const pool = makePool(1); // one connection, per house rules
  const client = await pool.connect();
  try {
    const hasTable = await battleEventsTableExists(client);
    if (WRITE && !hasTable) {
      console.error('battle_events does not exist — migration 020 (W0 · feat/battle-contracts) has not merged/migrated yet.');
      console.error('Re-run after rebasing onto merged W0 and migrating. Dry-run (no --write) works now.');
      process.exitCode = 1;
      return;
    }
    console.log(`${WRITE ? 'WRITE' : 'dry-run'} · battle_events table ${hasTable ? 'present' : 'ABSENT (pre-W0)'}\n`);

    const logs = await client.query<{ id: string; deck_id: string | null; raw_log: string | null }>(
      `SELECT id, deck_id, raw_log FROM battle_log ORDER BY id`,
    );

    let written = 0;
    let skipped = 0;
    for (const log of logs.rows) {
      const id = Number(log.id);
      if (log.raw_log === null) {
        // Post-020, simulated/agent rows are events-only — theirs come from the
        // engine (C2/D1), not this parser.
        console.log(`#${id}: no raw_log (engine-origin row) — skipped`);
        skipped += 1;
        continue;
      }
      // Identify "me" the same way ingest does: overlap with the deck's card names.
      const names = log.deck_id
        ? (
            await client.query<{ name: string }>(
              `SELECT c.name FROM deck_card dc JOIN card c ON c.id = dc.card_id WHERE dc.deck_id = $1`,
              [log.deck_id],
            )
          ).rows.map((r) => r.name)
        : [];
      const me = parseBattleLog(log.raw_log, names).players.me;
      const parsed = parseBattleEvents(log.raw_log);
      const u = parsed.unknown;
      const label = `${parsed.events.length} events · ${parsed.turns} turns · unknown ${u.count}/${u.considered} (${(u.rate * 100).toFixed(1)}%)`;

      if (me === null) {
        // Freetext-only rows (rate 1) legitimately have zero events; a real log
        // with an unidentifiable owner must not be mis-anchored to me/opp.
        console.log(`#${id}: ${label} — owner unidentified, ${parsed.events.length ? 'SKIPPED (would mis-anchor)' : 'nothing to write'}`);
        skipped += 1;
        continue;
      }
      if (WRITE) {
        await client.query('BEGIN');
        try {
          await replaceBattleEvents(client, id, toEventRows(parsed.events, me));
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      }
      console.log(`#${id}: ${label} · me=${me} — ${WRITE ? 'written' : 'would write'}`);
      written += 1;
    }
    console.log(`\n${logs.rows.length} log(s): ${written} ${WRITE ? 'written' : 'writable'}, ${skipped} skipped.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
