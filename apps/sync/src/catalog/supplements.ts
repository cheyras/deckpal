/**
 * Sets TCGdex has not published yet, held in the catalog until it does.
 *
 * The catalog is TCGdex's (import.ts), and a set TCGdex lacks is a set nobody can log. The 2026
 * McDonald's promotion is the case that made this exist: TCGplayer listed its 15 cards on
 * 2026-11-06 (group 24938), and TCGdex had none of them.
 *
 * Every card such a set holds is a REPRINT of a card the catalog already has, so a card here is a
 * pointer, not a copy of anyone's data: its collector number, its TCGplayer product and printing,
 * and the TCGdex id of the card it reprints. Its rules text, types, weakness, retreat, regulation
 * mark and reprint fingerprint are copied from that card at write time. That is the reason for the
 * shape: TCGplayer's own text for these cards is hand-typed (three attack names disagree with the
 * printed English names of the cards they reprint, and one Ability is missing), and TCGdex's text
 * for the original is the text this catalog already trusts.
 *
 * ── How TCGdex takes the set over ──────────────────────────────────────────
 * The rows are written the way TCGdex would write them: its series ('mc' for the McDonald's
 * collections), its set name ("McDonald's Collection 2026", as for 2011–2024), its unpadded
 * collector numbers ('1'..'15'). When TCGdex publishes the set, import.ts either upserts these
 * rows by id, or — if TCGdex picks another id — re-keys them in place through its rename step,
 * which matches on (series, slug) and keeps every bigint id. Either way the cards and printings a
 * user logged here stay attached (B8). This module then sees a set TCGdex owns and writes nothing.
 *
 * Writes only rows that do not exist, and never updates one, so a second run is a no-op.
 */
import type { Queryable } from '@deckpal/db';
import { recomputeCoverage } from '../prices/coverage.js';
import { FINISH_LABEL, localIdNumeric, numberSort, slugify, tcgplayerPrinting } from './transform.js';

export interface SupplementCard {
  /** TCGdex-style collector number, unpadded for the McDonald's sets ('1', not '001'). */
  localId: string;
  /** As printed. Checked against the card it reprints before anything is copied. */
  name: string;
  hp: number | null;
  /** TCGplayer's printing for the product: 'normal' (Normal) or 'holo' (Holofoil). */
  finish: 'normal' | 'holo';
  productId: number;
  /** TCGdex id of the card this one reprints; its text, types and fingerprint are copied. */
  reprints: string;
}

export interface SupplementSet {
  /** The id TCGdex is expected to use. A different one is handled by import.ts's rename step. */
  tcgdexId: string;
  /** TCGdex series id. The series must already exist: TCGdex created it with the earlier sets. */
  series: string;
  name: string;
  releasedOn: string;
  official: number;
  tcgplayerGroupId: number;
  rarity: string;
  cards: SupplementCard[];
}

/**
 * McDonald's Promos 2026 (TCGplayer group 24938, released 2026-11-06). Each `reprints` was matched
 * on name, HP, stage and attack names against TCGdex on 2026-11-27. TCGplayer differs from the
 * reprinted card in three attack names (Chandelure "Combustion Burning" for Combustion Chain,
 * Lucario "Vengeful Knuckles" for Avenging Knuckle, Metagross "Lustrous Blast" for Luster Blast)
 * and lists no Ability on Hawlucha (sv01-118 has Flying Entry). The reprinted card's text is used,
 * and the printed cards carry it (checked 2026-11-27).
 * The holo split (002 003 004 005 006 008 012) matches TCGplayer's prices and a published checklist.
 */
export const MCDONALDS_2026: SupplementSet = {
  tcgdexId: '2026me',
  series: 'mc',
  name: "McDonald's Collection 2026",
  releasedOn: '2026-11-06',
  official: 15,
  tcgplayerGroupId: 24938,
  rarity: 'Promo',
  cards: [
    { localId: '1', name: 'Decidueye', hp: 150, finish: 'normal', productId: 730416, reprints: 'sv06.5-005' },
    { localId: '2', name: 'Chandelure', hp: 150, finish: 'holo', productId: 730417, reprints: 'sv03-038' },
    { localId: '3', name: 'Palafin', hp: 150, finish: 'holo', productId: 730418, reprints: 'sv03-062' },
    { localId: '4', name: 'Pikachu', hp: 70, finish: 'holo', productId: 730419, reprints: 'sv05-051' },
    { localId: '5', name: 'Mimikyu', hp: 70, finish: 'holo', productId: 730420, reprints: 'me02-042' },
    { localId: '6', name: 'Lucario', hp: 130, finish: 'holo', productId: 730421, reprints: 'sv01-114' },
    { localId: '7', name: 'Hawlucha', hp: 70, finish: 'normal', productId: 730422, reprints: 'sv01-118' },
    { localId: '8', name: 'Tyranitar', hp: 180, finish: 'holo', productId: 730423, reprints: 'sv02-135' },
    { localId: '9', name: 'Absol', hp: 110, finish: 'normal', productId: 730424, reprints: 'sv06.5-030' },
    { localId: '10', name: 'Zoroark', hp: 120, finish: 'normal', productId: 730426, reprints: 'sv10.5w-062' },
    { localId: '11', name: 'Metagross', hp: 180, finish: 'normal', productId: 730427, reprints: 'sv05-115' },
    { localId: '12', name: 'Jirachi', hp: 80, finish: 'holo', productId: 730429, reprints: 'sv07-098' },
    { localId: '13', name: 'Eevee', hp: 70, finish: 'normal', productId: 730430, reprints: 'sv06.5-050' },
    { localId: '14', name: 'Snorlax', hp: 160, finish: 'normal', productId: 730431, reprints: 'sv06-136' },
    { localId: '15', name: 'Wooloo', hp: 70, finish: 'normal', productId: 730432, reprints: 'sv07-124' },
  ],
};

export const SUPPLEMENT_SETS: SupplementSet[] = [MCDONALDS_2026];

const LANG = 'en';

export type SupplementStatus = 'filled' | 'unchanged' | 'superseded' | 'no-series';
export type SupplementRefusal = 'no-source' | 'source-differs';

export interface SupplementSetResult {
  tcgdexId: string;
  status: SupplementStatus;
  /** Why nothing was written, for 'superseded': the set TCGdex now owns. */
  supersededBy?: string;
  setCreated: boolean;
  cardsAdded: number;
  variantsAdded: number;
  refused: { localId: string; reprints: string; reason: SupplementRefusal }[];
}

export interface SupplementResult {
  dryRun: boolean;
  sets: SupplementSetResult[];
  recomputedProgressRows: number;
}

interface SourceRow { id: string; tcgdex_id: string; name: string; hp: number | null }

/** The card columns copied from the reprinted card. Everything else is the new printing's own. */
const COPIED = [
  'name', 'name_normalized', 'category', 'hp', 'stage', 'suffix', 'evolve_from', 'trainer_type',
  'energy_type', 'retreat', 'effect', 'regulation_mark', 'is_ace_spec', 'is_radiant',
  'is_prism_star', 'has_rule_box', 'playable_fingerprint',
] as const;

/**
 * Child rows that are facts about the card's text, copied from the reprinted card. Not copied:
 * image-derived rows (phash, embedding), which belong to this printing's own art, and anything a
 * user owns. Hard-coded table and column names; nothing here comes from input.
 */
const CHILDREN: { table: string; cols: string }[] = [
  { table: 'card_type', cols: 'slot, type' },
  { table: 'card_subtype', cols: 'ord, subtype' },
  { table: 'card_tag', cols: 'ord, tag' },
  { table: 'card_attack', cols: 'ord, name, damage, effect, cost' },
  { table: 'card_ability', cols: 'ord, kind, name, effect' },
  { table: 'card_matchup', cols: 'kind, ord, type, value' },
  { table: 'card_species', cols: 'dex_id, ord, source' },
  { table: 'card_text', cols: 'normalizer_version, body, tokens' },
];

async function fillOne(
  client: Queryable, def: SupplementSet, dryRun: boolean,
): Promise<{ result: SupplementSetResult; setId: number | null }> {
  const result: SupplementSetResult = {
    tcgdexId: def.tcgdexId, status: 'unchanged', setCreated: false, cardsAdded: 0, variantsAdded: 0, refused: [],
  };
  const { rows: seriesRows } = await client.query<{ id: string }>(
    `SELECT id FROM series WHERE catalogue_code = $1 AND tcgdex_id = $2`, [LANG, def.series],
  );
  if (!seriesRows[0]) return { result: { ...result, status: 'no-series' }, setId: null };
  const seriesId = Number(seriesRows[0].id);
  const slug = slugify(def.name);

  // Has TCGdex published it? Any set in the series under another id with our name or our TCGplayer
  // group (the link pass assigns groups to sets by name, so a renamed TCGdex set gets it too), or a
  // printing TCGdex wrote into ours.
  const { rows: held } = await client.query<{ id: string; tcgdex_id: string; tcgdex_rows: boolean }>(
    `SELECT s.id, s.tcgdex_id,
            EXISTS (SELECT 1 FROM card c JOIN card_variant cv ON cv.card_id = c.id
                     WHERE c.set_id = s.id AND cv.source = 'tcgdex') AS tcgdex_rows
       FROM card_set s
      WHERE s.series_id = $1 AND (s.tcgdex_id = $2 OR s.slug = $3 OR s.tcgplayer_group_id = $4)`,
    [seriesId, def.tcgdexId, slug, def.tcgplayerGroupId],
  );
  const owner = held.find((h) => h.tcgdex_id !== def.tcgdexId || h.tcgdex_rows);
  if (owner) return { result: { ...result, status: 'superseded', supersededBy: owner.tcgdex_id }, setId: Number(owner.id) };
  let setId = held[0] ? Number(held[0].id) : null;

  const { rows: sources } = await client.query<SourceRow>(
    `SELECT id, tcgdex_id, name, hp FROM card WHERE lang = $1 AND tcgdex_id = ANY($2::text[])`,
    [LANG, def.cards.map((c) => c.reprints)],
  );
  const sourceById = new Map(sources.map((s) => [s.tcgdex_id, s]));
  const { rows: present } = setId == null ? { rows: [] as { local_id: string; variants: number }[] } : await client.query<{ local_id: string; variants: number }>(
    `SELECT c.local_id, (SELECT count(*) FROM card_variant cv WHERE cv.card_id = c.id)::int AS variants
       FROM card c WHERE c.set_id = $1 AND c.lang = $2`,
    [setId, LANG],
  );
  const presentByLocal = new Map(present.map((p) => [p.local_id, p.variants]));

  const toCopy: { card: SupplementCard; source: SourceRow }[] = [];
  const needVariant: SupplementCard[] = [];
  for (const card of def.cards) {
    const had = presentByLocal.get(card.localId);
    if (had != null) {
      if (had === 0) needVariant.push(card);
      continue;
    }
    const source = sourceById.get(card.reprints);
    if (!source) { result.refused.push({ localId: card.localId, reprints: card.reprints, reason: 'no-source' }); continue; }
    if (source.name !== card.name || (card.hp != null && source.hp != null && Number(source.hp) !== card.hp)) {
      result.refused.push({ localId: card.localId, reprints: card.reprints, reason: 'source-differs' });
      continue;
    }
    toCopy.push({ card, source });
    needVariant.push(card);
  }
  result.setCreated = setId == null && toCopy.length > 0;
  result.cardsAdded = toCopy.length;
  result.variantsAdded = needVariant.length;
  if (toCopy.length === 0 && needVariant.length === 0) return { result, setId };
  result.status = 'filled';
  if (dryRun) return { result, setId };

  await client.query('BEGIN');
  try {
    if (setId == null) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO card_set (series_id, tcgdex_id, slug, name, released_on, card_count_official,
                               card_count_total, tcgplayer_group_id, is_promo)
         VALUES ($1, $2, $3, $4, $5::date, $6, $6, $7, false)
         RETURNING id`,
        [seriesId, def.tcgdexId, slug, def.name, def.releasedOn, def.official, def.tcgplayerGroupId],
      );
      setId = Number(rows[0]!.id);
    }
    for (const { card, source } of toCopy) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO card (set_id, tcgdex_id, lang, local_id, local_id_numeric, number_sort, rarity,
                           legal_standard, legal_expanded, released_on, ${COPIED.join(', ')})
         SELECT $1, $2, $3, $4, $5, $6, $7, false, false, $8::date, ${COPIED.join(', ')}
           FROM card WHERE id = $9
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [setId, `${def.tcgdexId}-${card.localId}`, LANG, card.localId, localIdNumeric(card.localId),
          numberSort(card.localId), def.rarity, def.releasedOn, source.id],
      );
      if (!rows[0]) throw new Error(`${def.tcgdexId}-${card.localId}: a card already holds this id or number`);
      const cardId = rows[0].id;
      for (const { table, cols } of CHILDREN) {
        await client.query(
          `INSERT INTO ${table} (card_id, ${cols}) SELECT $1, ${cols} FROM ${table} WHERE card_id = $2`,
          [cardId, source.id],
        );
      }
    }
    for (const card of needVariant) {
      await client.query(
        `INSERT INTO card_variant (card_id, variant_kind_code, sort_order, is_primary, is_synthesized,
                                   tcgplayer_product_id, tcgplayer_printing, id_source, id_confidence,
                                   display_name, source)
         SELECT c.id, $3, 0, true, false, $4, $5, 'variant', 100, $6, 'tcgcsv'
           FROM card c WHERE c.set_id = $1 AND c.local_id = $2 AND c.lang = $7
         ON CONFLICT (card_id, variant_kind_code) DO NOTHING`,
        [setId, card.localId, card.finish, card.productId, tcgplayerPrinting(card.finish), FINISH_LABEL[card.finish], LANG],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* nothing open */ }
    throw err;
  }
  return { result, setId };
}

/** Write every set in `sets` that TCGdex has not published. `dryRun` reports and writes nothing. */
export async function fillSupplementSets(
  client: Queryable, opts: { dryRun?: boolean; sets?: SupplementSet[] } = {},
): Promise<SupplementResult> {
  const dryRun = opts.dryRun ?? false;
  const out: SupplementResult = { dryRun, sets: [], recomputedProgressRows: 0 };
  const touched: number[] = [];
  for (const def of opts.sets ?? SUPPLEMENT_SETS) {
    const { result, setId } = await fillOne(client, def, dryRun);
    out.sets.push(result);
    if (!dryRun && result.status === 'filled' && setId != null) touched.push(setId);
  }
  if (touched.length) out.recomputedProgressRows = await recomputeCoverage(client, touched);
  return out;
}
