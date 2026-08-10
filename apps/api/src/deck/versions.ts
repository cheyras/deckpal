import type pg from 'pg';

/**
 * Deck version bookkeeping (Deck Intelligence plan, LOCKED semantics).
 *
 * `deck_card` stays the live working list; `deck_version` snapshots each version.
 * recordDeckChange() is called from EVERY card-list-mutating handler, inside its
 * transaction, AFTER the deck_card writes (the deck row is already locked by the
 * caller's `SELECT … FOR UPDATE`). The auto-bump rule:
 *
 *   • current version has ≥1 battle_log rows → increment deck.version and insert
 *     a NEW deck_version snapshot (post-change state);
 *   • no battle logs yet → amend the current snapshot in place (upsert), so a
 *     burst of UI stepper calls with no intervening battles stays ONE version.
 *
 * Strategy-guide edits never bump — recordStrategyChange() updates
 * deck.strategy_md AND the current snapshot in place. Rename/favorite/cover
 * changes never touch versions; format changes go through recordDeckChange()
 * (they change what the list means).
 */

export interface SnapshotEntry {
  cardId: number;
  tcgdexId: string;
  name: string;
  quantity: number;
}

export interface DeckChangeResult {
  version: number;
  bumped: boolean;
}

/** The live deck_card list shaped for a deck_version.cards snapshot (engine sort order). */
export async function loadSnapshotCards(client: pg.PoolClient, deckId: string): Promise<SnapshotEntry[]> {
  const { rows } = await client.query<{ card_id: string; tcgdex_id: string; name: string; quantity: number }>(
    `SELECT dc.card_id, c.tcgdex_id, c.name, dc.quantity
       FROM deck_card dc
       JOIN card c ON c.id = dc.card_id
      WHERE dc.deck_id = $1
      ORDER BY CASE c.category WHEN 'Pokemon' THEN 0 WHEN 'Trainer' THEN 1 ELSE 2 END,
               c.name, c.number_sort`,
    [deckId],
  );
  return rows.map((r) => ({ cardId: Number(r.card_id), tcgdexId: r.tcgdex_id, name: r.name, quantity: r.quantity }));
}

/**
 * Apply the auto-bump rule after a card-list (or format) mutation. Returns the
 * version the change landed on and whether it was a bump. `note`, when provided,
 * lands on the new snapshot (bump) or overwrites the current snapshot's note
 * (amend); when omitted an amend keeps the existing note.
 */
export async function recordDeckChange(
  client: pg.PoolClient,
  deckId: string,
  opts: { source: string; note?: string | null },
): Promise<DeckChangeResult> {
  const note = opts.note ?? null;
  // user_id comes off the owning deck row, never from the caller. Migration 020
  // added deck_version.user_id NOT NULL and backfilled it with exactly this
  // rule (`UPDATE deck_version dv SET user_id = d.user_id …`) but no writer was
  // updated to keep supplying it, so every snapshot insert violated the
  // constraint. Deriving it here rather than threading a 4th argument through
  // seven call sites means a snapshot cannot be attributed to anyone but the
  // deck's owner — and under RLS this SELECT only ever sees the caller's decks.
  const deck = await client.query<{ version: number; strategy_md: string | null; format_code: string; user_id: string }>(
    `SELECT version, strategy_md, format_code, user_id FROM deck WHERE id = $1`,
    [deckId],
  );
  const d = deck.rows[0];
  if (!d) throw new Error(`recordDeckChange: no deck ${deckId}`);
  const cards = JSON.stringify(await loadSnapshotCards(client, deckId));

  const logs = await client.query<{ n: string }>(
    `SELECT count(*) AS n FROM battle_log WHERE deck_id = $1 AND deck_version = $2`,
    [deckId, d.version],
  );
  const hasLogs = Number(logs.rows[0]?.n ?? 0) > 0;

  if (hasLogs) {
    const next = d.version + 1;
    await client.query(`UPDATE deck SET version = $2 WHERE id = $1`, [deckId, next]);
    await client.query(
      `INSERT INTO deck_version (deck_id, version, format_code, cards, strategy_md, note, source, user_id)
            VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)`,
      [deckId, next, d.format_code, cards, d.strategy_md, note, opts.source, d.user_id],
    );
    return { version: next, bumped: true };
  }

  // Amend in place. The upsert also covers deck creation (no snapshot row yet).
  await client.query(
    `INSERT INTO deck_version (deck_id, version, format_code, cards, strategy_md, note, source, user_id)
          VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
     ON CONFLICT (deck_id, version) DO UPDATE SET
       format_code = EXCLUDED.format_code,
       cards       = EXCLUDED.cards,
       strategy_md = EXCLUDED.strategy_md,
       note        = COALESCE(EXCLUDED.note, deck_version.note),
       source      = EXCLUDED.source,
       updated_at  = now()`,
    [deckId, d.version, d.format_code, cards, d.strategy_md, note, opts.source, d.user_id],
  );
  return { version: d.version, bumped: false };
}

/**
 * Strategy-guide write: update deck.strategy_md and the CURRENT snapshot in
 * place. Never bumps the version (LOCKED). Caller holds the deck lock.
 */
export async function recordStrategyChange(client: pg.PoolClient, deckId: string, strategyMd: string | null): Promise<void> {
  await client.query(`UPDATE deck SET strategy_md = $2, updated_at = now() WHERE id = $1`, [deckId, strategyMd]);
  await client.query(
    `UPDATE deck_version dv SET strategy_md = $2, updated_at = now()
       FROM deck d
      WHERE d.id = $1 AND dv.deck_id = d.id AND dv.version = d.version`,
    [deckId, strategyMd],
  );
}
