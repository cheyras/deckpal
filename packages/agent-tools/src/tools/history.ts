import { z } from 'zod';
import { defineTool, type ToolDefinition } from '../registry.js';
import { fail, ok } from '../result.js';
import { row } from '../format.js';

/**
 * `mutation_history` and `revert` — SPEC §5 #22/#23.
 *
 * Every mutating tool in this server now writes a batch to the mutation log
 * (migration 036) with a before/after snapshot per changed thing. These two
 * tools are what make that log useful to an agent: one reads it, the other
 * undoes it.
 *
 * They exist because of a real incident. On 2026-08-19 `log_cards` reported a
 * connector error three times while every write committed, and recovering meant
 * an agent hand-deriving 92 corrective deltas from `collection_log` under time
 * pressure, cross-referencing three separate dry-run outputs to work out how
 * many times each card had actually been written. None of that should be
 * required. "Show me what that operation did" and "undo it" are one call each.
 *
 * `revert` follows the house pattern: dry_run defaults to true and prints the
 * exact diff first. What it adds is honesty about the cases where an exact undo
 * is not available — a change that clamped at zero, or a later absolute-quantity
 * assertion on the same card — which it reports as conflicts rather than
 * quietly applying something that looks right and is not.
 */

const stampOf = (v: unknown): string => {
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : `${d.toISOString().slice(0, 16).replace('T', ' ')}Z`;
};

interface BatchSummary {
  batchId: string;
  source: string;
  tool: string;
  note: string | null;
  status: string;
  idempotencyKey: string | null;
  revertsBatchId: string | null;
  summary: { applied?: number; items?: number; sets?: number } | null;
  startedAt: string;
  finishedAt: string | null;
  eventCount: number;
  revertedEventCount: number;
}

interface EventDetail {
  eventId: number;
  entityType: string;
  entityId: string;
  operation: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  requestedDelta: number | null;
  effectiveDelta: number | null;
  clamped: boolean;
  undoneByEventId: number | null;
  occurredAt: string;
}

interface PlanEntry {
  eventId: number;
  entityType: string;
  entityId: string;
  operation: string;
  action: string;
  from?: number;
  to?: number;
  delta?: number;
  conflicts: string[];
  exact: boolean;
  skipped?: string;
}

function batchLine(b: BatchSummary): string {
  const undone = b.revertedEventCount > 0 ? `${b.revertedEventCount}/${b.eventCount} undone` : null;
  return row(
    stampOf(b.startedAt),
    b.tool,
    b.source,
    `${b.eventCount} change(s)`,
    undone,
    b.note,
    b.revertsBatchId ? `reverts ${b.revertsBatchId.slice(0, 8)}` : null,
    b.batchId,
  );
}

function eventLine(e: EventDetail): string {
  const qty =
    e.before && e.after && 'quantity' in e.before && 'quantity' in e.after
      ? `${String(e.before.quantity)} → ${String(e.after.quantity)}`
      : null;
  return row(
    `#${e.eventId}`,
    e.entityType,
    e.entityId,
    e.operation,
    qty,
    e.clamped ? 'CLAMPED (no exact undo)' : null,
    e.undoneByEventId ? `undone by #${e.undoneByEventId}` : null,
  );
}

const mutationHistoryTool = defineTool({
  name: 'mutation_history',
  title: 'What changed, and which operation changed it',
  description:
    'The audit trail of every CHANGE made through DeckPal — collection quantities, lists, ' +
    'decks, strategy guides — grouped by the operation that made them, newest first. Each ' +
    'operation carries who wrote it (web UI, deckpal-mcp, an import), an optional note, and ' +
    'a before/after snapshot per thing it touched. Filter by time, source, tool, note text, ' +
    'or a specific card/list/deck. Pass batch_id to see one operation in full. This is how ' +
    'you answer "what did that call actually do?" and it is the input to revert. For ' +
    'collection quantities only, collection_log is a flatter view of the same events.',
  inputSchema: z.object({
    batch_id: z
      .string()
      .optional()
      .describe('Show ONE operation and every change in it. From a previous mutation_history call or a log_cards result.'),
    since: z.string().optional().describe("Only operations at/after this ISO 8601 timestamp, e.g. '2026-08-19T02:00:00Z'."),
    until: z.string().optional().describe('Only operations at/before this ISO 8601 timestamp.'),
    source: z.string().optional().describe("Only operations written by this source, e.g. 'web', 'deckpal-mcp'."),
    tool: z
      .string()
      .optional()
      .describe("Only this operation type, e.g. 'collection.batch', 'list.delete', 'revert'."),
    note: z.string().optional().describe('Only operations whose note contains this text (case-insensitive substring).'),
    entity_type: z
      .enum(['collection_item', 'card_list', 'list_item', 'deck', 'deck_card', 'deck_strategy', 'battle_log'])
      .optional()
      .describe('Only operations that touched this kind of thing.'),
    entity_id: z
      .string()
      .optional()
      .describe('Only operations that touched this exact thing (a numeric card_variant id, or a list/deck UUID).'),
    limit: z.number().int().min(1).max(200).default(25).describe('Operations per page (1–200, default 25).'),
    page: z.number().int().min(1).default(1).describe('Page number, 1-based.'),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true },
  handler: async (args, ctx) => {
    try {
      if (args.batch_id) {
        const r = (await ctx.api.get(`/mutations/${encodeURIComponent(args.batch_id)}`)) as {
          batch: BatchSummary;
          events: EventDetail[];
        };
        const lines = [batchLine(r.batch), `${r.events.length} change(s):`];
        for (const e of r.events) lines.push('  ' + eventLine(e));
        const undoable = r.events.filter((e) => e.undoneByEventId === null).length;
        lines.push(
          undoable > 0
            ? `undo this whole operation with revert(batch_id: "${r.batch.batchId}") — dry run first, as always`
            : 'every change in this operation has already been reverted',
        );
        return ok(lines.join('\n'), { batch: r.batch, eventCount: r.events.length });
      }

      const params = new URLSearchParams();
      if (args.since) params.set('since', args.since);
      if (args.until) params.set('until', args.until);
      if (args.source) params.set('source', args.source);
      if (args.tool) params.set('tool', args.tool);
      if (args.note) params.set('note', args.note);
      if (args.entity_type) params.set('entity_type', args.entity_type);
      if (args.entity_id) params.set('entity_id', args.entity_id);
      params.set('limit', String(args.limit));
      params.set('page', String(args.page));

      const r = (await ctx.api.get(`/mutations?${params.toString()}`)) as {
        total: number;
        page: number;
        pageSize: number;
        batches: BatchSummary[];
      };
      if (r.total === 0) {
        return ok(
          'No operations match. Note that the mutation log starts at the 2026-08-19 release — changes made before ' +
            'that are only in collection_log, which covers collection quantities and nothing else.',
        );
      }
      const lines = r.batches.map(batchLine);
      const from = (r.page - 1) * r.pageSize + 1;
      const to = Math.min(r.page * r.pageSize, r.total);
      lines.push(
        `showing ${from}–${to} of ${r.total}` +
          (to < r.total ? ` — page ${r.page + 1} for more` : '') +
          '. Pass batch_id for one operation in full.',
      );
      return ok(lines.join('\n'), { total: r.total, page: r.page, returned: r.batches.length });
    } catch (err) {
      return fail(`mutation_history failed: ${(err as Error).message}`);
    }
  },
});

const revertTool = defineTool({
  name: 'revert',
  title: 'Undo a change',
  description:
    'Undo something DeckPal did: a whole operation (batch_id), one change (event_id), ' +
    'everything since a moment (since), or every change to one card/list/deck (entity_type ' +
    '+ entity_id). Defaults to a DRY RUN that prints the exact before → after for each item ' +
    'and changes nothing — re-call with dry_run:false to apply. Quantities are undone by ' +
    'applying the opposite change, so unrelated later edits survive; pass strategy:"restore" ' +
    'to force the old value back instead. Where an exact undo is impossible (the original ' +
    'change hit the zero floor, or a later call asserted an absolute quantity for that card) ' +
    'the item is reported as a CONFLICT and skipped rather than half-applied. The revert is ' +
    'itself logged, so it can be reverted. Use mutation_history first to find what to undo.',
  inputSchema: z.object({
    batch_id: z.string().optional().describe('Undo this whole operation (from mutation_history or a log_cards result).'),
    event_id: z.number().int().positive().optional().describe('Undo one single change.'),
    since: z.string().optional().describe("Undo every change at/after this ISO 8601 timestamp, e.g. '2026-08-19T02:00:00Z'."),
    until: z.string().optional().describe('With since: stop at this timestamp.'),
    filter_source: z
      .string()
      .optional()
      .describe(
        "With since: only undo changes written by this source, e.g. 'web' or 'deckpal-mcp'. Omit to undo " +
          'EVERYTHING in the window regardless of who wrote it.',
      ),
    entity_type: z
      .enum(['collection_item', 'card_list', 'list_item', 'deck', 'deck_strategy'])
      .optional()
      .describe('With entity_id: undo changes to one thing.'),
    entity_id: z.string().optional().describe('The card_variant id (numeric) or list/deck UUID to roll back.'),
    at: z.string().optional().describe('With entity_type + entity_id: roll that one thing back to how it was at this time.'),
    strategy: z
      .enum(['inverse', 'restore'])
      .default('inverse')
      .describe(
        "inverse (default): apply the opposite change, leaving unrelated later edits alone. restore: force the value " +
          'back to what it was, discarding anything that happened since.',
      ),
    force: z
      .boolean()
      .default(false)
      .describe('Apply items that have conflicts, or re-undo something already undone. Read the dry run first.'),
    note: z.string().max(500).optional().describe('Note stored on the revert operation itself.'),
    dry_run: z.boolean().default(true).describe('true (default): show the exact diff, change nothing. false: apply.'),
  }),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  handler: async (args, ctx) => {
    try {
      const targets = [args.batch_id, args.event_id, args.since, args.entity_id].filter((x) => x !== undefined);
      if (targets.length === 0) {
        return fail('Pass one of: batch_id, event_id, since, or entity_type + entity_id. Use mutation_history to find them.');
      }
      if (targets.length > 1) {
        return fail('Pass exactly ONE of batch_id, event_id, since, or entity_id — they mean different things.');
      }
      if (args.entity_id && !args.entity_type) return fail('entity_id needs entity_type.');

      const body: Record<string, unknown> = {
        strategy: args.strategy,
        force: args.force,
        dryRun: args.dry_run,
        source: 'deckpal-mcp',
      };
      if (args.batch_id) body.batchId = args.batch_id;
      if (args.event_id) body.eventId = args.event_id;
      if (args.since) body.since = args.since;
      if (args.until) body.until = args.until;
      if (args.filter_source) body.filterSource = args.filter_source;
      if (args.entity_type) body.entityType = args.entity_type;
      if (args.entity_id) body.entityId = args.entity_id;
      if (args.at) body.at = args.at;
      if (args.note) body.note = args.note;

      const r = (await ctx.api.send('POST', '/mutations/revert', body)) as {
        dryRun: boolean;
        label: string;
        strategy: string;
        plan: PlanEntry[];
        applied: number;
        wouldApply?: number;
        skipped: number;
        conflicts: number;
        batchId: string | null;
      };

      if (r.plan.length === 0) {
        return ok(`Nothing to undo for ${r.label} — no changes matched.`);
      }

      const lines: string[] = [
        `${r.dryRun ? 'revert DRY RUN' : 'revert'} — ${r.label} (strategy: ${r.strategy})`,
      ];
      for (const p of r.plan) {
        const head = row(`#${p.eventId}`, p.entityType, p.entityId, p.action);
        if (p.skipped) {
          lines.push(`  ✗ ${head}`);
          lines.push(`      skipped: ${p.skipped}`);
        } else if (p.conflicts.length > 0) {
          lines.push(`  ⚠ ${head}`);
          for (const c of p.conflicts) lines.push(`      conflict: ${c}`);
        } else {
          lines.push(`  ${r.dryRun ? '·' : '✓'} ${head}`);
        }
      }

      if (r.dryRun) {
        lines.push(`would undo ${r.wouldApply ?? 0}, ${r.conflicts} conflict(s), ${r.skipped} skipped`);
        lines.push(
          r.conflicts > 0
            ? 'dry run — nothing changed. Re-call with dry_run:false to apply the clean items; add force:true to apply the conflicted ones too.'
            : 'dry run — nothing changed. Re-call with dry_run:false to apply.',
        );
      } else {
        lines.push(`undid ${r.applied}, ${r.conflicts} conflict(s) left alone, ${r.skipped} skipped`);
        if (r.batchId) lines.push(`this revert is itself operation ${r.batchId} — revert(batch_id: "${r.batchId}") undoes it`);
      }
      return ok(lines.join('\n'), {
        dryRun: r.dryRun,
        applied: r.applied,
        conflicts: r.conflicts,
        skipped: r.skipped,
        batchId: r.batchId,
      });
    } catch (err) {
      return fail(`revert failed: ${(err as Error).message}`);
    }
  },
});

export const historyTools: ToolDefinition[] = [
  mutationHistoryTool,
  revertTool,
];
