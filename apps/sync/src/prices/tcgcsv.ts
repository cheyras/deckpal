// TCGCSV daily bulk price ingest (DATA-LAYER §4.2, §7.2/§7.3).
//
// Walk the sets that carry a TCGplayer groupId, fetch each group's `prices`, join every price row
// to a card_variant on (tcgplayer_product_id, tcgplayer_printing) ↔ (productId, subTypeName), and
// append idempotent price_observation rows + upsert price_current. One transaction per group so a
// crash resumes mid-list; captured_at = TCGCSV's own last-updated.txt stamp, never now().

import { fetchText, fetchJson, RateLimited } from './http.js';
import { linkTcgcsvProducts } from './linkTcgcsv.js';
import { fillPrizePack, PRIZE_PACK_GROUP, type PrizePackResult } from './prizePack.js';
import { OVERRIDES, type OverrideIndex } from '../catalog/priceLinkOverrides.js';
import { toMinor, type TcgcsvPriceEnvelope, type TcgcsvPriceRow, type Metrics } from './types.js';
import {
  type Queryable, type PricePoint, appendObservations, upsertCurrent, ensureObservationPartition,
  startRun, finishRun, lastOkStamp, tryLock, unlock,
} from './db.js';

const BASE = 'https://tcgcsv.com/tcgplayer/3';
const SOURCE_ID = 1; // price_source.id  (SMALLINT) for price_observation
const SOURCE_CODE = 'tcgcsv'; // price_source.code (TEXT)  for price_current
const CURRENCY = 'USD';
const USD_MINOR = 2;

export async function fetchLastUpdated(): Promise<string> {
  return (await fetchText('https://tcgcsv.com/last-updated.txt')).trim();
}
export async function fetchGroupPrices(groupId: number): Promise<TcgcsvPriceRow[]> {
  const env = await fetchJson<TcgcsvPriceEnvelope>(`${BASE}/${groupId}/prices`);
  if (!env.success) throw new Error(`TCGCSV prices ${groupId}: ${env.errors.join('; ') || 'success=false'}`);
  return env.results;
}

// TCGplayer price row → the 9-column metric bag. Printing is carried by the join, not the metric.
export function tcgplayerMetrics(row: TcgcsvPriceRow): Metrics {
  return {
    market_minor: toMinor(row.marketPrice, USD_MINOR),
    low_minor: toMinor(row.lowPrice, USD_MINOR),
    mid_minor: toMinor(row.midPrice, USD_MINOR),
    high_minor: toMinor(row.highPrice, USD_MINOR),
    direct_low_minor: toMinor(row.directLowPrice, USD_MINOR),
  };
}

export interface SetRef { setId: number; tcgdexId: string; groupId: number }

export async function resolveSets(client: Queryable, filter: string[] | null): Promise<SetRef[]> {
  const { rows } = await client.query<{ id: string; tcgdex_id: string; g: number }>(
    `SELECT id, tcgdex_id, tcgplayer_group_id AS g FROM card_set
       WHERE tcgplayer_group_id IS NOT NULL
         AND ($1::text[] IS NULL OR tcgdex_id = ANY($1))
       ORDER BY tcgplayer_group_id`,
    [filter],
  );
  return rows.map((r) => ({ setId: Number(r.id), tcgdexId: r.tcgdex_id, groupId: Number(r.g) }));
}

// (productId, printing) → card_variant.id for one set. Printing-aware so the two rows of a shared
// product (Normal + Reverse Holofoil) each land on the right variant — this is where the TCGplayer
// side of the reverse-holo distinction is honoured (it is keyed by printing name, unlike Cardmarket).
// Exported for the archive backfill, which builds one lookup per SET ONCE and
// reuses it across every replayed day. Calling this per (set, day) instead would
// be 217 x 730 = 158,000 identical queries for a two-year replay.
export async function variantLookup(client: Queryable, setId: number): Promise<Map<string, number>> {
  const { rows } = await client.query<{ id: string; pid: number; printing: string | null }>(
    `SELECT cv.id, cv.tcgplayer_product_id AS pid, cv.tcgplayer_printing AS printing
       FROM card_variant cv JOIN card c ON c.id = cv.card_id
      WHERE c.set_id = $1 AND cv.tcgplayer_product_id IS NOT NULL`,
    [setId],
  );
  const m = new Map<string, number>();
  for (const r of rows) if (r.printing) m.set(`${r.pid}|${r.printing}`, Number(r.id));
  return m;
}

export interface PriceIngestResult {
  sets: number; groupsFetched: number; observations: number; current: number;
  pricedVariants: number; unmatchedRows: number; skipped: boolean; stamp: string;
  /** What the link pass did before the walk (linkTcgcsv.ts); zeros when it had nothing to do. */
  linkedVariants: number; assignedGroups: number;
  /** Play! Pokémon stamped printings the link pass added (prizePack.ts). */
  prizePackAdded: number;
}

// Reusable per-set writer: given already-fetched price rows, join + write. Returns rows written.
//
// `updateCurrent` exists for the archive backfill and defaults to the live
// behaviour. `price_current` is the LATEST price per variant, with no history —
// so replaying an archive from three weeks ago through this function with the
// default would leave every card in the app quoting a three-week-old price as
// if it were today's. The backfill appends observations and leaves the hot
// snapshot alone; only a live run may write it.
export async function writeSetPrices(
  client: Queryable, setId: number, prices: TcgcsvPriceRow[], capturedAt: Date, runId: number | null,
  opts: { updateCurrent?: boolean } = {},
): Promise<{ observations: number; matched: number; unmatched: number }> {
  const lut = await variantLookup(client, setId);
  const points: PricePoint[] = [];
  let unmatched = 0;
  for (const row of prices) {
    const cv = lut.get(`${row.productId}|${row.subTypeName}`);
    if (cv == null) { unmatched++; continue; }
    points.push({ cardVariantId: cv, sourceId: SOURCE_ID, sourceCode: SOURCE_CODE, currency: CURRENCY, metrics: tcgplayerMetrics(row) });
  }
  const observations = await appendObservations(client, points, capturedAt, runId);
  if (opts.updateCurrent !== false) await upsertCurrent(client, points, capturedAt);
  return { observations, matched: points.length, unmatched };
}

/**
 * Price a TCGplayer group by product id across EVERY set. `writeSetPrices` cannot: it joins one
 * set's group to that set's variants, and a Prize Pack product (prizePack.ts) belongs to no set's
 * group, so every stamped printing went unpriced, TCGdex's own included.
 *
 * The join is (product id, printing), like the set walk. One fallback: a product TCGplayer prices
 * in exactly one printing, linked from exactly one variant, is that variant even when the printing
 * names differ. TCGdex files some cosmos stamps as "reverse" and the importer writes "Reverse
 * Holofoil" for them; TCGplayer sells the same card as "Holofoil".
 */
export async function writeProductGroupPrices(
  client: Queryable, prices: TcgcsvPriceRow[], capturedAt: Date, runId: number | null,
): Promise<{ observations: number; matched: number; unmatched: number }> {
  if (prices.length === 0) return { observations: 0, matched: 0, unmatched: 0 };
  const pids = [...new Set(prices.map((p) => p.productId))];
  const { rows } = await client.query<{ id: string; pid: number; printing: string | null }>(
    `SELECT id, tcgplayer_product_id AS pid, tcgplayer_printing AS printing
       FROM card_variant WHERE tcgplayer_product_id = ANY($1::int[])`,
    [pids],
  );
  const byPid = new Map<number, { id: number; printing: string | null }[]>();
  for (const r of rows) {
    const pid = Number(r.pid);
    (byPid.get(pid) ?? byPid.set(pid, []).get(pid)!).push({ id: Number(r.id), printing: r.printing });
  }
  const rowsPerPid = new Map<number, number>();
  for (const p of prices) rowsPerPid.set(p.productId, (rowsPerPid.get(p.productId) ?? 0) + 1);

  const points: PricePoint[] = [];
  let unmatched = 0;
  for (const row of prices) {
    const vs = byPid.get(row.productId) ?? [];
    let hit = vs.filter((v) => v.printing === row.subTypeName);
    if (hit.length === 0 && vs.length === 1 && rowsPerPid.get(row.productId) === 1) hit = vs;
    if (hit.length === 0) { unmatched++; continue; }
    for (const v of hit) {
      points.push({ cardVariantId: v.id, sourceId: SOURCE_ID, sourceCode: SOURCE_CODE, currency: CURRENCY, metrics: tcgplayerMetrics(row) });
    }
  }
  const observations = await appendObservations(client, points, capturedAt, runId);
  await upsertCurrent(client, points, capturedAt);
  return { observations, matched: points.length, unmatched };
}

/**
 * Products of the verified override table (catalog/priceLinkOverrides.ts) that are in place on
 * their variant but listed in a TCGplayer group other than their set's, by group. The set walk
 * never reaches them (it joins a set's own group), so the ingest prices exactly these products from
 * their own group — an Alternate Art Promo of an expansion card, a jumbo card of a promo set.
 */
export async function overrideProductsOutsideSetGroups(
  client: Queryable, index: OverrideIndex, filter: string[] | null,
): Promise<Map<number, Set<number>>> {
  const list = [...index.values()];
  const out = new Map<number, Set<number>>();
  if (list.length === 0) return out;
  const { rows } = await client.query<{ g: number; pid: number }>(
    `SELECT DISTINCT o.g, o.pid
       FROM unnest($1::text[], $2::text[], $3::int[], $4::int[]) AS o(card, kind, g, pid)
       JOIN card c ON c.tcgdex_id = o.card AND c.lang = 'en'
       JOIN card_set s ON s.id = c.set_id
       JOIN card_variant cv ON cv.card_id = c.id AND cv.variant_kind_code = o.kind
                           AND cv.tcgplayer_product_id = o.pid
      WHERE s.tcgplayer_group_id IS DISTINCT FROM o.g
        AND ($5::text[] IS NULL OR s.tcgdex_id = ANY($5::text[]))`,
    [list.map((o) => o.cardId), list.map((o) => o.kind), list.map((o) => o.groupId), list.map((o) => o.productId), filter],
  );
  for (const r of rows) {
    const g = Number(r.g);
    (out.get(g) ?? out.set(g, new Set()).get(g)!).add(Number(r.pid));
  }
  return out;
}

export interface IngestOpts {
  sets?: string[]; force?: boolean;
  /** Run the link pass (default true). Off only for tests and for isolating a price bug. */
  link?: boolean;
}

/** Test seams: the three things `ingestTcgcsvPrices` reaches over the network. */
export interface IngestDeps {
  fetchLastUpdated?: () => Promise<string>;
  fetchGroupPrices?: (groupId: number) => Promise<TcgcsvPriceRow[]>;
  linkProducts?: typeof linkTcgcsvProducts;
  /** The Prize Pack fill (prizePack.ts), run inside the link step on a full run. */
  fillPrizePack?: (client: Queryable) => Promise<PrizePackResult>;
  /** The verified override table (default: catalog/priceLinkOverrides.ts). */
  overrides?: OverrideIndex;
}

interface LinkStepResult { linked: number; assigned: number; prizePackAdded: number; failure: string | null }

/**
 * The link pass as its OWN sync_run job (`products-tcgcsv`), keyed on TCGCSV's stamp like the price
 * ingest. That is what lets it retry independently: a failed link run is recorded `failed`, which
 * `lastOkStamp` does not count, so the next 15-minute tick tries the link pass again instead of
 * waiting for tomorrow's stamp — and a good one is recorded `ok`, so it costs one query per tick.
 * A run restricted with `--sets` records no stamp, so it can never satisfy the full run.
 */
async function runLinkStep(
  client: Queryable, stamp: string, filter: string[] | null, link: typeof linkTcgcsvProducts,
  prizePack: (client: Queryable) => Promise<PrizePackResult>,
): Promise<LinkStepResult> {
  let runId: number | null = null;
  try {
    runId = await startRun(client, 'products-tcgcsv', filter ? null : stamp);
    const r = await link(client, { sets: filter });
    const failed = r.failedSets.length;
    // The Prize Pack printings (prizePack.ts) are a product-link job on the same daily stamp, so
    // they share this run rather than needing a job of their own. Only a full run does them:
    // `--sets` narrows the per-set walk, and group 22880 spans every set. A failure here costs the
    // stamped printings, not the links above or today's prices, and still turns the run red.
    let pp: PrizePackResult | null = null;
    let ppFailure: string | null = null;
    if (!filter) {
      try {
        pp = await prizePack(client);
      } catch (err) {
        if (err instanceof RateLimited) throw err;
        try { await client.query('ROLLBACK'); } catch { /* nothing open */ }
        ppFailure = `Prize Pack printings: ${err instanceof Error ? err.message : String(err)}`;
        console.error(`[prices] link pass: ${ppFailure}`);
      }
    }
    const errors = [
      ...(failed ? [`${failed} set(s) failed: ${r.failedSets.slice(0, 5).map((f) => `${f.set}: ${f.error}`).join('; ')}`] : []),
      ...(ppFailure ? [ppFailure] : []),
    ];
    await finishRun(client, runId, errors.length ? 'failed' : 'ok', {
      rowsWritten: r.variantsLinked + r.overridesApplied + (pp ? pp.added + pp.linked : 0), itemsSeen: r.setsScanned,
      itemsFailed: failed + (ppFailure ? 1 : 0),
      cursor: {
        groupsAssigned: r.groupsAssigned, unresolvedSets: r.unresolvedSets,
        overridesApplied: r.overridesApplied,
        ...(r.overridesRefused.length ? { overridesRefused: r.overridesRefused } : {}),
        ...(pp ? { prizePack: { added: pp.added, linked: pp.linked, covered: pp.covered, skipped: pp.skipped } } : {}),
      },
      error: errors.length ? errors.join(' | ') : undefined,
    });
    return {
      linked: r.variantsLinked + r.overridesApplied + (pp?.linked ?? 0), assigned: r.groupsAssigned, prizePackAdded: pp?.added ?? 0,
      failure: failed
        ? `${failed} set(s) could not be linked (${r.failedSets[0]!.set}: ${r.failedSets[0]!.error})`
        : ppFailure,
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* nothing open */ }
    // Recording the failure is best-effort: if the database is what failed, the original error is
    // the one to report, and the next run's sweep (below) clears whatever row was left behind.
    if (runId != null) {
      try { await finishRun(client, runId, 'failed', { error: err instanceof Error ? err.message : String(err) }); } catch { /* see above */ }
    }
    if (err instanceof RateLimited) throw err; // TCGCSV's policy is to stop the whole run
    return { linked: 0, assigned: 0, prizePackAdded: 0, failure: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * `sync_run_one_active` allows ONE `running` row per job, and nothing else ever clears one: a run
 * that is cancelled, loses its runner or its connection leaves its row `running` forever, and every
 * later `startRun` for that job then fails on the unique index. For the link pass that would have
 * stopped ALL price ingestion (it runs in front of the walk) until someone edited the table by hand.
 * Called only while holding the `prices-tcgcsv` advisory lock — the one lock both jobs run under — so
 * a `running` row seen here cannot belong to a live run. `orphaned` is in the status CHECK and is not
 * counted by `lastOkStamp`, so the interrupted work is retried.
 */
async function sweepInterruptedRuns(client: Queryable): Promise<void> {
  await client.query(
    `UPDATE sync_run SET status = 'orphaned', finished_at = now(),
            error = 'left running by an interrupted run; cleared by the next run'
      WHERE job = ANY($1::text[]) AND status = 'running'`,
    [['prices-tcgcsv', 'products-tcgcsv']],
  );
}

export async function ingestTcgcsvPrices(
  client: Queryable, opts: IngestOpts = {}, deps: IngestDeps = {},
): Promise<PriceIngestResult> {
  const filter = opts.sets && opts.sets.length ? opts.sets : null;
  const stamp = await (deps.fetchLastUpdated ?? fetchLastUpdated)();
  const capturedAt = new Date(stamp); // the source's own timestamp — NOT now()
  if (Number.isNaN(capturedAt.getTime())) throw new Error(`unparseable last-updated.txt: "${stamp}"`);
  const walkPrices = deps.fetchGroupPrices ?? fetchGroupPrices;

  if (!(await tryLock(client, 'prices-tcgcsv'))) throw new Error('prices-tcgcsv already running (advisory lock held)');
  try {
    await sweepInterruptedRuns(client);
    // Skip-if-unchanged: only gate a full run (no set filter). A targeted --sets run always proceeds.
    const pricesUnchanged = !opts.force && !filter && (await lastOkStamp(client, 'prices-tcgcsv')) === stamp;

    // Link first: the walk below starts from "sets that carry a groupId" and joins on "variants that
    // carry a productId", so a link made after it prices the card a day late. It is decided apart
    // from the price skip, so a failed link pass is retried on the next tick even though today's
    // prices are already in. A failure is held and thrown once the prices that CAN be written are
    // written, so the job goes red rather than cards staying unpriced behind a green dashboard.
    let linkRun: LinkStepResult = { linked: 0, assigned: 0, prizePackAdded: 0, failure: null };
    if (opts.link !== false) {
      const due = !!filter || !!opts.force || (await lastOkStamp(client, 'products-tcgcsv')) !== stamp;
      if (due) {
        linkRun = await runLinkStep(
          client, stamp, filter, deps.linkProducts ?? linkTcgcsvProducts,
          deps.fillPrizePack ?? ((c) => fillPrizePack(c)),
        );
      }
    }
    const linkFailed = (): Error =>
      new Error(`the TCGCSV link pass failed, so cards TCGdex has no TCGplayer id for stay unpriced: ${linkRun.failure}`);

    if (pricesUnchanged) {
      if (linkRun.failure) throw linkFailed();
      return {
        sets: 0, groupsFetched: 0, observations: 0, current: 0, pricedVariants: 0, unmatchedRows: 0,
        skipped: true, stamp, linkedVariants: linkRun.linked, assignedGroups: linkRun.assigned,
        prizePackAdded: linkRun.prizePackAdded,
      };
    }

    const runId = await startRun(client, 'prices-tcgcsv', stamp);
    await ensureObservationPartition(client, capturedAt);
    const sets = await resolveSets(client, filter);
    let observations = 0, matched = 0, unmatched = 0, groupsFetched = 0, lastGroup: number | null = null;
    try {
      for (const s of sets) {
        const prices = await walkPrices(s.groupId);
        groupsFetched++;
        await client.query('BEGIN');
        const r = await writeSetPrices(client, s.setId, prices, capturedAt, runId);
        await client.query('COMMIT');
        observations += r.observations; matched += r.matched; unmatched += r.unmatched;
        lastGroup = s.groupId;
      }
      // Prize Pack printings belong to no set's group: price them by product id (above).
      if (!filter) {
        const prices = await walkPrices(PRIZE_PACK_GROUP);
        groupsFetched++;
        await client.query('BEGIN');
        const r = await writeProductGroupPrices(client, prices, capturedAt, runId);
        await client.query('COMMIT');
        observations += r.observations; matched += r.matched; unmatched += r.unmatched;
        lastGroup = PRIZE_PACK_GROUP;
      }
      // Override products filed outside their set's group: priced from their own group, by id,
      // and only those products (the rest of such a group belongs to other sets, or to none).
      const outside = await overrideProductsOutsideSetGroups(client, deps.overrides ?? OVERRIDES, filter);
      for (const [g, pids] of outside) {
        const prices = (await walkPrices(g)).filter((p) => pids.has(p.productId));
        groupsFetched++;
        await client.query('BEGIN');
        const r = await writeProductGroupPrices(client, prices, capturedAt, runId);
        await client.query('COMMIT');
        observations += r.observations; matched += r.matched; unmatched += r.unmatched;
        lastGroup = g;
      }
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      await finishRun(client, runId, 'partial', { rowsWritten: observations, itemsSeen: groupsFetched, cursor: { lastGroup }, error: (err as Error).message });
      throw err;
    }
    await finishRun(client, runId, 'ok', { rowsWritten: observations, itemsSeen: groupsFetched, cursor: { lastGroup } });
    if (linkRun.failure) throw linkFailed();
    return {
      sets: sets.length, groupsFetched, observations, current: matched, pricedVariants: matched,
      unmatchedRows: unmatched, skipped: false, stamp, linkedVariants: linkRun.linked, assignedGroups: linkRun.assigned,
      prizePackAdded: linkRun.prizePackAdded,
    };
  } finally {
    await unlock(client, 'prices-tcgcsv');
  }
}
