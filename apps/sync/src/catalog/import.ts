// TCGdex catalog importer — populates series, card_set, card (+ attribute junctions),
// the variant vocabulary/junction tables, and card_variant, from the compiled EN JSON
// (generated/en/{series,sets,cards}.json). Idempotent; re-running is a no-op.
//
// Connection budget: uses a SINGLE pooled client for the whole run (sync = 1 of 3). One
// transaction per set (SCHEMA/DATA-LAYER §7 grain), plus two global-vocabulary transactions.
//
// Deliberately NOT done here (other tasks own them): prices, dex/species, images, the reverse-holo
// cross-fill. Card attribute junctions with no clean upstream source (card_subtype, card_tag) are
// left empty. Deck/format flags (is_ace_spec, is_radiant, has_rule_box) are vendored — DECK-FORMATS.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makePool, loadEnv } from '@deckscout/db';

// Structural client type — avoids a direct `pg` type dependency in this package. pg.PoolClient
// satisfies it; we only ever call .query here.
interface Queryable {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: R[] }>;
}
import {
  planCardVariants, toFacet, variantKindCode, tierDerived, kindDisplayName, printRunCode,
  slugify, normalizeName, numberSort, localIdNumeric, subtypeLabel, foilLabel, humanize,
  NON_ERROR_SUBTYPES, SYNTHESIZED_FACET, TIER_RULE_VERSION, type RawCard, type Facet,
} from './transform.js';

interface RawSet {
  id: string;
  name: string;
  releaseDate?: string;
  cardCount?: { official?: number; total?: number };
  serie: { id: string; name: string };
  tcgOnline?: string;
  thirdParty?: { tcgplayer?: number; cardmarket?: number };
  logo?: string;
  symbol?: string;
}
interface RawSeries {
  id: string;
  name: string;
  releaseDate?: string;
}

const CATALOGUE = 'en';
const DEFAULT_USER = process.env.DECKSCOUT_DEFAULT_USER ?? 'cheyras';

// Where retired card_variant rows are parked so they cannot collide with the live 0..n-1 slots
// (see the park step in the per-set loop). Must exceed the largest variant count of any single
// card — asserted below rather than assumed — and 1000 + that must stay inside smallint.
const PARK_BASE = 1000;

// ── tiny batch-insert helper (respects pg's 65535-param limit via chunking) ──
async function batchInsert(
  client: Queryable,
  sql: (rows: number) => string,
  cols: number,
  values: unknown[][],
  chunkRows = 400,
): Promise<void> {
  for (let i = 0; i < values.length; i += chunkRows) {
    const chunk = values.slice(i, i + chunkRows);
    const placeholders = chunk
      .map((_, r) => `(${Array.from({ length: cols }, (_, c) => `$${r * cols + c + 1}`).join(',')})`)
      .join(',');
    await client.query(sql(chunk.length).replace('__VALUES__', placeholders), chunk.flat());
  }
}

export interface ImportSummary {
  series: number;
  sets: number;
  cards: number;
  variants: number;
  synthesized: number;
  droppedDuplicates: number;
  variantKinds: number;
  renamedSets: number; // upstream re-keyed a set id; we re-keyed our rows in place
  renamedCards: number;
  /**
   * WHICH sets were re-keyed, not just how many.
   *
   * A rename is the one importer outcome that leaves manual work behind: card art
   * is addressed by the set's `tcgdex_id` (B6), so the images under the old id are
   * stranded the moment this succeeds and the fix needs the exact pair
   * (`rekey:set --rename <from>:<to>`). The counts alone cannot produce that
   * command, and the scheduled refresh has no human reading its logs — so the
   * pairs travel in the summary rather than only in a log line.
   */
  renames: Array<{ from: string; to: string; name: string }>;
  /**
   * Catalog row counts either side of the run, so "what did this change" is
   * answerable without a second connection or a diff against an extract that is
   * gitignored (a CI checkout has no previous snapshot to compare with). Measured
   * on the client the import already holds, before any write and after the last
   * COMMIT — `cards` above counts rows PROCESSED, which is ~23,500 every run and
   * says nothing about growth.
   */
  cardsBefore: number;
  cardsAfter: number;
  setsBefore: number;
  setsAfter: number;
}

/** Catalog size at one instant, on the connection the import already holds. */
async function countCatalog(
  client: Queryable,
  summary: ImportSummary,
  when: 'before' | 'after',
): Promise<void> {
  const { rows } = await client.query<{ cards: string; sets: string }>(
    `SELECT (SELECT COUNT(*) FROM card WHERE lang = $1) AS cards,
            (SELECT COUNT(*) FROM card_set)             AS sets`,
    [CATALOGUE],
  );
  const cards = Number(rows[0]?.cards ?? 0);
  const sets = Number(rows[0]?.sets ?? 0);
  if (when === 'before') {
    summary.cardsBefore = cards;
    summary.setsBefore = sets;
  } else {
    summary.cardsAfter = cards;
    summary.setsAfter = sets;
  }
}

export async function importCatalog(dataDir: string): Promise<ImportSummary> {
  loadEnv();
  const series: RawSeries[] = JSON.parse(readFileSync(join(dataDir, 'series.json'), 'utf-8'));
  const sets: RawSet[] = JSON.parse(readFileSync(join(dataDir, 'sets.json'), 'utf-8'));
  const cards: RawCard[] = JSON.parse(readFileSync(join(dataDir, 'cards.json'), 'utf-8'));

  const cardsBySet = new Map<string, RawCard[]>();
  for (const c of cards) {
    const arr = cardsBySet.get(c.set.id);
    if (arr) arr.push(c);
    else cardsBySet.set(c.set.id, [c]);
  }

  const pool = makePool(1);
  const client = await pool.connect();
  const summary: ImportSummary = {
    series: 0, sets: 0, cards: 0, variants: 0, synthesized: 0, droppedDuplicates: 0, variantKinds: 0,
    renamedSets: 0, renamedCards: 0, renames: [],
    cardsBefore: 0, cardsAfter: 0, setsBefore: 0, setsAfter: 0,
  };
  try {
    await countCatalog(client, summary, 'before');
    // ── 1. series (union of series.json and every set's serie ref) ───────────
    const seriesMeta = new Map<string, { name: string; release?: string }>();
    for (const s of series) seriesMeta.set(s.id, { name: s.name, release: s.releaseDate });
    for (const st of sets) if (!seriesMeta.has(st.serie.id)) seriesMeta.set(st.serie.id, { name: st.serie.name });

    const seriesIdByTcgdex = new Map<string, number>();
    await client.query('BEGIN');
    {
      const usedSlugs = new Set<string>();
      let order = 0;
      const rows: unknown[][] = [];
      for (const [tcgdexId, m] of seriesMeta) {
        let slug = slugify(m.name) || tcgdexId;
        while (usedSlugs.has(slug)) slug = `${slug}-${tcgdexId}`;
        usedSlugs.add(slug);
        rows.push([CATALOGUE, tcgdexId, slug, m.name, m.release ?? null, order++]);
      }
      const { rows: back } = await client.query<{ id: string; tcgdex_id: string }>(
        `INSERT INTO series (catalogue_code, tcgdex_id, slug, name, first_release_on, sort_order)
         VALUES ${rows.map((_, r) => `($${r * 6 + 1},$${r * 6 + 2},$${r * 6 + 3},$${r * 6 + 4},$${r * 6 + 5},$${r * 6 + 6})`).join(',')}
         ON CONFLICT (catalogue_code, tcgdex_id) DO UPDATE
           SET name = EXCLUDED.name, first_release_on = EXCLUDED.first_release_on
         RETURNING id, tcgdex_id`,
        rows.flat(),
      );
      for (const r of back) seriesIdByTcgdex.set(r.tcgdex_id, Number(r.id));
      summary.series = back.length;
    }
    await client.query('COMMIT');

    // ── 2. variant vocabulary + variant_kind + variant_kind_stamp (global) ───
    // Collect the distinct facet universe from every card (+ the synthesized normal).
    const kinds = new Map<string, Facet>();
    kinds.set(variantKindCode(SYNTHESIZED_FACET), SYNTHESIZED_FACET);
    const subtypes = new Set<string>();
    const stamps = new Set<string>();
    const foils = new Set<string>();
    const printRuns = new Set<string>();
    for (const c of cards) {
      for (const v of c.variants_detailed ?? []) {
        const f = toFacet(v);
        kinds.set(variantKindCode(f), f);
        if (f.subtype) subtypes.add(f.subtype);
        if (f.foil) foils.add(f.foil);
        for (const s of f.stamps) stamps.add(s);
        printRuns.add(printRunCode(f));
      }
    }

    await client.query('BEGIN');
    // facet value vocabularies (open enums — INSERT any value not already seeded in 013)
    if (subtypes.size)
      await batchInsert(
        client,
        () => `INSERT INTO variant_print_subtype (code,label,is_error) VALUES __VALUES__ ON CONFLICT (code) DO NOTHING`,
        3,
        [...subtypes].map((s) => [s, subtypeLabel(s), !NON_ERROR_SUBTYPES.has(s)]),
      );
    if (foils.size)
      await batchInsert(
        client,
        () => `INSERT INTO variant_foil (code,label,is_organised_play) VALUES __VALUES__ ON CONFLICT (code) DO NOTHING`,
        3,
        [...foils].map((f) => [f, foilLabel(f), false]),
      );
    if (stamps.size)
      await batchInsert(
        client,
        () => `INSERT INTO variant_stamp (code,label) VALUES __VALUES__ ON CONFLICT (code) DO NOTHING`,
        2,
        [...stamps].map((s) => [s, humanize(s)]),
      );
    // print runs: base/first/shadowless/no-e-reader are seeded; other-subtype runs get a row
    const extraRuns = [...printRuns].filter((r) => !['base', 'first', 'shadowless', 'no-e-reader'].includes(r));
    if (extraRuns.length)
      await batchInsert(
        client,
        () => `INSERT INTO variant_print_run (code,label,is_base,provenance) VALUES __VALUES__ ON CONFLICT (code) DO NOTHING`,
        4,
        extraRuns.map((r) => [r, `${subtypeLabel(r)} Print Run`, false, null]),
      );

    // variant_kind (tier rewritten wholesale each sync — SCHEMA §5)
    await batchInsert(
      client,
      () => `INSERT INTO variant_kind
               (code, display_name, finish, print_subtype, size, foil, print_run_code, tier_derived, tier_rule_version)
             VALUES __VALUES__
             ON CONFLICT (code) DO UPDATE SET
               display_name = EXCLUDED.display_name,
               tier_derived = EXCLUDED.tier_derived,
               tier_rule_version = EXCLUDED.tier_rule_version,
               tier_derived_at = now()`,
      9,
      [...kinds.values()].map((f) => [
        variantKindCode(f), kindDisplayName(f), f.finish, f.subtype, f.size, f.foil,
        printRunCode(f), tierDerived(f), TIER_RULE_VERSION,
      ]),
    );
    // variant_kind_stamp junction
    const ks: unknown[][] = [];
    for (const f of kinds.values()) for (const s of f.stamps) ks.push([variantKindCode(f), s]);
    if (ks.length)
      await batchInsert(
        client,
        () => `INSERT INTO variant_kind_stamp (variant_kind_code, stamp_code) VALUES __VALUES__ ON CONFLICT DO NOTHING`,
        2,
        ks,
      );
    await client.query('COMMIT');
    summary.variantKinds = kinds.size;

    // ── 2b. upstream set-id renames (must run BEFORE the per-set loop) ───────
    // TCGdex occasionally re-keys a set without renaming it. 2026-08: the four SWSH
    // Trainer Gallery subsets went swsh9.5tg -> swsh9tg (…10/11/12 likewise), and every
    // card under them went swsh9.5tg-TG01 -> swsh9tg-TG01.
    //
    // Left alone this is not a slow drift, it is a hard stop: card_set upserts on
    // (series_id, tcgdex_id), so the re-keyed set looks new and gets INSERTed — straight
    // into the (series_id, slug) UNIQUE the old row still holds. That is a 23505 that
    // aborts the whole import, so ONE upstream rename freezes the entire catalog, every
    // set, until someone intervenes. (This is how issue #21's 222 missing cards outlived
    // several sync windows.)
    //
    // So: re-key our rows in place first, and let the normal upsert path below update the
    // same rows it always did. Identity is the bigint PK, which never moves, so every
    // user-owned FK (collection_item, deck_card, list_item, graded_card, …) rides along
    // untouched — B8's "an import never deletes user data" holds by construction.
    //
    // Detection is deliberately narrow: same (series_id, slug), different tcgdex_id, AND
    // the id we hold is one upstream no longer publishes. Two live sets that merely share
    // a name are a slug collision, not a rename, and are left for a human.
    const upstreamSetIds = new Set(sets.map((s) => s.id));
    await client.query('BEGIN');
    for (const st of sets) {
      const seriesId = seriesIdByTcgdex.get(st.serie.id);
      if (seriesId == null) continue;
      const slug = slugify(st.name) || st.id;
      const { rows: held } = await client.query<{ id: string; tcgdex_id: string }>(
        `SELECT id, tcgdex_id FROM card_set WHERE series_id = $1 AND slug = $2`,
        [seriesId, slug],
      );
      const prior = held[0];
      if (!prior || prior.tcgdex_id === st.id) continue; // fresh set, or already correct
      if (upstreamSetIds.has(prior.tcgdex_id)) continue; // both ids live upstream => not a rename

      const setRowId = Number(prior.id);
      await client.query(`UPDATE card_set SET tcgdex_id = $1 WHERE id = $2`, [st.id, setRowId]);
      summary.renamedSets++;

      // Re-key the set's cards by local_id. We map from the compiled JSON rather than
      // string-surgery on the old id, so the upstream `${set}-${localId}` convention is a
      // convenience we read, never an assumption we depend on.
      const renameRows = (cardsBySet.get(st.id) ?? []).map((c) => [c.localId, c.id]);
      for (let i = 0; i < renameRows.length; i += 400) {
        const chunk = renameRows.slice(i, i + 400);
        const ph = chunk.map((_, r) => `($${r * 2 + 1}::text,$${r * 2 + 2}::text)`).join(',');
        const { rows: moved } = await client.query<{ id: string }>(
          `UPDATE card c SET tcgdex_id = v.new_id
             FROM (VALUES ${ph}) AS v(local_id, new_id)
            WHERE c.set_id = $${chunk.length * 2 + 1}
              AND c.lang = $${chunk.length * 2 + 2}
              AND c.local_id = v.local_id
              AND c.tcgdex_id <> v.new_id
            RETURNING c.id`,
          [...chunk.flat(), setRowId, CATALOGUE],
        );
        summary.renamedCards += moved.length;
      }
      summary.renames.push({ from: prior.tcgdex_id, to: st.id, name: st.name });
      console.log(
        `[catalog-import] upstream renamed set ${prior.tcgdex_id} -> ${st.id} (${st.name}); re-keyed in place`,
      );
    }
    await client.query('COMMIT');
    if (summary.renamedSets > 0) {
      // Card art is keyed on the set's tcgdex_id (B6), so the old objects are now orphaned
      // under a path nothing resolves. Say so loudly — the fix is an images-side re-warm,
      // not something the catalog importer may reach across and do.
      console.warn(
        `[catalog-import] ${summary.renamedSets} set(s) re-keyed: their cached card art still sits under the OLD ` +
          `path and will serve placeholders. Re-address it (bytes are already correct — this is a ` +
          `re-key, not a re-warm):\n` +
          summary.renames
            .map(
              (r) =>
                `    pnpm --filter deckscout-images rekey:set --rename ${r.from}:${r.to}` +
                `            # disk tier\n` +
                `    pnpm --filter deckscout-images rekey:set --object-store --rename ${r.from}:${r.to}  # object tier`,
            )
            .join('\n'),
      );
    }

    // ── 3. per-set transaction: card_set, cards (+attrs), card_variant ───────
    for (const st of sets) {
      const setCards = cardsBySet.get(st.id) ?? [];
      const seriesId = seriesIdByTcgdex.get(st.serie.id);
      if (seriesId == null) throw new Error(`set ${st.id} references unknown serie ${st.serie.id}`);

      await client.query('BEGIN');
      // card_set
      const slug = slugify(st.name) || st.id;
      const { rows: setBack } = await client.query<{ id: string }>(
        `INSERT INTO card_set
           (series_id, tcgdex_id, slug, name, released_on, card_count_official, card_count_total,
            ptcgl_code, tcgplayer_group_id, is_promo, logo_url, symbol_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (series_id, tcgdex_id) DO UPDATE SET
           slug = EXCLUDED.slug, name = EXCLUDED.name, released_on = EXCLUDED.released_on,
           card_count_official = EXCLUDED.card_count_official, card_count_total = EXCLUDED.card_count_total,
           ptcgl_code = EXCLUDED.ptcgl_code, tcgplayer_group_id = EXCLUDED.tcgplayer_group_id,
           is_promo = EXCLUDED.is_promo, logo_url = EXCLUDED.logo_url, symbol_url = EXCLUDED.symbol_url
         RETURNING id`,
        [
          seriesId, st.id, slug, st.name, st.releaseDate ?? null,
          st.cardCount?.official ?? null, st.cardCount?.total ?? null,
          st.tcgOnline ?? null, st.thirdParty?.tcgplayer ?? null,
          /promo/i.test(st.name), st.logo ?? null, st.symbol ?? null,
        ],
      );
      const setId = Number(setBack[0]!.id);
      summary.sets++;

      if (setCards.length === 0) {
        await client.query('COMMIT');
        continue;
      }

      // cards (batch upsert, RETURNING id map)
      const cardRows = setCards.map((c) => [
        setId, c.id, 'en', c.localId, localIdNumeric(c.localId), numberSort(c.localId),
        c.name, normalizeName(c.name), c.category, c.rarity ?? null, c.illustrator ?? null,
        c.hp ?? null, c.stage ?? null, c.suffix ?? null, c.evolveFrom ?? null, c.trainerType ?? null,
        c.energyType ?? null, c.retreat ?? null, c.effect ?? null,
        c.regulationMark ? c.regulationMark.slice(0, 1) : null,
        c.legal?.standard ?? false, c.legal?.expanded ?? false,
        st.releaseDate ?? null, c.updated ?? null,
      ]);
      const CARD_COLS = 24;
      const cardIdByTcgdex = new Map<string, number>();
      for (let i = 0; i < cardRows.length; i += 400) {
        const chunk = cardRows.slice(i, i + 400);
        const ph = chunk
          .map((_, r) => `(${Array.from({ length: CARD_COLS }, (_, c) => `$${r * CARD_COLS + c + 1}`).join(',')})`)
          .join(',');
        const { rows: back } = await client.query<{ id: string; tcgdex_id: string }>(
          `INSERT INTO card
             (set_id, tcgdex_id, lang, local_id, local_id_numeric, number_sort, name, name_normalized,
              category, rarity, illustrator, hp, stage, suffix, evolve_from, trainer_type, energy_type,
              retreat, effect, regulation_mark, legal_standard, legal_expanded, released_on, tcgdex_updated_at)
           VALUES ${ph}
           ON CONFLICT (tcgdex_id, lang) DO UPDATE SET
             set_id=EXCLUDED.set_id, local_id=EXCLUDED.local_id, local_id_numeric=EXCLUDED.local_id_numeric,
             number_sort=EXCLUDED.number_sort, name=EXCLUDED.name, name_normalized=EXCLUDED.name_normalized,
             category=EXCLUDED.category, rarity=EXCLUDED.rarity, illustrator=EXCLUDED.illustrator, hp=EXCLUDED.hp,
             stage=EXCLUDED.stage, suffix=EXCLUDED.suffix, evolve_from=EXCLUDED.evolve_from,
             trainer_type=EXCLUDED.trainer_type, energy_type=EXCLUDED.energy_type, retreat=EXCLUDED.retreat,
             effect=EXCLUDED.effect, regulation_mark=EXCLUDED.regulation_mark, legal_standard=EXCLUDED.legal_standard,
             legal_expanded=EXCLUDED.legal_expanded, released_on=EXCLUDED.released_on,
             tcgdex_updated_at=EXCLUDED.tcgdex_updated_at, synced_at=now()
           RETURNING id, tcgdex_id`,
          chunk.flat(),
        );
        for (const r of back) cardIdByTcgdex.set(r.tcgdex_id, Number(r.id));
      }
      summary.cards += setCards.length;

      // card attribute junctions: DELETE-then-INSERT (no user FK on these — safe to replace).
      // INVARIANT: the table list is a hardcoded constant — never derived from user input.
      // Each name is a known junction table in the schema; no interpolation risk.
      const cardIds = [...cardIdByTcgdex.values()];
      for (const t of ['card_type', 'card_attack', 'card_ability', 'card_matchup'] as const) {
        await client.query(`DELETE FROM ${t} WHERE card_id = ANY($1::bigint[])`, [cardIds]);
      }
      const typeRows: unknown[][] = [], attackRows: unknown[][] = [], abilityRows: unknown[][] = [], matchupRows: unknown[][] = [];
      for (const c of setCards) {
        const cid = cardIdByTcgdex.get(c.id)!;
        // NOT-NULL columns: skip incomplete upstream rows (94 attacks / 40 abilities have no name).
        (c.types ?? []).forEach((t, i) => { if (t != null) typeRows.push([cid, i, t]); });
        (c.attacks ?? []).forEach((a, i) => {
          if (a?.name != null) attackRows.push([cid, i, a.name, a.damage != null ? String(a.damage) : null, a.effect ?? null, (a.cost ?? []).join(',') || null]);
        });
        (c.abilities ?? []).forEach((a, i) => { if (a?.name != null) abilityRows.push([cid, i, a.type ?? null, a.name, a.effect ?? null]); });
        (c.weaknesses ?? []).forEach((w, i) => { if (w?.type != null && w.value != null) matchupRows.push([cid, 'weakness', i, w.type, w.value]); });
        (c.resistances ?? []).forEach((w, i) => { if (w?.type != null && w.value != null) matchupRows.push([cid, 'resistance', i, w.type, w.value]); });
      }
      if (typeRows.length) await batchInsert(client, () => `INSERT INTO card_type (card_id,slot,type) VALUES __VALUES__`, 3, typeRows);
      if (attackRows.length) await batchInsert(client, () => `INSERT INTO card_attack (card_id,ord,name,damage,effect,cost) VALUES __VALUES__`, 6, attackRows);
      if (abilityRows.length) await batchInsert(client, () => `INSERT INTO card_ability (card_id,ord,kind,name,effect) VALUES __VALUES__`, 5, abilityRows);
      if (matchupRows.length) await batchInsert(client, () => `INSERT INTO card_matchup (card_id,kind,ord,type,value) VALUES __VALUES__`, 5, matchupRows);

      // card_variant: clear primaries for these cards, then upsert (keyed on card_id,variant_kind_code)
      await client.query(`UPDATE card_variant SET is_primary=false WHERE card_id = ANY($1::bigint[]) AND is_primary`, [cardIds]);

      // Then park every existing variant of these cards above the live 0..n-1 range.
      //
      // (card_id, sort_order) is UNIQUE. The upsert below only touches kinds upstream STILL
      // publishes, so a variant upstream has since retired keeps the slot it was given years
      // ago — and the first time upstream reshuffles a card's variants_detailed, some live
      // variant is handed a sort_order a retired row is still sitting on. The constraint is
      // DEFERRABLE INITIALLY DEFERRED, so this does not surface as a bad row: it detonates at
      // COMMIT and takes the whole set's transaction with it. (Measured against the 3-week-old
      // snapshot this import replaced: 5,081 retired rows across 77 sets, 847 of them collided.)
      //
      // Retired rows must NOT be deleted — collection_item, deck_card, list_item, graded_card
      // and user_showcase all point at card_variant, and B8 says an import never destroys
      // user-owned data. So park, don't prune. row_number() keeps the parked block internally
      // collision-free per card; PARK_BASE keeps it clear of the live range; the upsert
      // immediately below pulls every still-published variant back down. Retired printings a
      // user owns therefore survive, and simply sort after the live ones.
      await client.query(
        `UPDATE card_variant cv SET sort_order = p.parked
           FROM (SELECT id, $2::int + (row_number() OVER (PARTITION BY card_id ORDER BY sort_order, id))::int AS parked
                   FROM card_variant WHERE card_id = ANY($1::bigint[])) p
          WHERE cv.id = p.id`,
        [cardIds, PARK_BASE],
      );

      const varRows: unknown[][] = [];
      for (const c of setCards) {
        const cid = cardIdByTcgdex.get(c.id)!;
        const plan = planCardVariants(c);
        summary.droppedDuplicates += plan.droppedDuplicates;
        // The park range starts at PARK_BASE; a card with that many live variants would land a
        // live slot on top of a parked one. Nothing upstream is remotely close (the busiest card
        // has single digits), so this is a tripwire, not a branch — fail loudly rather than
        // corrupt sort_order silently if upstream ever does something absurd.
        if (plan.variants.length >= PARK_BASE) {
          throw new Error(
            `card ${c.id} plans ${plan.variants.length} variants, which reaches PARK_BASE (${PARK_BASE}) — raise PARK_BASE`,
          );
        }
        for (const v of plan.variants) {
          if (v.isSynthesized) summary.synthesized++;
          summary.variants++;
          varRows.push([
            cid, v.code, v.tcgdexVariantId, v.sortOrder, v.isPrimary, v.isSynthesized,
            v.tcgplayerProductId, v.tcgplayerPrinting, v.cardmarketProductId, v.cardtraderProductId,
            v.idSource, v.idConfidence, v.displayName, v.provenance, 'tcgdex',
          ]);
        }
      }
      await batchInsert(
        client,
        () => `INSERT INTO card_variant
                 (card_id, variant_kind_code, tcgdex_variant_id, sort_order, is_primary, is_synthesized,
                  tcgplayer_product_id, tcgplayer_printing, cardmarket_product_id, cardtrader_product_id,
                  id_source, id_confidence, display_name, provenance, source)
               VALUES __VALUES__
               ON CONFLICT (card_id, variant_kind_code) DO UPDATE SET
                 tcgdex_variant_id=EXCLUDED.tcgdex_variant_id, sort_order=EXCLUDED.sort_order,
                 is_primary=EXCLUDED.is_primary, is_synthesized=EXCLUDED.is_synthesized,
                 tcgplayer_product_id=EXCLUDED.tcgplayer_product_id, tcgplayer_printing=EXCLUDED.tcgplayer_printing,
                 cardmarket_product_id=EXCLUDED.cardmarket_product_id, cardtrader_product_id=EXCLUDED.cardtrader_product_id,
                 id_source=EXCLUDED.id_source, id_confidence=EXCLUDED.id_confidence,
                 display_name=EXCLUDED.display_name, provenance=EXCLUDED.provenance,
                 source=EXCLUDED.source, last_synced_at=now()`,
        15,
        varRows,
        200,
      );
      await client.query('COMMIT');
    }

    // ── 4. catalog_variant_count baseline on user_set_progress (SCHEMA §9.3) ──
    // Populates the staleness probe + catalog-derived denominators for the default user. Only
    // catalog-derived columns are ever UPDATEd on conflict — owned_required / total_quantity /
    // reconciled_at are left to the progress-reconcile task, so a re-run never clobbers ownership.
    // Single grouped pass (a correlated-subquery form times out against the role's 30s cap; this
    // form runs in ~0.2s). master_req replicates master_required_variant: standard-tier pairs plus
    // the is_primary fallback for cards that have no standard variant (SCHEMA §5.3 / §9.2).
    await client.query('BEGIN');
    await client.query(
      `WITH v AS (
         SELECT c.set_id, c.id AS card_id, cv.id AS cv_id, cv.is_primary, (tr.tier='standard') AS is_std
         FROM card c
         JOIN card_variant cv ON cv.card_id = c.id
         JOIN variant_tier_resolved tr ON tr.card_variant_id = cv.id
       ),
       card_std AS (SELECT set_id, card_id, bool_or(is_std) AS has_std FROM v GROUP BY set_id, card_id),
       master AS (
         SELECT v.set_id,
                count(*) FILTER (WHERE v.is_std)
                + count(*) FILTER (WHERE NOT cs.has_std AND v.is_primary) AS master_req
         FROM v JOIN card_std cs ON cs.set_id = v.set_id AND cs.card_id = v.card_id
         GROUP BY v.set_id
       ),
       agg AS (SELECT c.set_id, count(DISTINCT c.id) AS cards, count(cv.id) AS variants
               FROM card c JOIN card_variant cv ON cv.card_id = c.id GROUP BY c.set_id)
       INSERT INTO user_set_progress
         (user_id, set_id, goal, owned_required, total_required, total_quantity, catalog_variant_count, recomputed_at)
       SELECT u.id, s.id, g.goal, 0,
              CASE g.goal WHEN 'complete' THEN a.cards
                          WHEN 'grandmaster' THEN a.variants
                          ELSE m.master_req END,
              0, a.variants, now()
       FROM card_set s
       JOIN agg a ON a.set_id = s.id
       JOIN master m ON m.set_id = s.id
       CROSS JOIN app_user u
       CROSS JOIN (VALUES ('complete'),('master'),('grandmaster')) AS g(goal)
       WHERE u.username = $1
       ON CONFLICT (user_id, set_id, goal) DO UPDATE SET
         total_required = EXCLUDED.total_required,
         catalog_variant_count = EXCLUDED.catalog_variant_count,
         recomputed_at = now()`,
      [DEFAULT_USER],
    );
    await client.query('COMMIT');

    await countCatalog(client, summary, 'after');
    return summary;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}
