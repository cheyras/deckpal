/**
 * Fill `card.playable_fingerprint` — the column that says which rows are the
 * SAME CARD rather than merely the same name.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS, WHEN THE HASH ALREADY DID
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `fingerprint.ts` has computed this since migration 003 declared the column,
 * and `db.ts` calls it — but only in memory, per deck validation, for the
 * reprint-legality oracle. Nothing ever wrote the column. It was NULL on all
 * 23,546 rows, with 003's own comment beside it saying "NULL until full data
 * present", which reads like a note about missing upstream data and was in fact
 * a note about missing code.
 *
 * That mattered because two tools tell the model, in as many words, to
 * **"use the cheapest available printing of the named card"** — on the
 * reasoning that printings are gameplay-identical and can differ by hundreds of
 * dollars. Both halves are true of a REPRINT and neither is true of a NAME.
 * Pokémon reuses names across sets for different cards, and the catalogue
 * proves it: of 1,409 Standard-legal names, 897 have more than one printing and
 * **218 of those are more than one actual card.**
 *
 * Sorted the way that instruction asks for, `Shaymin` reads:
 *
 *     sv08.5-087   70 HP   $0.20     <- cheapest
 *     me03-003     70 HP   $0.21
 *     sv05-013     70 HP   $0.26
 *     sv10-010     80 HP   $0.83     <- the card the decklist actually named
 *     sv10-185     80 HP  $12.92
 *
 * Take the cheapest and you have put a different Pokémon in the deck. It stays
 * 60 cards, it stays format-legal, nothing errors — the deck simply does not do
 * what the list said. Found while building a deck by hand from a battle log,
 * which needed an ad-hoc equivalence check precisely because this column was
 * empty.
 *
 * ── WHY IT IS A PASS AND NOT A COLUMN DEFAULT ───────────────────────────────
 *
 * The hash covers attacks, abilities, weaknesses, resistances and types, which
 * live in child tables written AFTER `card` during an import (they need the
 * card ids). So there is no moment during the insert when the value is
 * computable, and a generated column cannot reach across tables. It is a pass
 * that runs when the children are in place — after an import, and once over
 * everything as a backfill.
 *
 * Cards too thin to trust stay NULL, which is `hasFullGameplayData`'s existing
 * rule and not a new one: a Pokémon with no HP and no attacks would otherwise
 * collide with every other stub, and a wrong "same card" is worse than none.
 */
import type pg from 'pg';
import { computeFingerprints } from './db.js';

export interface IndexResult {
  /** Rows considered. */
  scanned: number;
  /** Rows given a fingerprint they did not have, or a different one. */
  written: number;
  /** Rows whose data is too thin to fingerprint; left NULL on purpose. */
  tooThin: number;
  /** Rows already correct — only counted on a full recompute. */
  unchanged: number;
}

/** How many cards to hydrate per round trip. Five queries per chunk, whatever the size. */
const CHUNK = 500;

export interface IndexOptions {
  /**
   * Recompute rows that already have a fingerprint.
   *
   * Default false, so the ordinary post-import run touches only what is new.
   * Pass true after changing `fingerprint.ts` itself — the hash is a contract
   * between rows, and half the table on an old definition is worse than none.
   */
  all?: boolean;
  chunk?: number;
  onProgress?: (done: number, total: number) => void;
}

export async function indexFingerprints(pool: pg.Pool, opts: IndexOptions = {}): Promise<IndexResult> {
  const size = opts.chunk ?? CHUNK;
  const { rows } = await pool.query<{ id: string }>(
    opts.all
      ? `SELECT id FROM card ORDER BY id`
      : `SELECT id FROM card WHERE playable_fingerprint IS NULL ORDER BY id`,
  );
  const ids = rows.map((r) => Number(r.id));
  const out: IndexResult = { scanned: ids.length, written: 0, tooThin: 0, unchanged: 0 };

  for (let i = 0; i < ids.length; i += size) {
    const slice = ids.slice(i, i + size);
    const fps = await computeFingerprints(pool, slice);

    // Only the rows that HAVE a fingerprint are written. A null is the absence
    // of a claim, and the column already holds null for them.
    const pairs: Array<[number, string]> = [];
    for (const id of slice) {
      const fp = fps.get(id) ?? null;
      if (fp) pairs.push([id, fp]);
      else out.tooThin += 1;
    }

    if (pairs.length) {
      // One statement per chunk. `IS DISTINCT FROM` makes a no-op recompute
      // free and lets `written` mean "actually changed" rather than "visited".
      const values = pairs.map((_, n) => `($${n * 2 + 1}::bigint, $${n * 2 + 2}::char(64))`).join(',');
      const res = await pool.query(
        `UPDATE card SET playable_fingerprint = v.fp
           FROM (VALUES ${values}) AS v(id, fp)
          WHERE card.id = v.id AND card.playable_fingerprint IS DISTINCT FROM v.fp`,
        pairs.flat(),
      );
      out.written += res.rowCount ?? 0;
      out.unchanged += pairs.length - (res.rowCount ?? 0);
    }
    opts.onProgress?.(Math.min(i + size, ids.length), ids.length);
  }
  return out;
}

/**
 * How many card NAMES are more than one actual card, and how many rows that is.
 *
 * The number this pass exists to make knowable. Reported after a run so a
 * regression in `fingerprint.ts` — everything collapsing to one hash, or every
 * row getting its own — is visible immediately rather than the next time
 * somebody builds a deck.
 */
export async function collisionReport(pool: pg.Pool): Promise<{
  names: number;
  namesWithSeveralCards: number;
  rowsFingerprinted: number;
  rowsNull: number;
}> {
  const { rows } = await pool.query<{
    names: string; several: string; fp: string; nul: string;
  }>(
    `WITH byname AS (
       SELECT lower(name) n, count(DISTINCT playable_fingerprint)::int ids
         FROM card WHERE lang='en' AND playable_fingerprint IS NOT NULL GROUP BY 1)
     SELECT (SELECT count(*) FROM byname)::text names,
            (SELECT count(*) FROM byname WHERE ids > 1)::text several,
            (SELECT count(*) FROM card WHERE playable_fingerprint IS NOT NULL)::text fp,
            (SELECT count(*) FROM card WHERE playable_fingerprint IS NULL)::text nul`,
  );
  const r = rows[0]!;
  return {
    names: Number(r.names),
    namesWithSeveralCards: Number(r.several),
    rowsFingerprinted: Number(r.fp),
    rowsNull: Number(r.nul),
  };
}
