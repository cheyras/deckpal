import { q } from '../db.js';
import { defineTool, type ToolDefinition } from '../registry.js';
import { fail, ok } from '../result.js';
import { errText } from './collection.js';

/**
 * `health` — SPEC §5 #1: DB ok + API ok, catalog counts, owned totals, last
 * sync_run per job with status, price freshness per source. The "is my data
 * fresh" tool. All queries are cheap aggregates well under the role's 30s
 * statement_timeout.
 */

interface CountsRow {
  cards: string;
  variants: string;
  sets: string;
}
interface OwnedRow {
  owned_cards: string;
  total_qty: string;
}
interface SyncRow {
  job: string;
  status: string;
  started_at: string;
  finished_at: string | null;
}
interface FreshnessRow {
  source_code: string;
  fetched_at: string;
}

const n = (s: string | number): string => Number(s).toLocaleString('en-US');

/** Compact relative age, e.g. "3h ago", "2d ago". */
function ago(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return iso;
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const healthTool = defineTool({
  name: 'health',
  title: 'DeckPal health & data freshness',
  description:
    'Check that deckpal-mcp can reach Postgres and deckpal-api, how fast those hops are, and ' +
    'how fresh the data is: catalog counts (cards/variants/sets), owned totals, the last sync ' +
    'run per job with its status, and price freshness per source. Use this to answer "is the ' +
    'system up / is my data fresh / is it slow right now". Not for collection statistics — ' +
    'use collection_summary for that.',
  annotations: { readOnlyHint: true, idempotentHint: true },
  handler: async (_args, ctx) => {
    try {
      // DB ping first — everything below depends on it. Timed, because "is
      // it up" and "will my write finish in time" are different questions,
      // and during the 2026-08-19 incident this tool answered the first one
      // reassuringly while the second was the actual problem: db and api were
      // both genuinely fine, and the MCP function was still being killed at
      // ~60 s because it was making one API round trip per item.
      let dbOk = false;
      let dbErr = '';
      let dbMs = 0;
      try {
        const t = Date.now();
        await q(ctx.db, 'SELECT 1');
        dbMs = Date.now() - t;
        dbOk = true;
      } catch (err) {
        // Through `errText`, not raw. `health` is the ONE tool whose whole job
        // is to answer when the database is down — so it is the tool most
        // likely to be holding a connection error, and a connection error's
        // message is built from the host, the user and sometimes the password
        // prompt. This string is a tool result: it reaches a model, and the
        // model may repeat it.
        dbErr = errText(err);
      }

      // API ping (warn-only by design — read tools work without it).
      let apiOk = false;
      let apiErr = '';
      let apiMs = 0;
      try {
        const t = Date.now();
        await ctx.api.get('/health');
        apiMs = Date.now() - t;
        apiOk = true;
      } catch (err) {
        apiErr = errText(err);
      }

      const lines: string[] = ['DeckPal health (deckpal-mcp)'];
      lines.push(
        `db: ${dbOk ? `ok (${dbMs} ms)` : `DOWN (${dbErr})`} · api: ${apiOk ? `ok (${apiMs} ms)` : `DOWN (${apiErr})`}`,
      );
      lines.push(
        'write budget: log_cards applies up to 250 items in ONE batched transaction (typically well under a ' +
          'second), and carries an idempotency key so retrying after any error is safe.',
      );

      if (!dbOk) {
        return ok(lines.join('\n'), { db: false, api: apiOk, apiLatencyMs: apiMs });
      }

      const [counts, owned, syncs, freshness] = await Promise.all([
        q<CountsRow>(
          ctx.db,
          `SELECT (SELECT count(*) FROM card)         AS cards,
                  (SELECT count(*) FROM card_variant) AS variants,
                  (SELECT count(*) FROM card_set)     AS sets`,
        ),
        q<OwnedRow>(
          ctx.db,
          `SELECT count(DISTINCT cv.card_id) FILTER (WHERE ci.quantity > 0) AS owned_cards,
                  COALESCE(sum(ci.quantity), 0)::bigint                     AS total_qty
             FROM collection_item ci
             JOIN card_variant cv ON cv.id = ci.card_variant_id
            WHERE ci.user_id = $1`,
          [ctx.userId],
        ),
        q<SyncRow>(
          ctx.db,
          `SELECT DISTINCT ON (job) job, status, started_at, finished_at
             FROM sync_run ORDER BY job, started_at DESC`,
        ),
        q<FreshnessRow>(
          ctx.db,
          `SELECT source_code, max(fetched_at) AS fetched_at
             FROM price_current GROUP BY source_code ORDER BY source_code`,
        ),
      ]);

      const c = counts[0];
      if (c) lines.push(`catalog: ${n(c.cards)} cards · ${n(c.variants)} variants · ${n(c.sets)} sets`);
      const o = owned[0];
      if (o) lines.push(`owned: ${n(o.owned_cards)} distinct cards · ${n(o.total_qty)} total copies`);

      if (syncs.length > 0) {
        lines.push('last sync per job:');
        for (const s of syncs) {
          const when = s.finished_at ?? s.started_at;
          lines.push(`  ${s.job}: ${s.status} · ${ago(when)}`);
        }
      } else {
        lines.push('last sync per job: none recorded');
      }

      if (freshness.length > 0) {
        lines.push('price freshness:');
        for (const f of freshness) {
          lines.push(`  ${f.source_code}: ${ago(f.fetched_at)}`);
        }
      } else {
        lines.push('price freshness: no prices loaded');
      }

      return ok(lines.join('\n'), {
        db: true,
        api: apiOk,
        dbLatencyMs: dbMs,
        apiLatencyMs: apiMs,
        catalog: c ? { cards: Number(c.cards), variants: Number(c.variants), sets: Number(c.sets) } : null,
        owned: o ? { distinctCards: Number(o.owned_cards), totalQuantity: Number(o.total_qty) } : null,
        syncs: syncs.map((s) => ({ job: s.job, status: s.status, finishedAt: s.finished_at })),
        priceFreshness: freshness.map((f) => ({ source: f.source_code, fetchedAt: f.fetched_at })),
      });
    } catch (err) {
      return fail(`health check failed: ${errText(err)}`);
    }
  },
});

export const statusTools: ToolDefinition[] = [
  healthTool,
];
