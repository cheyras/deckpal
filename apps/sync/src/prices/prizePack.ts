// Play! Pokémon Prize Pack printings, from TCGplayer's "Prize Pack Series Cards" group.
//
// WHY THIS EXISTS. A Prize Pack card is a reprint of a set card with the Play! Pokémon stamp
// (TCGdex calls the stamp `player-rewards-program`), sometimes also in a cosmos holo. Our printings
// come from TCGdex `variants_detailed`, which lists the stamp for some sets and not at all for
// others: none for sv01, sv02, sv04, sv06, sv06.5, sv07, sv08.5, sv10, sv10.5w, me02 or mee, and
// almost none for Sword & Shield. The owner scanned a stamped Basic Water Energy (mee-003) on
// 2026-11-26 and had no printing to pick (audit that day: about 660 printings on about 580 cards).
// TCGplayer lists every one of them in ONE group, 22880, which TCGCSV publishes daily for free.
//
// WHAT IT WRITES. A stamped printing is a VARIANT of the card it reprints, never a card of its
// own: it carries the original set code and collector number, so the scanner's (set, number)
// lookup, ownership and deck matching all already treat it as that card. Each row is
// `source='tcgcsv'`, `tcgdex_variant_id=NULL`, kind `<finish>[-foil-cosmos]-stamp-player-rewards-
// program`, the same kind codes TCGdex uses where it does list them. A stamped kind derives tier
// `special` (transform.ts `tierDerived`), so it never adds a check mark on a card tile and never
// raises a Master Set denominator: it is one of the "more printings" in card detail.
//
// WHAT COUNTS AS A MATCH. Collector number AND printed set size AND card name must agree on
// exactly one card ("Nest Ball - 181/198" is sv01-181 and nothing else). A number without a set
// size ("Basic Water Energy - MEE 003", "Ampharos ex - 016") is looked up in the promo and energy
// sets that print numbers that way. Anything else is refused and reported: a printing left out is
// an honest gap, a printing on the wrong card is a lie someone would collect against.
//
// IT NEVER OVERWRITES. A card that already has a stamped printing of the same kind keeps it (and
// gains only a product id if it had none). Inserts are ON CONFLICT DO NOTHING. If TCGdex later
// lists one of these printings, the catalog import's (card_id, variant_kind_code) upsert takes the
// row over in place, so anything a user owns stays attached. The import never deletes a row it
// does not publish; it only moves it after the printings it does (import.ts, PARK_BASE).
//
// PRICES. The daily walk prices each set from its own TCGplayer group, and no set's group holds
// these products, so every stamped printing was unpriced, including the ones TCGdex already
// listed. tcgcsv.ts `writeProductGroupPrices` prices group 22880 by product id across every set.
//
// B8: idempotent, one transaction, one connection. B9: catalog variant rows and their price links.

import { fetchJson } from './http.js';
import type { Queryable } from './db.js';
import type {
  TcgcsvPriceEnvelope, TcgcsvPriceRow, TcgcsvProductEnvelope, TcgcsvProductRow,
} from './types.js';
import { foldName, numberKey, productNumberKey } from './linkMatch.js';
import { recomputeCoverage } from './coverage.js';
import {
  displayName, kindDisplayName, printRunCode, stampLabel, tierDerived, variantKindCode,
  TIER_RULE_VERSION, type Facet,
} from '../catalog/transform.js';

const BASE = 'https://tcgcsv.com/tcgplayer/3';
/** TCGplayer's "Prize Pack Series Cards" group. */
export const PRIZE_PACK_GROUP = 22880;
/** TCGdex's code for the Play! Pokémon stamp. */
export const PRIZE_PACK_STAMP = 'player-rewards-program';
/** The eras Prize Packs exist in (series.tcgdex_id). The program began in Sword & Shield. */
export const PRIZE_PACK_SERIES = ['swsh', 'sv', 'me'];
/** Sets whose cards TCGplayer numbers with no set size ("- 016", "- MEE 003", "- SWSH149"). */
const UNSIZED_NUMBER_SETS = ['sve', 'svp', 'mep'];
/** A set code TCGplayer writes in front of an unsized number, and the set it names. */
const NUMBER_PREFIX_SET: Readonly<Record<string, string>> = {
  mee: 'mee', sve: 'sve', svp: 'svp', mep: 'mep', swsh: 'swshp',
};
export const PRIZE_PACK_PROVENANCE = 'Found in Play! Pokémon Prize Packs';

// ── inputs ────────────────────────────────────────────────────────────────────────────────────

export interface PpSet { setId: number; tcgdexId: string; official: number | null }
export interface PpVariant {
  id: number; kind: string; finish: string; foil: string | null; stamps: string[];
  isPrimary: boolean; productId: number | null; printing: string | null; sortOrder: number;
}
export interface PpCard { cardId: number; setId: number; localId: string; name: string; variants: PpVariant[] }

// ── outputs ───────────────────────────────────────────────────────────────────────────────────

export type PpSkipReason =
  | 'no-number'          // sealed product, code card, or an unnumbered series energy
  | 'no-card'            // nothing in the catalog has this number, set size and name
  | 'ambiguous'          // more than one card does
  | 'unknown-qualifier'  // a "(…)" we do not know the meaning of
  | 'unknown-printing';  // a TCGplayer printing name that is not a finish we model

export interface PpAdd {
  cardId: number; setId: number; facet: Facet; code: string;
  productId: number; printing: string; url: string | null;
  displayName: string; sortOrder: number;
  /** 100 when TCGplayer prices this printing; 80 when the finish came from the card itself. */
  confidence: number;
}
export interface PpLink { variantId: number; cardId: number; productId: number; printing: string }
export interface PpPlan {
  adds: PpAdd[];
  links: PpLink[];
  /** Printings the card already has (from TCGdex, or an earlier run). */
  covered: number;
  /** Extra products for a printing already planned (Series 6 and 7 of one card; left/right stamp). */
  collapsed: number;
  skipped: { productId: number; name: string; reason: PpSkipReason }[];
}

// ── product parsing ───────────────────────────────────────────────────────────────────────────

const COSMOS = /^cosmos holo(foil)?$/i;
/** Qualifiers that name the same physical printing (which series it came in, where the stamp sits). */
const SAME_PRINTING = /^(prize pack series \d+|series \d+|left stamp|right stamp)$/i;

export interface ParsedProduct {
  key: string;
  cosmos: boolean;
  /** Numerator as `numberKey` writes it ("181", "SWSH149", "TG5"); null when unnumbered. */
  number: string | null;
  /** The printed set size ("181/198" → 198), or null when TCGplayer prints none. */
  setSize: number | null;
  /** Set code written before an unsized number ("- MEE 003" → "mee"). */
  prefix: string | null;
  unknownQualifier: string | null;
}

/** Card name to comparison key: `foldName`, and "Basic Water Energy" ≡ "Water Energy". */
export function ppNameKey(name: string): string {
  return foldName(name).replace(/^basic /, '');
}

export function parseProduct(p: TcgcsvProductRow): ParsedProduct {
  let unknownQualifier: string | null = null;
  let cosmos = false;
  // "[Lysandre]" names the trainer art on Boss's Orders / Professor's Research: the number pins it.
  let n = p.name.replace(/\s*\[[^\]]*\]/g, '');
  n = n.replace(/\s*\(([^)]*)\)/g, (_m, q: string) => {
    const t = q.trim();
    if (COSMOS.test(t)) cosmos = true;
    else if (!SAME_PRINTING.test(t)) unknownQualifier ??= t;
    return '';
  });
  // "Basic Water Energy - MEE 003": the set code sits between the dash and the number.
  const tail = /\s+-\s+(.*)$/.exec(n);
  const prefixMatch = tail ? /^([A-Za-z]+)\s+\d+$/.exec(tail[1]!.trim()) : null;
  const key = ppNameKey(n.replace(/\s+-\s+.*$/, ''));

  const raw = p.extendedData?.find((e) => e.name === 'Number')?.value?.trim() ?? '';
  let number: string | null = null;
  let setSize: number | null = null;
  let prefix: string | null = prefixMatch ? prefixMatch[1]!.toLowerCase() : null;
  const sized = /^([A-Za-z]*\d+[A-Za-z]?)\s*\/\s*[A-Za-z]*(\d+)$/.exec(raw);
  if (sized) {
    number = numberKey(sized[1]!);
    setSize = parseInt(sized[2]!, 10);
  } else if (raw) {
    number = productNumberKey(p);
    const lettered = /^([A-Za-z]+)\s*\d+$/.exec(raw);
    if (lettered) prefix ??= lettered[1]!.toLowerCase();
  }
  return { key, cosmos, number, setSize, prefix, unknownQualifier };
}

// ── planning (pure) ───────────────────────────────────────────────────────────────────────────

const FINISH_BY_PRINTING: Readonly<Record<string, string>> = {
  Normal: 'normal', Holofoil: 'holo', 'Reverse Holofoil': 'reverse',
};
const PRINTING_BY_FINISH: Readonly<Record<string, string>> = {
  normal: 'Normal', holo: 'Holofoil', reverse: 'Reverse Holofoil',
};

export function stampedFacet(finish: string, cosmos: boolean): Facet {
  return { finish, subtype: null, size: 'standard', foil: cosmos ? 'cosmos' : null, stamps: [PRIZE_PACK_STAMP] };
}

/**
 * The card's own stamped printing that already stands for this one. Cosmos is matched on the
 * foil alone, because TCGdex files cosmos stamps under both holo and reverse for the same kind of
 * card (40 holo, 17 reverse in the 2026-11-26 audit) and TCGplayer sells both as one printing.
 */
function existingPrinting(card: PpCard, facet: Facet): PpVariant | undefined {
  const stamped = card.variants.filter((v) => v.stamps.includes(PRIZE_PACK_STAMP));
  if (facet.foil === 'cosmos') return stamped.find((v) => v.foil === 'cosmos');
  return stamped.find((v) => v.foil !== 'cosmos' && v.finish === facet.finish);
}

export function planPrizePack(
  products: TcgcsvProductRow[], prices: TcgcsvPriceRow[], sets: PpSet[], cards: PpCard[],
): PpPlan {
  const plan: PpPlan = { adds: [], links: [], covered: 0, collapsed: 0, skipped: [] };
  const setById = new Map(sets.map((s) => [s.setId, s]));
  // (number key, name key) → cards, the one index both lookups share.
  const index = new Map<string, PpCard[]>();
  for (const c of cards) {
    const k = `${numberKey(c.localId)}|${ppNameKey(c.name)}`;
    (index.get(k) ?? index.set(k, []).get(k)!).push(c);
  }
  const printingsOf = new Map<number, string[]>();
  for (const r of prices) {
    if (!r.subTypeName) continue;
    (printingsOf.get(r.productId) ?? printingsOf.set(r.productId, []).get(r.productId)!).push(r.subTypeName);
  }
  const nextSort = new Map<number, number>();
  const sortFor = (card: PpCard): number => {
    const n = nextSort.get(card.cardId) ?? Math.max(-1, ...card.variants.map((v) => v.sortOrder)) + 1;
    nextSort.set(card.cardId, n + 1);
    return n;
  };
  // One row per (card, kind), from the lowest product id that names it, so a re-run is stable.
  const planned = new Map<string, PpAdd | PpLink | 'covered'>();
  const skip = (p: TcgcsvProductRow, reason: PpSkipReason) => plan.skipped.push({ productId: p.productId, name: p.name, reason });

  for (const p of [...products].sort((a, b) => a.productId - b.productId)) {
    const parsed = parseProduct(p);
    if (parsed.unknownQualifier) { skip(p, 'unknown-qualifier'); continue; }
    if (!parsed.number) { skip(p, 'no-number'); continue; }

    const hits = (index.get(`${parsed.number}|${parsed.key}`) ?? []).filter((c) => {
      const s = setById.get(c.setId);
      if (!s) return false;
      if (parsed.setSize != null) return s.official === parsed.setSize;
      if (parsed.prefix) return NUMBER_PREFIX_SET[parsed.prefix] === s.tcgdexId;
      return UNSIZED_NUMBER_SETS.includes(s.tcgdexId);
    });
    if (hits.length === 0) { skip(p, 'no-card'); continue; }
    if (hits.length > 1) { skip(p, 'ambiguous'); continue; }
    const card = hits[0]!;

    // Each printing TCGplayer prices is one printing of the card. A product nobody has priced yet
    // takes the finish of the card's own primary printing (a stamped V is a holo, a stamped Nest
    // Ball is not), at a lower confidence.
    let printings = printingsOf.get(p.productId) ?? [];
    let confidence = 100;
    if (printings.length === 0) {
      const base = card.variants.find((v) => v.isPrimary)?.finish ?? 'normal';
      printings = [PRINTING_BY_FINISH[parsed.cosmos ? 'holo' : base] ?? 'Normal'];
      confidence = 80;
    }
    for (const printing of printings) {
      const finish = FINISH_BY_PRINTING[printing];
      if (!finish) { skip(p, 'unknown-printing'); continue; }
      const facet = stampedFacet(finish, parsed.cosmos);
      const code = variantKindCode(facet);
      const slot = `${card.cardId}|${parsed.cosmos ? 'cosmos' : code}`;
      if (planned.has(slot)) { plan.collapsed++; continue; }
      const have = existingPrinting(card, facet);
      if (have) {
        plan.covered++;
        if (have.productId == null) {
          const link: PpLink = { variantId: have.id, cardId: card.cardId, productId: p.productId, printing };
          plan.links.push(link);
          planned.set(slot, link);
        } else planned.set(slot, 'covered');
        continue;
      }
      const add: PpAdd = {
        cardId: card.cardId, setId: card.setId, facet, code, productId: p.productId, printing,
        url: p.url ?? null, displayName: displayName(facet, [facet]), sortOrder: sortFor(card), confidence,
      };
      plan.adds.push(add);
      planned.set(slot, add);
    }
  }
  return plan;
}

// ── database + network ────────────────────────────────────────────────────────────────────────

export interface PrizePackData { products: TcgcsvProductRow[]; prices: TcgcsvPriceRow[] }

export async function fetchPrizePackData(): Promise<PrizePackData> {
  const p = await fetchJson<TcgcsvProductEnvelope>(`${BASE}/${PRIZE_PACK_GROUP}/products`);
  const pr = await fetchJson<TcgcsvPriceEnvelope>(`${BASE}/${PRIZE_PACK_GROUP}/prices`);
  if (!p.success) throw new Error(`TCGCSV products ${PRIZE_PACK_GROUP}: ${p.errors.join('; ') || 'success=false'}`);
  if (!pr.success) throw new Error(`TCGCSV prices ${PRIZE_PACK_GROUP}: ${pr.errors.join('; ') || 'success=false'}`);
  return { products: p.results, prices: pr.results };
}

export async function loadPrizePackCatalog(client: Queryable): Promise<{ sets: PpSet[]; cards: PpCard[] }> {
  const { rows: setRows } = await client.query<{ id: string; tcgdex_id: string; official: number | null }>(
    `SELECT s.id, s.tcgdex_id, s.card_count_official AS official
       FROM card_set s JOIN series se ON se.id = s.series_id
      WHERE se.catalogue_code = 'en' AND se.tcgdex_id = ANY($1::text[])`,
    [PRIZE_PACK_SERIES],
  );
  const sets = setRows.map((r) => ({ setId: Number(r.id), tcgdexId: r.tcgdex_id, official: r.official == null ? null : Number(r.official) }));
  if (sets.length === 0) return { sets, cards: [] };
  const { rows } = await client.query<{
    card_id: string; set_id: string; local_id: string; name: string;
    vid: string; kind: string; finish: string; foil: string | null; stamps: string[];
    is_primary: boolean; pid: number | null; printing: string | null; sort_order: number;
  }>(
    `SELECT c.id AS card_id, c.set_id, c.local_id, c.name,
            cv.id AS vid, cv.variant_kind_code AS kind, vk.finish, vk.foil,
            COALESCE(array_agg(vks.stamp_code) FILTER (WHERE vks.stamp_code IS NOT NULL), '{}') AS stamps,
            cv.is_primary, cv.tcgplayer_product_id AS pid, cv.tcgplayer_printing AS printing, cv.sort_order
       FROM card c
       JOIN card_variant cv ON cv.card_id = c.id
       JOIN variant_kind vk ON vk.code = cv.variant_kind_code
       LEFT JOIN variant_kind_stamp vks ON vks.variant_kind_code = vk.code
      WHERE c.set_id = ANY($1::bigint[])
      GROUP BY c.id, cv.id, vk.finish, vk.foil`,
    [sets.map((s) => s.setId)],
  );
  const byCard = new Map<number, PpCard>();
  for (const r of rows) {
    const id = Number(r.card_id);
    let c = byCard.get(id);
    if (!c) { c = { cardId: id, setId: Number(r.set_id), localId: r.local_id, name: r.name, variants: [] }; byCard.set(id, c); }
    c.variants.push({
      id: Number(r.vid), kind: r.kind, finish: r.finish, foil: r.foil, stamps: r.stamps,
      isPrimary: r.is_primary, productId: r.pid == null ? null : Number(r.pid), printing: r.printing,
      sortOrder: Number(r.sort_order),
    });
  }
  return { sets, cards: [...byCard.values()] };
}

export interface PrizePackResult {
  dryRun: boolean;
  products: number;
  /** New stamped printings (a dry run reports what it would add). */
  added: number;
  /** Stamped printings the catalog had with no TCGplayer product, now linked. */
  linked: number;
  covered: number;
  collapsed: number;
  skipped: Partial<Record<PpSkipReason, number>>;
  /** Added printings per TCGdex set id, so a dry run reads as a list. */
  addedBySet: Record<string, number>;
  recomputedProgressRows: number;
  plan?: PpPlan;
}

export interface PrizePackOpts {
  dryRun?: boolean;
  /** Test seam: replaces the network read. */
  loadData?: () => Promise<PrizePackData>;
  /** Hand the full plan back (the CLI's dry run prints it). */
  includePlan?: boolean;
}

export async function fillPrizePack(client: Queryable, opts: PrizePackOpts = {}): Promise<PrizePackResult> {
  const data = await (opts.loadData ?? fetchPrizePackData)();
  const { sets, cards } = await loadPrizePackCatalog(client);
  const plan = planPrizePack(data.products, data.prices, sets, cards);
  const code = new Map(sets.map((s) => [s.setId, s.tcgdexId]));
  const addedBySet: Record<string, number> = {};
  for (const a of plan.adds) { const k = code.get(a.setId) ?? String(a.setId); addedBySet[k] = (addedBySet[k] ?? 0) + 1; }
  const skipped: Partial<Record<PpSkipReason, number>> = {};
  for (const s of plan.skipped) skipped[s.reason] = (skipped[s.reason] ?? 0) + 1;
  const result: PrizePackResult = {
    dryRun: !!opts.dryRun, products: data.products.length, added: plan.adds.length, linked: plan.links.length,
    covered: plan.covered, collapsed: plan.collapsed, skipped, addedBySet, recomputedProgressRows: 0,
    ...(opts.includePlan ? { plan } : {}),
  };
  if (opts.dryRun || (plan.adds.length === 0 && plan.links.length === 0)) return result;

  let added = 0;
  let linked = 0;
  await client.query('BEGIN');
  try {
    if (plan.adds.length) {
      // The vocabulary rows the new kinds point at. The catalog import seeds these for kinds TCGdex
      // uses; a kind only TCGplayer has (a stamped holo on a set TCGdex never stamped) needs them
      // here first. DO NOTHING throughout: TCGdex's own labels and the derived tier win.
      const kinds = new Map(plan.adds.map((a) => [a.code, a.facet]));
      await client.query(
        `INSERT INTO variant_stamp (code, label) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING`,
        [PRIZE_PACK_STAMP, stampLabel(PRIZE_PACK_STAMP).replace(/ Stamp$/, '')],
      );
      const ks = [...kinds.entries()];
      await client.query(
        `INSERT INTO variant_kind
           (code, display_name, finish, print_subtype, size, foil, print_run_code, tier_derived, tier_rule_version)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::smallint[])
         ON CONFLICT (code) DO NOTHING`,
        [
          ks.map(([c]) => c), ks.map(([, f]) => kindDisplayName(f)), ks.map(([, f]) => f.finish),
          ks.map(() => null), ks.map(([, f]) => f.size), ks.map(([, f]) => f.foil),
          ks.map(([, f]) => printRunCode(f)), ks.map(([, f]) => tierDerived(f)), ks.map(() => TIER_RULE_VERSION),
        ],
      );
      await client.query(
        `INSERT INTO variant_kind_stamp (variant_kind_code, stamp_code)
         SELECT code, $2::text FROM unnest($1::text[]) AS code ON CONFLICT DO NOTHING`,
        [ks.map(([c]) => c), PRIZE_PACK_STAMP],
      );
      for (let i = 0; i < plan.adds.length; i += 200) {
        const batch = plan.adds.slice(i, i + 200);
        const ins = await client.query(
          `INSERT INTO card_variant
             (card_id, variant_kind_code, sort_order, is_primary, is_synthesized,
              tcgplayer_product_id, tcgplayer_printing, tcgplayer_url, id_source, id_confidence,
              display_name, provenance, fill_confidence, tcgdex_variant_id, source)
           SELECT card_id, code, sort, false, false, pid, printing, url, 'number_match', conf,
                  dn, $9::text, conf, NULL, 'tcgcsv'
             FROM unnest($1::bigint[], $2::text[], $3::smallint[], $4::int[], $5::text[], $6::text[], $7::smallint[], $8::text[])
                  AS v(card_id, code, sort, pid, printing, url, conf, dn)
           ON CONFLICT (card_id, variant_kind_code) DO NOTHING
           RETURNING id`,
          [
            batch.map((a) => a.cardId), batch.map((a) => a.code), batch.map((a) => a.sortOrder),
            batch.map((a) => a.productId), batch.map((a) => a.printing), batch.map((a) => a.url),
            batch.map((a) => a.confidence), batch.map((a) => a.displayName), PRIZE_PACK_PROVENANCE,
          ],
        );
        added += ins.rows.length;
      }
    }
    if (plan.links.length) {
      const upd = await client.query(
        `UPDATE card_variant cv
            SET tcgplayer_product_id = v.pid,
                tcgplayer_printing   = v.printing,
                id_source            = CASE WHEN cv.id_source = 'none' THEN 'number_match' ELSE cv.id_source END,
                id_confidence        = CASE WHEN cv.id_source = 'none' THEN 100 ELSE cv.id_confidence END,
                last_synced_at       = now()
           FROM unnest($1::bigint[], $2::int[], $3::text[]) AS v(id, pid, printing)
          WHERE cv.id = v.id AND cv.tcgplayer_product_id IS NULL
      RETURNING cv.id`,
        [plan.links.map((l) => l.variantId), plan.links.map((l) => l.productId), plan.links.map((l) => l.printing)],
      );
      linked = upd.rows.length;
    }
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* the original error is the one that matters */ }
    throw err;
  }
  result.added = added;
  result.linked = linked;
  // Grandmaster counts every printing, so a set that gained one needs its denominators redone.
  if (added > 0) {
    result.recomputedProgressRows = await recomputeCoverage(client, [...new Set(plan.adds.map((a) => a.setId))]);
  }
  return result;
}
