// TCGCSV link pass: fill `card_set.tcgplayer_group_id` and `card_variant.tcgplayer_product_id`
// where TCGdex had nothing, so those cards can be priced at all. The matching rules (and why they
// are as conservative as they are) live in linkMatch.ts; this file is the database + network half.
//
// ORDER MATTERS. This runs BEFORE the price walk in `ingestTcgcsvPrices`, because the walk starts
// from "sets that carry a groupId" and joins rows to variants that carry a productId — a link
// written after it would only price the card tomorrow.
//
// IT IS REPAIR, NOT A SOURCE OF TRUTH. The catalog importer writes these columns from TCGdex with
// `ON CONFLICT … SET tcgplayer_product_id = EXCLUDED…` on purpose (no COALESCE: a stale id must not
// outlive its upstream — see releasePriceLinks.ts), so every catalog refresh resets our links to
// whatever TCGdex says, which for the affected cards is NULL. The next price run puts them back.
// Nothing is lost in between: `price_current` is keyed by variant id and is not touched by an import.
//
// IT NEVER OVERWRITES what it derives. Every UPDATE of a derived link is guarded by `… IS NULL`:
// an id TCGdex (or the release overlay) supplied is authoritative, and a link this pass wrote is
// simply re-derived next time. It deliberately does NOT write `tcgplayer_url`: the API prefers a
// stored URL over the product id (apps/api/src/db.ts `tcgplayerUrl`), and the importer never resets
// that column, so a stored URL would outlive the link it was derived from and keep sending buyers to
// the old product.
//
// THE ONE EXCEPTION is the hand-verified override table (catalog/priceLinkOverrides.ts): printings
// whose TCGdex id is wrong, or whose right product the rules above must refuse in general. Those are
// written first, over whatever is there, by the same identity check the importer applies, and their
// stored URL is cleared so the buy link follows the corrected product. The planner then sees them as
// taken. The importer writes the same values, so neither undoes the other.
//
// B8: idempotent, one transaction per set, 1 connection. B9: touches catalog price-link columns only.

import { fetchJson, RateLimited } from './http.js';
import type { Queryable } from './db.js';
import type {
  TcgcsvPriceEnvelope, TcgcsvPriceRow, TcgcsvProductEnvelope, TcgcsvProductRow,
} from './types.js';
import {
  KNOWN_SET_GROUPS, acceptGroup, candidateGroups, planSetLinks,
  type GroupRef, type GroupScore, type LinkCard, type PlanResult, type SkipReason,
} from './linkMatch.js';
import { OVERRIDES, checkOverride, overrideCardIds, type OverrideIndex } from '../catalog/priceLinkOverrides.js';

const BASE = 'https://tcgcsv.com/tcgplayer/3';

interface GroupEnvelope {
  success: boolean; errors: string[];
  results: { groupId: number; name: string; abbreviation?: string | null }[];
}

export async function fetchGroups(): Promise<GroupRef[]> {
  const env = await fetchJson<GroupEnvelope>(`${BASE}/groups`);
  if (!env.success) throw new Error(`TCGCSV groups: ${env.errors.join('; ') || 'success=false'}`);
  return env.results.map((g) => ({ groupId: g.groupId, name: g.name, abbreviation: g.abbreviation ?? null }));
}

export interface GroupData { products: TcgcsvProductRow[]; prices: TcgcsvPriceRow[] }

async function fetchGroupData(groupId: number): Promise<GroupData> {
  const p = await fetchJson<TcgcsvProductEnvelope>(`${BASE}/${groupId}/products`);
  const pr = await fetchJson<TcgcsvPriceEnvelope>(`${BASE}/${groupId}/prices`);
  if (!p.success) throw new Error(`TCGCSV products ${groupId}: ${p.errors.join('; ') || 'success=false'}`);
  if (!pr.success) throw new Error(`TCGCSV prices ${groupId}: ${pr.errors.join('; ') || 'success=false'}`);
  return { products: p.results, prices: pr.results };
}

export interface LinkOpts {
  /** TCGdex set ids to restrict to (same meaning as the price ingest's `sets`). */
  sets?: string[] | null;
  /** Plan and report; write nothing. */
  dryRun?: boolean;
  /** Test seams: replace the two network reads. */
  loadGroups?: () => Promise<GroupRef[]>;
  loadGroupData?: (groupId: number) => Promise<GroupData>;
  /** Test seam: the verified override table (default: catalog/priceLinkOverrides.ts). */
  overrides?: OverrideIndex;
}

export interface OverrideRefusal { card: string; kind: string; reason: string }

export interface SetLinkReport {
  set: string;
  group: number | null;
  /** 'assigned' = we chose a group; 'kept' = TCGdex's group was used; the rest are refusals. */
  groupOutcome: 'assigned' | 'kept' | 'no-candidate' | 'weak-agreement' | 'tie';
  linked: number;
  skipped: Partial<Record<SkipReason, number>>;
}

export interface LinkResult {
  dryRun: boolean;
  setsScanned: number;
  groupsAssigned: number;
  /** Rows actually updated (a dry run reports what it would update). */
  variantsLinked: number;
  /** Rows the verified override table changed (a dry run reports what it would change). */
  overridesApplied: number;
  /** Overrides whose card no longer agrees with the pinned identity: upstream kept. */
  overridesRefused: OverrideRefusal[];
  /** Sets we looked at and could not complete, by reason — the honest remainder. */
  unresolvedSets: number;
  /** Sets that ERRORED (network, SQL). One bad set does not stop the others; the caller must fail loudly. */
  failedSets: { set: string; error: string }[];
  perSet: SetLinkReport[];
}

type SetRow = {
  id: string; tcgdex_id: string; name: string; abbreviation: string | null;
  ptcgl_code: string | null; g: number | null;
};

/**
 * Sets that have something to gain: no group at all, or a group but at least one LINKABLE variant
 * (plain, or a 1st-Edition stamp — the kinds `linkablePrintings` knows) still lacking a product.
 * Other stamped / jumbo variants are excluded from the second test — they can never be linked
 * here, and counting them would refetch nearly every set on every run.
 */
export async function setsWithGaps(client: Queryable, filter: string[] | null): Promise<SetRow[]> {
  const { rows } = await client.query<SetRow>(
    `SELECT s.id, s.tcgdex_id, s.name, s.abbreviation, s.ptcgl_code, s.tcgplayer_group_id AS g
       FROM card_set s
      WHERE ($1::text[] IS NULL OR s.tcgdex_id = ANY($1))
        AND (s.tcgplayer_group_id IS NULL OR s.tcgdex_id = ANY($2::text[]) OR EXISTS (
              SELECT 1 FROM card c JOIN card_variant cv ON cv.card_id = c.id
               WHERE c.set_id = s.id
                 AND cv.tcgplayer_product_id IS NULL
                 AND cv.variant_kind_code IN ('normal','holo','reverse',
                                              'normal-stamp-1st-edition','holo-stamp-1st-edition')))
      ORDER BY s.id`,
    [filter, Object.keys(KNOWN_SET_GROUPS)],
  );
  return rows;
}

/** An override's value for one variant row, as it is (or, in a dry run, would be) after the write. */
type OverrideValues = Map<number, { productId: number; printing: string }>;

/**
 * Write the verified override table (catalog/priceLinkOverrides.ts) over whatever the variants
 * carry. Every row is identity-checked exactly as the importer checks it, so an entry whose card
 * TCGdex has since re-keyed or renamed is refused, never forced. A row already holding the override
 * (and no stored URL) is left alone, so a re-run writes nothing (B8). Needs no network: the entries
 * were verified against TCGplayer's record when they were added.
 */
export async function applyLinkOverrides(
  client: Queryable, index: OverrideIndex, filter: string[] | null, dryRun: boolean,
): Promise<{ applied: number; refused: OverrideRefusal[]; values: OverrideValues }> {
  const values: OverrideValues = new Map();
  const refused: OverrideRefusal[] = [];
  const cardIds = overrideCardIds(index);
  if (cardIds.length === 0) return { applied: 0, refused, values };
  const { rows } = await client.query<{
    vid: string; card: string; local_id: string; name: string; set_id: string; kind: string;
    pid: number | null; printing: string | null; url: string | null;
  }>(
    `SELECT cv.id AS vid, c.tcgdex_id AS card, c.local_id, c.name, s.tcgdex_id AS set_id,
            cv.variant_kind_code AS kind, cv.tcgplayer_product_id AS pid,
            cv.tcgplayer_printing AS printing, cv.tcgplayer_url AS url
       FROM card c
       JOIN card_set s ON s.id = c.set_id
       JOIN card_variant cv ON cv.card_id = c.id
      WHERE c.lang = 'en' AND c.tcgdex_id = ANY($1::text[])
        AND ($2::text[] IS NULL OR s.tcgdex_id = ANY($2::text[]))`,
    [cardIds, filter],
  );
  const todo: { id: number; productId: number; printing: string }[] = [];
  for (const r of rows) {
    const check = checkOverride(index, {
      language: 'en', setId: r.set_id, cardId: r.card, localId: r.local_id, name: r.name, kind: r.kind,
    });
    if (!check) continue;
    if (!check.applies) { refused.push({ card: r.card, kind: r.kind, reason: check.refused }); continue; }
    const { productId, printing } = check.override;
    values.set(Number(r.vid), { productId, printing });
    if (r.pid != null && Number(r.pid) === productId && r.printing === printing && r.url == null) continue;
    todo.push({ id: Number(r.vid), productId, printing });
  }
  if (dryRun || todo.length === 0) return { applied: todo.length, refused, values };

  await client.query('BEGIN');
  try {
    const upd = await client.query(
      `UPDATE card_variant cv
          SET tcgplayer_product_id = v.pid,
              tcgplayer_printing   = v.printing,
              tcgplayer_url        = NULL,
              id_source            = 'variant',
              id_confidence        = 100,
              last_synced_at       = now()
         FROM unnest($1::bigint[], $2::int[], $3::text[]) AS v(id, pid, printing)
        WHERE cv.id = v.id
          AND (cv.tcgplayer_product_id IS DISTINCT FROM v.pid
               OR cv.tcgplayer_printing IS DISTINCT FROM v.printing
               OR cv.tcgplayer_url IS NOT NULL)
    RETURNING cv.id`,
      [todo.map((t) => t.id), todo.map((t) => t.productId), todo.map((t) => t.printing)],
    );
    await client.query('COMMIT');
    return { applied: upd.rows.length, refused, values };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* the original error is the one that matters */ }
    throw err;
  }
}

async function loadCards(client: Queryable, setId: number, overridden: OverrideValues): Promise<LinkCard[]> {
  const { rows } = await client.query<{
    card_id: string; local_id: string; name: string;
    vid: string; kind: string; pid: number | null; printing: string | null;
  }>(
    `SELECT c.id AS card_id, c.local_id, c.name,
            cv.id AS vid, cv.variant_kind_code AS kind,
            cv.tcgplayer_product_id AS pid, cv.tcgplayer_printing AS printing
       FROM card c JOIN card_variant cv ON cv.card_id = c.id
      WHERE c.set_id = $1
      ORDER BY c.id, cv.sort_order`,
    [setId],
  );
  const byCard = new Map<number, LinkCard>();
  for (const r of rows) {
    const id = Number(r.card_id);
    let c = byCard.get(id);
    if (!c) { c = { cardId: id, localId: r.local_id, name: r.name, variants: [] }; byCard.set(id, c); }
    // An override is what the row holds after applyLinkOverrides (already, or in a dry run, would),
    // so the planner reserves its (product, printing) and never plans that row itself.
    const o = overridden.get(Number(r.vid));
    c.variants.push(o
      ? { id: Number(r.vid), kind: r.kind, productId: o.productId, printing: o.printing }
      : { id: Number(r.vid), kind: r.kind, productId: r.pid, printing: r.printing });
  }
  return [...byCard.values()];
}

function tally(plan: PlanResult): Partial<Record<SkipReason, number>> {
  const t: Partial<Record<SkipReason, number>> = {};
  for (const s of plan.skipped) t[s.reason] = (t[s.reason] ?? 0) + 1;
  return t;
}

export async function linkTcgcsvProducts(client: Queryable, opts: LinkOpts = {}): Promise<LinkResult> {
  const filter = opts.sets && opts.sets.length ? opts.sets : null;
  const loadGroups = opts.loadGroups ?? fetchGroups;
  const loadGroupData = opts.loadGroupData ?? fetchGroupData;
  // The verified overrides first: they need no network, and the planner must see them as taken.
  const ov = await applyLinkOverrides(client, opts.overrides ?? OVERRIDES, filter, !!opts.dryRun);
  if (ov.refused.length) {
    console.warn(
      `[prices] link pass: ${ov.refused.length} price-link override(s) refused, upstream kept: ` +
        ov.refused.map((r) => `${r.card} ${r.kind} (${r.reason})`).join('; '),
    );
  }
  const sets = await setsWithGaps(client, filter);
  const result: LinkResult = {
    dryRun: !!opts.dryRun, setsScanned: sets.length, groupsAssigned: 0, variantsLinked: 0,
    overridesApplied: ov.applied, overridesRefused: ov.refused,
    unresolvedSets: 0, failedSets: [], perSet: [],
  };
  if (sets.length === 0) return result;

  // The group list is only needed to find a group for a set that has none.
  let groups: GroupRef[] | null = null;
  const cache = new Map<number, GroupData>();
  const data = async (gid: number): Promise<GroupData> => {
    let d = cache.get(gid);
    if (!d) { d = await loadGroupData(gid); cache.set(gid, d); }
    return d;
  };

  const linkOne = async (s: SetRow): Promise<void> => {
    const setId = Number(s.id);
    const cards = await loadCards(client, setId, ov.values);
    let groupId = s.g == null ? null : Number(s.g);
    let outcome: SetLinkReport['groupOutcome'] = 'kept';
    let plan: PlanResult;
    // A hand-matched group wins over none, and over one the name rules picked (linkMatch.ts).
    const known = KNOWN_SET_GROUPS[s.tcgdex_id] ?? null;
    if (known != null && groupId !== known) {
      groupId = known;
      outcome = 'assigned';
    }

    if (groupId != null) {
      const d = await data(groupId);
      plan = planSetLinks(cards, d.products, d.prices);
    } else {
      groups ??= await loadGroups();
      const cands = candidateGroups(
        { tcgdexId: s.tcgdex_id, name: s.name, abbreviation: s.abbreviation, ptcglCode: s.ptcgl_code },
        groups,
      );
      const scores: GroupScore[] = [];
      for (const g of cands) {
        const d = await data(g.groupId);
        scores.push({ groupId: g.groupId, plan: planSetLinks(cards, d.products, d.prices) });
      }
      const verdict = acceptGroup(scores, cards.length);
      if ('rejected' in verdict) {
        result.unresolvedSets++;
        result.perSet.push({ set: s.tcgdex_id, group: null, groupOutcome: verdict.rejected, linked: 0, skipped: {} });
        return;
      }
      groupId = verdict.groupId;
      plan = verdict.plan;
      outcome = 'assigned';
    }

    const links = plan.links;
    let written = opts.dryRun ? links.length : 0;
    let assignedNow = !!opts.dryRun;

    if (!opts.dryRun) {
      await client.query('BEGIN');
      try {
        if (outcome === 'assigned') {
          const g = await client.query(
            `UPDATE card_set SET tcgplayer_group_id = $2
              WHERE id = $1 AND (tcgplayer_group_id IS NULL OR $3::boolean) RETURNING id`,
            [setId, groupId, known != null],
          );
          assignedNow = g.rows.length > 0;
        }
        if (links.length) {
          const upd = await client.query(
            `UPDATE card_variant cv
                SET tcgplayer_product_id = v.pid,
                    tcgplayer_printing   = v.printing,
                    id_source            = CASE WHEN cv.id_source = 'none' THEN v.src ELSE cv.id_source END,
                    id_confidence        = CASE WHEN cv.id_source = 'none' THEN v.conf ELSE cv.id_confidence END,
                    last_synced_at       = now()
               FROM unnest($1::bigint[], $2::int[], $3::text[], $4::text[], $5::smallint[])
                    AS v(id, pid, printing, src, conf)
              WHERE cv.id = v.id AND cv.tcgplayer_product_id IS NULL
          RETURNING cv.id`,
            [
              links.map((l) => l.variantId), links.map((l) => l.productId), links.map((l) => l.printing),
              links.map((l) => l.source), links.map((l) => l.confidence),
            ],
          );
          written = upd.rows.length;
        }
        await client.query('COMMIT');
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch { /* the original error is the one that matters */ }
        throw err;
      }
    }

    if (outcome === 'assigned' && assignedNow) result.groupsAssigned++;
    result.variantsLinked += written;
    result.perSet.push({
      set: s.tcgdex_id, group: groupId, groupOutcome: outcome, linked: written, skipped: tally(plan),
    });
  };

  for (const s of sets) {
    try {
      await linkOne(s);
    } catch (err) {
      // A rate limit aborts the whole run (TCGCSV's policy). Anything else costs ONE set, not all
      // of them: the rest are still linked and the caller fails the run loudly afterwards.
      if (err instanceof RateLimited) throw err;
      try { await client.query('ROLLBACK'); } catch { /* nothing open */ }
      result.failedSets.push({ set: s.tcgdex_id, error: err instanceof Error ? err.message : String(err) });
      console.error(`[prices] link pass: set ${s.tcgdex_id} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return result;
}
