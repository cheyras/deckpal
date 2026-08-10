import type { McpServer } from '@modelcontextprotocol/server';
import type { Ctx } from '../ctx.js';
import { q } from '../db.js';
import { fail, ok } from '../envelope.js';

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

export function registerStatusTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    'health',
    {
      title: 'Pokedex health & data freshness',
      description:
        'Check that rotom-mcp can reach Postgres and deckscout-api, and how fresh the data is: ' +
        'catalog counts (cards/variants/sets), owned totals, the last sync run per job with its ' +
        'status, and price freshness per source. Use this to answer "is the system up / is my ' +
        'data fresh". Not for collection statistics — use collection_summary for that.',
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      try {
        // DB ping first — everything below depends on it.
        let dbOk = false;
        let dbErr = '';
        try {
          await q(ctx.db, 'SELECT 1');
          dbOk = true;
        } catch (err) {
          dbErr = (err as Error).message;
        }

        // API ping (warn-only by design — read tools work without it).
        let apiOk = false;
        let apiErr = '';
        try {
          await ctx.api.get('/health');
          apiOk = true;
        } catch (err) {
          apiErr = (err as Error).message;
        }

        const lines: string[] = ['rotom-mcp health'];
        lines.push(
          `db: ${dbOk ? 'ok' : `DOWN (${dbErr})`} · api: ${apiOk ? 'ok' : `DOWN (${apiErr})`}`,
        );

        if (!dbOk) {
          return ok(lines.join('\n'), { db: false, api: apiOk });
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
          catalog: c ? { cards: Number(c.cards), variants: Number(c.variants), sets: Number(c.sets) } : null,
          owned: o ? { distinctCards: Number(o.owned_cards), totalQuantity: Number(o.total_qty) } : null,
          syncs: syncs.map((s) => ({ job: s.job, status: s.status, finishedAt: s.finished_at })),
          priceFreshness: freshness.map((f) => ({ source: f.source_code, fetchedAt: f.fetched_at })),
        });
      } catch (err) {
        return fail(`health check failed: ${(err as Error).message}`);
      }
    },
  );
}
