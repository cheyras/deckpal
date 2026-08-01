/**
 * battle_events write path (battle-intel A1). DB glue around the PURE parser in
 * battleevents.ts — all perspective/shape mapping between the parser's neutral
 * stream and migration 020's table happens here, nowhere else.
 *
 * ⚠ GATED until W0 (feat/battle-contracts, migration 020) merges to main and
 * migrates: every write goes through a `to_regclass('battle_events')` probe and
 * is a silent no-op while the table does not exist. No savepoints needed — the
 * probe never errors, so it is safe inside the ingest transaction. Once 020 is
 * live this path lights up on the next ingest with no code change; run
 * `pnpm --filter pokedex-api backfill:events -- --write` once for old rows.
 *
 * Mapping to the 020 DDL (verbatim from feat/battle-contracts):
 *   • actor: CHECK IN ('me','opp','system') — perspective-anchored. The parser
 *     emits screen names (it cannot know deck ownership); this module maps
 *     owner→'me', other→'opp', null→'system'. Payloads keep display names
 *     (blessed by the 020 column comment).
 *   • turn: SMALLINT CHECK (turn >= 1), NULL = setup. Parser turn 0 → NULL.
 *   • type: regex-checked (^[a-z][a-z0-9_]{1,63}$) — the census taxonomy
 *     (research/BATTLE-EVENTS.md) needs no migration to extend.
 * A log whose owner cannot be identified is SKIPPED (never mis-anchored) —
 * callers get 'skipped_no_owner' and the backfill reports it.
 */
import type pg from 'pg';
import type { BattleEvent } from './battleevents.js';
import { parseBattleEvents } from './battleevents.js';

export interface BattleEventRow {
  seq: number;
  turn: number | null;
  actor: 'me' | 'opp' | 'system';
  type: string;
  payload: Record<string, unknown>;
}

/** Perspective-anchor the parser's neutral stream: meName is the identified owner. */
export function toEventRows(events: BattleEvent[], meName: string): BattleEventRow[] {
  return events.map((e) => ({
    seq: e.seq,
    turn: e.turn === 0 ? null : e.turn,
    actor: e.actor === null ? 'system' : e.actor === meName ? 'me' : 'opp',
    type: e.type,
    payload: e.payload as Record<string, unknown>,
  }));
}

/** True once migration 020 (W0) has landed. Never errors — tx-safe. */
export async function battleEventsTableExists(client: pg.PoolClient): Promise<boolean> {
  const r = await client.query<{ t: string | null }>(`SELECT to_regclass('battle_events') AS t`);
  return r.rows[0]?.t != null;
}

/** Idempotent replace of a log's event stream (single batched INSERT). */
export async function replaceBattleEvents(client: pg.PoolClient, logId: number, rows: BattleEventRow[]): Promise<void> {
  await client.query(`DELETE FROM battle_events WHERE log_id = $1`, [logId]);
  if (!rows.length) return;
  await client.query(
    `INSERT INTO battle_events (log_id, seq, turn, actor, type, payload)
     SELECT $1, u.seq, u.turn, u.actor, u.type, u.payload
       FROM unnest($2::int[], $3::smallint[], $4::text[], $5::text[], $6::jsonb[])
            AS u(seq, turn, actor, type, payload)`,
    [
      logId,
      rows.map((r) => r.seq),
      rows.map((r) => r.turn),
      rows.map((r) => r.actor),
      rows.map((r) => r.type),
      rows.map((r) => JSON.stringify(r.payload)),
    ],
  );
}

export type EventWriteOutcome = 'written' | 'skipped_no_table' | 'skipped_no_owner' | 'empty';

/**
 * Parse rawLog and persist its event stream for logId, inside the caller's
 * transaction. meName = the identified deck owner's screen name (from
 * parseBattleLog / playerName), or null when ownership is ambiguous.
 */
export async function tryWriteBattleEvents(
  client: pg.PoolClient,
  logId: number,
  rawLog: string,
  meName: string | null,
): Promise<EventWriteOutcome> {
  if (!(await battleEventsTableExists(client))) return 'skipped_no_table'; // pre-W0 gate
  if (meName === null) return 'skipped_no_owner';
  const { events } = parseBattleEvents(rawLog);
  await replaceBattleEvents(client, logId, toEventRows(events, meName));
  return events.length ? 'written' : 'empty';
}
