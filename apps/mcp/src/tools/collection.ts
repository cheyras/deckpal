import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Ctx } from '../ctx.js';
import { q, q1 } from '../db.js';
import { fail, ok } from '../envelope.js';
import { money, row } from '../format.js';

/**
 * Collection tools — SPEC §5 #2 collection_summary (+ the collection://summary
 * resource backer), #6 collection_log, #7 collection_value. All direct SQL
 * (SPEC §3), readOnlyHint on everything.
 *
 * Money: "best" price = MAX(market_minor) per (variant, currency) across
 * sources (matches apps/api/src/insights/collectionValue.ts); "estimated value"
 * = Σ qty × best, PER CURRENCY, never summed across currencies. NULL price =
 * "unpriced", never $0 — unpriced counts are reported separately.
 */

export type Goal = 'complete' | 'master' | 'grandmaster';

/** The user's default completion goal (user_settings.default_goal). */
export async function defaultGoal(ctx: Ctx): Promise<Goal> {
  const r = await q1<{ default_goal: string }>(
    ctx.pool,
    'SELECT default_goal FROM user_settings WHERE user_id = $1',
    [ctx.userId],
  );
  const g = r?.default_goal;
  return g === 'master' || g === 'grandmaster' ? g : 'complete';
}

/** Surface a statement_timeout as an actionable hint (SPEC §3). */
export function errText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return /statement timeout/i.test(msg)
    ? `${msg} — the query hit the 30s statement timeout; narrow it (add filters or reduce page_size/limit)`
    : msg;
}

const nfmt = (v: string | number): string => Number(v).toLocaleString('en-US');

/** timestamptz/Date → compact UTC stamp 'YYYY-MM-DD HH:MM'. */
function stamp(v: unknown): string {
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

// ── collection_summary / collection://summary ────────────────────────────────

interface CountsRow {
  distinct_cards: string;
  total_copies: string;
  sets_owned: string;
}
interface ValueRow {
  total_minor: string | null;
  priced_variants: string;
  unpriced_variants: string;
}
interface TopRow {
  name: string;
  set_name: string;
  set_tid: string;
  variant: string;
  quantity: number;
  best_minor: string;
  line_minor: string;
}
interface NearRow {
  set_tid: string;
  set_name: string;
  owned_required: number;
  total_required: number;
}

/**
 * Text payload shared by the `collection_summary` tool and the
 * `collection://summary` resource (SPEC §5 resource). One SQL round-trip per
 * section; the pool is a single connection so they run sequentially anyway.
 */
export async function summaryText(ctx: Ctx, topN = 10): Promise<string> {
  const goal = await defaultGoal(ctx);

  const counts = await q1<CountsRow>(
    ctx.pool,
    `SELECT count(DISTINCT cv.card_id)  AS distinct_cards,
            COALESCE(sum(ci.quantity), 0)::bigint AS total_copies,
            count(DISTINCT c.set_id)    AS sets_owned
       FROM collection_item ci
       JOIN card_variant cv ON cv.id = ci.card_variant_id
       JOIN card c          ON c.id = cv.card_id
      WHERE ci.user_id = $1 AND ci.quantity > 0`,
    [ctx.userId],
  );

  // Estimated USD value: Σ qty × best USD market price per owned variant.
  const value = await q1<ValueRow>(
    ctx.pool,
    `WITH best AS (
       SELECT card_variant_id, max(market_minor) AS best_minor
         FROM price_current
        WHERE currency_code = 'USD' AND market_minor IS NOT NULL
        GROUP BY card_variant_id)
     SELECT sum(ci.quantity * b.best_minor)::bigint            AS total_minor,
            count(*) FILTER (WHERE b.best_minor IS NOT NULL)   AS priced_variants,
            count(*) FILTER (WHERE b.best_minor IS NULL)       AS unpriced_variants
       FROM collection_item ci
       LEFT JOIN best b ON b.card_variant_id = ci.card_variant_id
      WHERE ci.user_id = $1 AND ci.quantity > 0`,
    [ctx.userId],
  );

  const top = await q<TopRow>(
    ctx.pool,
    `WITH best AS (
       SELECT card_variant_id, max(market_minor) AS best_minor
         FROM price_current
        WHERE currency_code = 'USD' AND market_minor IS NOT NULL
        GROUP BY card_variant_id)
     SELECT c.name, cs.name AS set_name, cs.tcgdex_id AS set_tid,
            COALESCE(cv.display_name, cv.variant_kind_code) AS variant,
            ci.quantity, b.best_minor, (ci.quantity * b.best_minor)::bigint AS line_minor
       FROM collection_item ci
       JOIN best b          ON b.card_variant_id = ci.card_variant_id
       JOIN card_variant cv ON cv.id = ci.card_variant_id
       JOIN card c          ON c.id = cv.card_id
       JOIN card_set cs     ON cs.id = c.set_id
      WHERE ci.user_id = $1 AND ci.quantity > 0
      ORDER BY line_minor DESC, c.name
      LIMIT $2`,
    [ctx.userId, topN],
  );

  const near = await q<NearRow>(
    ctx.pool,
    `SELECT cs.tcgdex_id AS set_tid, cs.name AS set_name,
            p.owned_required, p.total_required
       FROM user_set_progress p
       JOIN card_set cs ON cs.id = p.set_id
      WHERE p.user_id = $1 AND p.goal = $2
        AND p.owned_required > 0 AND p.owned_required < p.total_required
      ORDER BY p.owned_required::float / NULLIF(p.total_required, 0) DESC, cs.tcgdex_id
      LIMIT 5`,
    [ctx.userId, goal],
  );

  const lines: string[] = ['Collection summary'];
  if (counts) {
    lines.push(
      `owned: ${nfmt(counts.distinct_cards)} distinct cards · ${nfmt(counts.total_copies)} total copies · ${nfmt(counts.sets_owned)} sets with ownership`,
    );
  }
  if (value) {
    const unpriced = Number(value.unpriced_variants);
    lines.push(
      `estimated value: ${money(value.total_minor === null ? null : Number(value.total_minor))} USD ` +
        `(best market price × qty over ${nfmt(value.priced_variants)} priced owned variants` +
        `${unpriced > 0 ? `; ${nfmt(unpriced)} owned variants unpriced, excluded` : ''}) — estimate`,
    );
  }
  if (top.length > 0) {
    lines.push(`top ${top.length} owned cards by value:`);
    for (const t of top) {
      lines.push(
        '  ' +
          row(
            t.name,
            `${t.set_name} (${t.set_tid})`,
            t.variant,
            `x${t.quantity}`,
            `${money(Number(t.best_minor))} → ${money(Number(t.line_minor))}`,
          ),
      );
    }
  }
  if (near.length > 0) {
    lines.push(`nearest-complete sets (goal: ${goal}):`);
    for (const s of near) {
      const pct = s.total_required > 0 ? ((s.owned_required / s.total_required) * 100).toFixed(1) : '0.0';
      lines.push(`  ${row(`${s.set_name} (${s.set_tid})`, `${s.owned_required}/${s.total_required}`, `${pct}%`)}`);
    }
  } else {
    lines.push('nearest-complete sets: none in progress');
  }
  lines.push('Drill down with set_progress, search_cards (owned_only), or get_card.');
  return lines.join('\n');
}

// ── registration ─────────────────────────────────────────────────────────────

export function registerCollectionTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    'collection_summary',
    {
      title: 'Collection summary',
      description:
        'The default entry point for collection questions: distinct cards owned, total copies, ' +
        'sets with ownership, estimated USD value (with the unpriced-variant count), the top-N ' +
        'owned cards by value, and the 5 nearest-complete sets for your default goal. Answers ' +
        'most "how is my collection doing" questions in one call. Not for per-set detail ' +
        '(use set_progress) or per-card detail (use get_card).',
      inputSchema: z.object({
        top_n: z
          .number()
          .int()
          .min(1)
          .max(25)
          .default(10)
          .describe('How many top owned cards by value to list (1–25, default 10).'),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ top_n }) => {
      try {
        return ok(await summaryText(ctx, top_n));
      } catch (err) {
        return fail(`collection_summary failed: ${errText(err)}`);
      }
    },
  );

  // ── collection_log — SPEC §5 #6 ────────────────────────────────────────────
  interface LogRow {
    occurred_at: Date | string;
    delta: number;
    quantity_after: number;
    source: string;
    note: string | null;
    name: string;
    local_id: string;
    set_tid: string;
    variant_kind_code: string;
  }

  server.registerTool(
    'collection_log',
    {
      title: 'Collection change log',
      description:
        'The audit trail of collection changes (collection_event), newest first: when, which ' +
        'card/variant, the quantity delta and resulting quantity, who wrote it (source: web UI, ' +
        'rotom-mcp, imports) and any note. Use it to review recent adds/removals or verify what ' +
        'an agent logged. Not for current totals (collection_summary) or current quantities ' +
        '(get_card).',
      inputSchema: z.object({
        since: z
          .string()
          .optional()
          .describe("Only events at/after this ISO 8601 timestamp, e.g. '2026-07-01' or '2026-07-28T15:00:00Z'."),
        source: z
          .string()
          .optional()
          .describe("Only events written by this source, e.g. 'web', 'rotom-mcp', an import script name."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe('Maximum events to return (1–200, default 50, newest first).'),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ since, source, limit }) => {
      try {
        const conds: string[] = ['ce.user_id = $1'];
        const params: unknown[] = [ctx.userId];
        const p = (v: unknown): string => {
          params.push(v);
          return `$${params.length}`;
        };
        if (since !== undefined) {
          const t = Date.parse(since);
          if (Number.isNaN(t)) return fail(`since '${since}' is not a parseable ISO 8601 timestamp`);
          conds.push(`ce.occurred_at >= ${p(new Date(t).toISOString())}::timestamptz`);
        }
        if (source !== undefined) conds.push(`ce.source = ${p(source.trim())}`);

        const where = conds.join(' AND ');
        const totalRow = await q1<{ total: string }>(
          ctx.pool,
          `SELECT count(*) AS total FROM collection_event ce WHERE ${where}`,
          params,
        );
        const total = Number(totalRow?.total ?? 0);

        const rows = await q<LogRow>(
          ctx.pool,
          `SELECT ce.occurred_at, ce.delta, ce.quantity_after, ce.source, ce.note,
                  c.name, c.local_id, cs.tcgdex_id AS set_tid, cv.variant_kind_code
             FROM collection_event ce
             JOIN card_variant cv ON cv.id = ce.card_variant_id
             JOIN card c          ON c.id = cv.card_id
             JOIN card_set cs     ON cs.id = c.set_id
            WHERE ${where}
            ORDER BY ce.occurred_at DESC, ce.id DESC
            LIMIT ${p(limit)}`,
          params,
        );

        if (rows.length === 0) return ok('No collection events match.');
        const lines = rows.map((r) =>
          row(
            stamp(r.occurred_at),
            `${r.name} (${r.set_tid} #${r.local_id})`,
            r.variant_kind_code,
            `${r.delta > 0 ? '+' : ''}${r.delta} → ${r.quantity_after}`,
            r.source,
            r.note,
          ),
        );
        const footer =
          rows.length < total ? `showing latest ${rows.length} of ${total} — raise limit or filter with since/source` : `all ${total} matching events`;
        return ok([...lines, footer].join('\n'), { total, returned: rows.length });
      } catch (err) {
        return fail(`collection_log failed: ${errText(err)}`);
      }
    },
  );

  // ── collection_value — SPEC §5 #7 ──────────────────────────────────────────
  // Implemented directly against price_current / collection_value_point,
  // following apps/api/src/insights/collectionValue.ts (value-now = Σ qty ×
  // best per currency; window delta = first→last collection_value_point in the
  // window; movers = market vs avg30 × qty). Direct SQL rather than the
  // GET /insights/value route because that route's range enum (30d|3m|6m|1y)
  // cannot express this tool's 7d/90d windows.
  const WINDOW_DAYS: Record<'7d' | '30d' | '90d', number> = { '7d': 7, '30d': 30, '90d': 90 };

  interface CurTotalRow {
    currency_code: string;
    total_minor: string;
    priced_variants: string;
    qty: string;
  }
  interface PointRow {
    currency_code: string;
    d: string;
    total_minor: string;
  }
  interface MoverRow {
    tcgdex_id: string;
    name: string;
    variant_kind_code: string;
    currency_code: string;
    quantity: number;
    market_minor: number;
    avg30_minor: number;
  }

  server.registerTool(
    'collection_value',
    {
      title: 'Collection value & movers',
      description:
        'Estimated collection value right now (per currency, best market price × quantity), how ' +
        'it changed over a window (from the daily value snapshots), and the biggest owned price ' +
        'movers vs their 30-day average. All figures are market-price estimates, not appraisals. ' +
        'For overall collection stats use collection_summary; for one card\'s prices use get_card.',
      inputSchema: z.object({
        window: z
          .enum(['7d', '30d', '90d'])
          .default('30d')
          .describe('Change-over-time window for the snapshot delta (default 30d).'),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ window }) => {
      try {
        const totals = await q<CurTotalRow>(
          ctx.pool,
          `WITH best AS (
             SELECT card_variant_id, currency_code, max(market_minor) AS best_minor
               FROM price_current
              WHERE market_minor IS NOT NULL
              GROUP BY card_variant_id, currency_code)
           SELECT b.currency_code, sum(ci.quantity * b.best_minor)::bigint AS total_minor,
                  count(*) AS priced_variants, sum(ci.quantity)::bigint AS qty
             FROM collection_item ci
             JOIN best b ON b.card_variant_id = ci.card_variant_id
            WHERE ci.user_id = $1 AND ci.quantity > 0
            GROUP BY b.currency_code
            ORDER BY b.currency_code`,
          [ctx.userId],
        );
        const unpricedRow = await q1<{ unpriced: string }>(
          ctx.pool,
          `SELECT count(*) AS unpriced
             FROM collection_item ci
            WHERE ci.user_id = $1 AND ci.quantity > 0
              AND NOT EXISTS (SELECT 1 FROM price_current pc
                               WHERE pc.card_variant_id = ci.card_variant_id
                                 AND pc.market_minor IS NOT NULL)`,
          [ctx.userId],
        );

        const points = await q<PointRow>(
          ctx.pool,
          `SELECT currency_code, to_char(observed_on, 'YYYY-MM-DD') AS d, total_minor
             FROM collection_value_point
            WHERE user_id = $1 AND observed_on >= CURRENT_DATE - $2::int
            ORDER BY currency_code, observed_on`,
          [ctx.userId, WINDOW_DAYS[window]],
        );

        // Movers vs the 30-day average, top 5 PER CURRENCY — the current feeds
        // only carry avg30 on the cardmarket/EUR source, so a USD-only filter
        // would be structurally empty (verified 2026-07-29).
        const movers = await q<MoverRow>(
          ctx.pool,
          `SELECT tcgdex_id, name, variant_kind_code, currency_code, quantity, market_minor, avg30_minor
             FROM (
               SELECT c.tcgdex_id, c.name, cv.variant_kind_code, pc.currency_code, ci.quantity,
                      pc.market_minor, pc.avg30_minor,
                      row_number() OVER (PARTITION BY pc.currency_code
                        ORDER BY abs((pc.market_minor - pc.avg30_minor)::bigint * ci.quantity) DESC) AS rn
                 FROM collection_item ci
                 JOIN card_variant cv ON cv.id = ci.card_variant_id
                 JOIN card c          ON c.id = cv.card_id
                 JOIN price_current pc ON pc.card_variant_id = cv.id
                WHERE ci.user_id = $1 AND ci.quantity > 0
                  AND pc.market_minor IS NOT NULL AND pc.avg30_minor IS NOT NULL) t
            WHERE rn <= 5
            ORDER BY currency_code, rn`,
          [ctx.userId],
        );

        const lines: string[] = [`Collection value — estimates (best market price × qty, per currency)`];
        if (totals.length === 0) {
          lines.push('now: no owned variants carry a market price');
        } else {
          for (const t of totals) {
            const cur = t.currency_code.trim();
            lines.push(
              `now: ${money(Number(t.total_minor), cur)} ${cur} across ${nfmt(t.priced_variants)} priced owned variants (${nfmt(t.qty)} copies)`,
            );
          }
        }
        const unpriced = Number(unpricedRow?.unpriced ?? 0);
        if (unpriced > 0) lines.push(`unpriced: ${nfmt(unpriced)} owned variants have no market price in any currency (excluded, never $0)`);

        // first→last delta per currency within the window.
        const byCur = new Map<string, PointRow[]>();
        for (const pt of points) {
          const cur = pt.currency_code.trim();
          const arr = byCur.get(cur) ?? [];
          arr.push(pt);
          byCur.set(cur, arr);
        }
        if (byCur.size === 0) {
          lines.push(`change (${window}): no value snapshots in the window yet — the daily snapshot job populates collection_value_point`);
        } else {
          for (const [cur, pts] of byCur) {
            const first = pts[0];
            const last = pts[pts.length - 1];
            if (!first || !last || pts.length < 2) {
              lines.push(`change (${window}, ${cur}): only ${pts.length} snapshot in window — need 2+ for a delta`);
              continue;
            }
            const dMinor = Number(last.total_minor) - Number(first.total_minor);
            const pctTxt = Number(first.total_minor) > 0 ? ` (${dMinor >= 0 ? '+' : ''}${((dMinor / Number(first.total_minor)) * 100).toFixed(1)}%)` : '';
            lines.push(
              `change (${window}, ${cur}): ${dMinor >= 0 ? '+' : '-'}${money(Math.abs(dMinor), cur)}${pctTxt} — ${first.d} ${money(Number(first.total_minor), cur)} → ${last.d} ${money(Number(last.total_minor), cur)}`,
            );
          }
        }

        if (movers.length > 0) {
          lines.push('top movers per currency (owned, current market vs 30-day average — reference is always 30d):');
          for (const m of movers) {
            const cur = m.currency_code.trim();
            const change = (m.market_minor - m.avg30_minor) * m.quantity;
            const pctText = m.avg30_minor > 0 ? ` (${change >= 0 ? '+' : ''}${(((m.market_minor - m.avg30_minor) / m.avg30_minor) * 100).toFixed(1)}%)` : '';
            lines.push(
              '  ' +
                row(
                  m.name,
                  m.tcgdex_id,
                  m.variant_kind_code,
                  `x${m.quantity}`,
                  `${money(m.avg30_minor, cur)} avg → ${money(m.market_minor, cur)} now`,
                  `${change >= 0 ? '+' : '-'}${money(Math.abs(change), cur)}${pctText}`,
                ),
            );
          }
        } else {
          lines.push('top movers: none (no owned variant has both a market and a 30-day-average quote in any currency)');
        }
        return ok(lines.join('\n'));
      } catch (err) {
        return fail(`collection_value failed: ${errText(err)}`);
      }
    },
  );
}
