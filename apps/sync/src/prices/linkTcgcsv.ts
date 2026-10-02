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
// IT NEVER OVERWRITES. Every UPDATE is guarded by `… IS NULL`: an id TCGdex (or the release
// overlay) supplied is authoritative, and a link this pass wrote is simply re-derived next time.
// It deliberately does NOT write `tcgplayer_url`: the API prefers a stored URL over the product id
// (apps/api/src/db.ts `tcgplayerUrl`), and the importer never resets that column, so a stored URL
// would outlive the link it was derived from and keep sending buyers to the old product.
//
// B8: idempotent, one transaction per set, 1 connection. B9: touches catalog price-link columns only.

import { fetchJson, RateLimited } from './http.js';
import type { Queryable } from './db.js';
import type {
  TcgcsvPriceEnvelope, TcgcsvPriceRow, TcgcsvProductEnvelope, TcgcsvProductRow,
} from './types.js';
import {
  acceptGroup, candidateGroups, planSetLinks,
  type GroupRef, type GroupScore, type LinkCard, type PlanResult, type SkipReason,
} from './linkMatch.js';

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
}

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
        AND (s.tcgplayer_group_id IS NULL OR EXISTS (
              SELECT 1 FROM card c JOIN card_variant cv ON cv.card_id = c.id
               WHERE c.set_id = s.id
                 AND cv.tcgplayer_product_id IS NULL
                 AND cv.variant_kind_code IN ('normal','holo','reverse',
                                              'normal-stamp-1st-edition','holo-stamp-1st-edition')))
      ORDER BY s.id`,
    [filter],
  );
  return rows;
}

async function loadCards(client: Queryable, setId: number): Promise<LinkCard[]> {
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
    c.variants.push({ id: Number(r.vid), kind: r.kind, productId: r.pid, printing: r.printing });
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
  const sets = await setsWithGaps(client, filter);
  const result: LinkResult = {
    dryRun: !!opts.dryRun, setsScanned: sets.length, groupsAssigned: 0, variantsLinked: 0,
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
    const cards = await loadCards(client, setId);
    let groupId = s.g == null ? null : Number(s.g);
    let outcome: SetLinkReport['groupOutcome'] = 'kept';
    let plan: PlanResult;

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
            `UPDATE card_set SET tcgplayer_group_id = $2 WHERE id = $1 AND tcgplayer_group_id IS NULL RETURNING id`,
            [setId, groupId],
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
