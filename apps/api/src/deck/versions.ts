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
 * A REVERT IS THE EXCEPTION and always bumps (`forceBump`, see restoreSnapshot).
 * Amending exists to absorb stepper noise. A revert is one deliberate act, and
 * the snapshot it would amend is the only copy of the list being replaced, so
 * amending there erased an unplayed working list while the History tab promised
 * "nothing is lost" (DECISIONS 2026-09-26). Every handler keeps the current
 * snapshot equal to the live list, which is why a bump alone preserves it.
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
  /** Migration 051: which printing. ABSENT on snapshots taken before decks
   *  were variant-scoped — readers must treat a missing variantId as "the
   *  card's primary variant", never as a change, or every historical version
   *  would appear to have swapped every card. */
  variantId?: number;
  /** Display name of the printing, for diff lines that need to say which. */
  variantName?: string | null;
}

export interface DeckChangeResult {
  version: number;
  bumped: boolean;
}

/** The live deck_card list shaped for a deck_version.cards snapshot (engine sort order). */
export async function loadSnapshotCards(client: pg.PoolClient, deckId: string): Promise<SnapshotEntry[]> {
  const { rows } = await client.query<{
    card_id: string;
    card_variant_id: string;
    variant_name: string | null;
    tcgdex_id: string;
    name: string;
    quantity: number;
  }>(
    `SELECT dc.card_id, dc.card_variant_id, c.tcgdex_id, c.name, dc.quantity,
            COALESCE(cv.display_name, vk.display_name) AS variant_name
       FROM deck_card dc
       JOIN card c ON c.id = dc.card_id
       JOIN card_variant cv ON cv.id = dc.card_variant_id
       JOIN variant_kind vk ON vk.code = cv.variant_kind_code
      WHERE dc.deck_id = $1
      ORDER BY CASE c.category WHEN 'Pokemon' THEN 0 WHEN 'Trainer' THEN 1 ELSE 2 END,
               c.name, c.number_sort, cv.sort_order`,
    [deckId],
  );
  return rows.map((r) => ({
    cardId: Number(r.card_id),
    tcgdexId: r.tcgdex_id,
    name: r.name,
    quantity: r.quantity,
    variantId: Number(r.card_variant_id),
    variantName: r.variant_name,
  }));
}

/**
 * Apply the auto-bump rule after a card-list (or format) mutation. Returns the
 * version the change landed on and whether it was a bump. `note`, when provided,
 * lands on the new snapshot (bump) or overwrites the current snapshot's note
 * (amend); when omitted an amend keeps the existing note. `forceBump` skips the
 * battle-log test and always creates a new version (revert only; see header).
 */
export async function recordDeckChange(
  client: pg.PoolClient,
  deckId: string,
  opts: { source: string; note?: string | null; forceBump?: boolean },
): Promise<DeckChangeResult> {
  const note = opts.note ?? null;
  // user_id comes off the owning deck row, never from the caller. Migration 020
  // added deck_version.user_id NOT NULL and backfilled it with exactly this
  // rule (`UPDATE deck_version dv SET user_id = d.user_id …`) but no writer was
  // updated to keep supplying it, so every snapshot insert violated the
  // constraint. Deriving it here rather than threading a 4th argument through
  // seven call sites means a snapshot cannot be attributed to anyone but the
  // deck's owner — and under RLS this SELECT only ever sees the caller's decks.
  // soft-delete-exempt: internal helper — every caller has already taken the
  // deck lock through assertDeck(), which filters deleted_at.
  const deck = await client.query<{ version: number; strategy_md: string | null; format_code: string; user_id: string }>(
    `SELECT version, strategy_md, format_code, user_id FROM deck WHERE id = $1`,
    [deckId],
  );
  const d = deck.rows[0];
  if (!d) throw new Error(`recordDeckChange: no deck ${deckId}`);
  const cards = JSON.stringify(await loadSnapshotCards(client, deckId));

  let bump = opts.forceBump === true;
  if (!bump) {
    const logs = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM battle_log WHERE deck_id = $1 AND deck_version = $2`,
      [deckId, d.version],
    );
    bump = Number(logs.rows[0]?.n ?? 0) > 0;
  }

  if (bump) {
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

export interface RestoreResult extends DeckChangeResult {
  /** Snapshot entries whose card has left the catalog since; reported, never applied. */
  skippedCards: { cardId: number; tcgdexId: string; name: string }[];
}

/**
 * Make an old snapshot the live list again, as a NEW version (the revert).
 *
 * The version being replaced keeps its snapshot untouched, so "revert back" is
 * always possible, whether or not it was ever played. The caller holds the deck
 * lock and has checked that `target` is a different version of this deck.
 * Cards hard-deleted from the catalog since the snapshot (near-impossible under
 * ON DELETE RESTRICT) are reported in `skippedCards`, never silently dropped.
 */
export async function restoreSnapshot(
  client: pg.PoolClient,
  deckId: string,
  userId: string,
  target: { cards: SnapshotEntry[]; strategyMd: string | null },
  opts: { includeStrategy: boolean; source: string; note: string },
): Promise<RestoreResult> {
  // Resolve snapshot entries against the live catalog by card id.
  const wantIds = target.cards.map((c) => c.cardId);
  const live = wantIds.length
    ? await client.query<{ id: string }>(`SELECT id FROM card WHERE id = ANY($1)`, [wantIds])
    : { rows: [] as { id: string }[] };
  const liveIds = new Set(live.rows.map((r) => Number(r.id)));
  const apply = target.cards.filter((c) => liveIds.has(c.cardId));
  const skippedCards = target.cards.filter((c) => !liveIds.has(c.cardId))
    .map((c) => ({ cardId: c.cardId, tcgdexId: c.tcgdexId, name: c.name }));

  // Resolve each entry to a PRINTING (migration 051). A post-051 snapshot
  // names its variant; use it if it is still a printing of that card.
  // A pre-051 snapshot (or a since-retired variant id) falls back to the
  // card's primary variant — "primary, never a change" is the documented
  // reading of a variant-less snapshot.
  const namedVariants = [...new Set(apply.map((c) => c.variantId).filter((v): v is number => typeof v === 'number'))];
  const validVariant = new Map<number, number>(); // variantId -> cardId
  if (namedVariants.length) {
    const rows = await client.query<{ id: string; card_id: string }>(
      `SELECT id, card_id FROM card_variant WHERE id = ANY($1::bigint[])`,
      [namedVariants],
    );
    for (const r of rows.rows) validVariant.set(Number(r.id), Number(r.card_id));
  }
  const primaries = apply.length
    ? await client.query<{ card_id: string; id: string }>(
        `SELECT DISTINCT ON (card_id) card_id, id FROM card_variant
          WHERE card_id = ANY($1::bigint[])
          ORDER BY card_id, is_primary DESC, sort_order`,
        [apply.map((c) => c.cardId)],
      )
    : { rows: [] as { card_id: string; id: string }[] };
  const primaryOf = new Map(primaries.rows.map((r) => [Number(r.card_id), Number(r.id)]));

  // One target quantity per printing (two old entries can land on one
  // primary only in theory, but a sum beats a silent overwrite).
  const byVariant = new Map<number, { cardId: number; quantity: number }>();
  for (const c of apply) {
    const vid =
      typeof c.variantId === 'number' && validVariant.get(c.variantId) === c.cardId
        ? c.variantId
        : primaryOf.get(c.cardId);
    if (vid === undefined) continue;
    const cur = byVariant.get(vid);
    byVariant.set(vid, { cardId: c.cardId, quantity: Math.min(60, (cur?.quantity ?? 0) + Math.max(1, c.quantity)) });
  }

  // Reconcile deck_card to the snapshot in one pass, keyed by printing.
  await client.query(
    `DELETE FROM deck_card WHERE deck_id = $1 AND card_variant_id <> ALL($2::bigint[])`,
    [deckId, [...byVariant.keys()]],
  );
  for (const [vid, t] of byVariant) {
    await client.query(
      `INSERT INTO deck_card (deck_id, card_id, card_variant_id, user_id, quantity) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (deck_id, card_variant_id) DO UPDATE SET quantity = $5`,
      [deckId, t.cardId, vid, userId, t.quantity],
    );
  }
  if (opts.includeStrategy) {
    await client.query(`UPDATE deck SET strategy_md = $2 WHERE id = $1`, [deckId, target.strategyMd]);
  }
  await client.query(`UPDATE deck SET updated_at = now() WHERE id = $1`, [deckId]);
  const change = await recordDeckChange(client, deckId, { source: opts.source, note: opts.note, forceBump: true });
  return { ...change, skippedCards };
}

/**
 * Strategy-guide write: update deck.strategy_md and the CURRENT snapshot in
 * place. Never bumps the version (LOCKED). Caller holds the deck lock.
 */
export async function recordStrategyChange(client: pg.PoolClient, deckId: string, strategyMd: string | null): Promise<void> {
  await client.query(`UPDATE deck SET strategy_md = $2, updated_at = now() WHERE id = $1`, [deckId, strategyMd]);
  // soft-delete-exempt: writes the current version snapshot behind the caller's
  // deck lock; the deck's own liveness was checked by assertDeck().
  await client.query(
    `UPDATE deck_version dv SET strategy_md = $2, updated_at = now()
       FROM deck d
      WHERE d.id = $1 AND dv.deck_id = d.id AND dv.version = d.version`,
    [deckId, strategyMd],
  );
}
