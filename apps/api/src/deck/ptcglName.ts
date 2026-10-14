/**
 * The reader's PTCG Live screen name (`user_settings.ptcgl_name`, migration 086).
 *
 * WHY. A pasted PTCG Live log names both players and says nothing about which one is the reader. The parser guesses the
 * reader's side from the deck's card overlap, and a short game shows few cards: on 2026-10-13 a five-turn game was read
 * from the opponent's side and called a loss when the reader had won. Agents had to ask "which one is you?" every time.
 *
 * THE RULE (the owner's, 2026-10-13). The reader can set the name in their profile. While it is empty, it fills itself in
 * once three logged PTCG Live games attribute the same name to the reader — and it is never changed automatically after
 * that, least of all when the reader typed it. Nothing has to call a tool for it: logging a game does it.
 */
import type { PoolClient } from 'pg';
import { logPlayerNames, samePlayerName } from './battlelog.js';

/** Games under one name before it is learned. */
export const LEARN_AFTER = 3;

export const PTCGL_NAME_MAX = 100;

interface Queryable {
  query: PoolClient['query'];
}

/**
 * The name to learn from the reader's per-name game counts (largest first), or null. It needs at least LEARN_AFTER games
 * and strictly more than any other name, so a reader who plays two accounts equally is never guessed at.
 */
export function chooseLearnedName(counts: ReadonlyArray<{ name: string; n: number }>): string | null {
  const [top, next] = counts;
  if (!top || !top.name.trim() || top.n < LEARN_AFTER) return null;
  if (next && next.n >= top.n) return null;
  return top.name;
}

/**
 * The stored name, but only for a log it actually appears in as a player, found the way the parser finds players (so
 * "cheyras’s Turn" with a curly apostrophe counts: Astra, #341). Returns the name as the log spells it. A reader logging
 * a game played on another account must not have it parsed from the side of a name that is not in it.
 */
export function storedNameFor(rawLog: string | null | undefined, stored: string | null | undefined): string | undefined {
  if (!rawLog || !stored) return undefined;
  return logPlayerNames(rawLog).find((n) => samePlayerName(n, stored));
}

let columnReady = false;
let warned = false;

/**
 * Whether migration 086 is applied. Code that ships before it (a preview, a self-host install that has not run the
 * migration) must keep logging games and serving settings, so every reader of the column checks first; true is cached
 * for the instance's life, false is re-checked on the next call.
 */
export async function ptcglNameReady(db: Queryable): Promise<boolean> {
  if (columnReady) return true;
  const { rows } = await db.query<{ ready: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'user_settings' AND column_name = 'ptcgl_name') AS ready`,
  );
  columnReady = rows[0]?.ready === true;
  if (!columnReady && !warned) {
    warned = true;
    console.warn('[deckpal-api] migration 086_ptcgl_name is not applied: the PTCG Live name is ignored until it is');
  }
  return columnReady;
}

/** The reader's stored name, or null (also when migration 086 is not applied). */
export async function ptcglNameOf(db: Queryable, userId: string): Promise<string | null> {
  if (!(await ptcglNameReady(db))) return null;
  const { rows } = await db.query<{ ptcgl_name: string | null }>(`SELECT ptcgl_name FROM user_settings WHERE user_id = $1`, [userId]);
  return rows[0]?.ptcgl_name ?? null;
}

/**
 * After a PTCG Live game is logged: when the reader has no name yet and LEARN_AFTER games attribute the same one to them,
 * store it as 'auto'. The `ptcgl_name IS NULL` guard is the never-overwrite rule, applied in the UPDATE itself so a name
 * the reader saves at the same moment always wins. Returns the name it stored, or null.
 *
 * Runs inside the add-log transaction, so it serialises on a per-reader advisory lock held until that transaction ends:
 * without it, two games logged at once (to different decks, whose locks do not meet) each counted only the committed
 * games plus their own, and the third game could pass without the name being learned (Astra, #341). Under READ
 * COMMITTED the count after the lock sees every game committed before it.
 */
export async function learnPtcglName(db: Queryable, userId: string): Promise<string | null> {
  if (!(await ptcglNameReady(db))) return null;
  const current = await ptcglNameOf(db, userId);
  if (current) return null;
  await db.query(`SELECT pg_advisory_xact_lock(hashtext('ptcgl_name:' || $1::text))`, [userId]);
  const { rows } = await db.query<{ name: string; n: number }>(
    `SELECT parsed->'players'->>'me' AS name, count(*)::int AS n
       FROM battle_log
      WHERE user_id = $1 AND origin = 'ptcgl' AND parsed->'players'->>'me' IS NOT NULL
      GROUP BY 1
      ORDER BY 2 DESC, 1
      LIMIT 2`,
    [userId],
  );
  const name = chooseLearnedName(rows);
  // Only a name the column's CHECK accepts: this runs inside the add-log transaction, and a violation would roll the
  // logged game back with it.
  if (!name || name.length > PTCGL_NAME_MAX || name !== name.trim()) return null;
  const updated = await db.query(
    `UPDATE user_settings SET ptcgl_name = $2, ptcgl_name_source = 'auto'
      WHERE user_id = $1 AND ptcgl_name IS NULL`,
    [userId, name],
  );
  return (updated.rowCount ?? 0) > 0 ? name : null;
}
