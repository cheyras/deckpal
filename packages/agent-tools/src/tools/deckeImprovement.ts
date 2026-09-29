import { z } from 'zod';
import { defineTool, type ToolDefinition } from '../registry.js';
import { fail, ok } from '../result.js';
import { errText } from '../shared.js';

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function value(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function listLine(raw: unknown): string {
  const item = object(raw);
  return [
    value(item.id),
    `${value(item.date)} UTC | last activity +${value(item.updatedOffsetMs)} ms`,
    `${value(item.turnCount)} turn(s)`,
    `build ${value(item.buildFirst)} → ${value(item.buildLast)}`,
    `cost ${value(item.costUsd)} USD (${value(item.costCoverage)})`,
    item.hasError === true ? 'HAS ERROR' : null,
  ].filter(Boolean).join(' | ');
}

function renderList(raw: unknown): string {
  const result = object(raw);
  const items = Array.isArray(result.items) ? result.items : [];
  const lines = items.map(listLine);
  lines.push(items.length === 0 ? 'No shared Deck-E conversations match.' : `returned ${items.length} conversation(s)`);
  if (typeof result.nextCursor === 'string') lines.push(`next_cursor: ${result.nextCursor}`);
  return lines.join('\n');
}

function renderSearch(raw: unknown): string {
  const result = object(raw);
  const items = Array.isArray(result.items) ? result.items : [];
  if (items.length === 0) return 'No shared Deck-E conversations match that query.';
  const lines = items.map((rawItem) => {
    const item = object(rawItem);
    const snippets = [item.snippet ?? item.text ?? item.match, item.askedSnippet, item.answeredSnippet]
      .filter((candidate) => candidate !== null && candidate !== undefined && candidate !== '')
      .map(String);
    const tools = Array.isArray(item.toolNames) && item.toolNames.length > 0
      ? ` | tools ${item.toolNames.map(String).join(', ')}`
      : '';
    return `${value(item.id ?? item.conversationId)} | turn ${value(item.seq)} | ${snippets.join(' … ') || '—'}${tools}`;
  });
  lines.push(`returned ${items.length} match(es)`);
  return lines.join('\n');
}

function renderDetail(raw: unknown, fromTurn: number, limit: number): string {
  const detail = object(raw);
  const conversation = object(detail.conversation);
  const allTurns = Array.isArray(detail.turns) ? detail.turns : [];
  const turns = allTurns.filter((rawTurn) => Number(object(rawTurn).seq) >= fromTurn).slice(0, limit);
  const lines = [
    `conversation ${value(conversation.id)}`,
    `date ${value(conversation.date)} UTC | last activity +${value(conversation.updatedOffsetMs)} ms | build ${value(conversation.buildFirst)} → ${value(conversation.buildLast)}`,
    `cost bucket ${value(conversation.costUsd)} USD (${value(conversation.costCoverage)}) | ${conversation.hasError === true ? 'HAS ERROR' : 'no recorded error'}`,
  ];
  for (const rawTurn of turns) {
    const turn = object(rawTurn);
    lines.push('', `TURN ${value(turn.seq)}`, `Reader: ${value(turn.asked)}`, `Deck-E: ${value(turn.answered)}`);
    if (turn.feedback !== null && turn.feedback !== undefined) {
      lines.push(`Feedback: ${Number(turn.feedback) > 0 ? 'thumbs up' : 'thumbs down'}${turn.feedbackComment ? ` — ${value(turn.feedbackComment)}` : ''}`);
    }
    if (turn.tokens) lines.push(`Token buckets: ${JSON.stringify(turn.tokens)} | turn cost bucket ${value(turn.costUsd)} USD (${value(turn.costCoverage)}) | duration bucket ${value(turn.durationMs)} ms`);
    const historyTools = Array.isArray(turn.tools) ? turn.tools : [];
    if (historyTools.length > 0) lines.push(`History tools: ${JSON.stringify(historyTools)}`);
    const legs = Array.isArray(turn.legs) ? turn.legs : [];
    for (const rawLeg of legs) {
      const leg = object(rawLeg);
      lines.push(
        `Leg ${value(leg.leg)} | ${value(leg.provider)}/${value(leg.modelId)} | ${value(leg.status)} | ` +
        `starts +${value(leg.startedOffsetMs)} ms | duration bucket ${value(leg.durationMs)} ms | cost bucket ${value(leg.costUsd)} USD | ` +
        `token buckets ${JSON.stringify(leg.tokens ?? {})}`,
      );
      const calls = Array.isArray(leg.toolCalls) ? leg.toolCalls : [];
      for (const call of calls) lines.push(`  tool ${JSON.stringify(call)}`);
      if (leg.error) lines.push(`  error ${JSON.stringify(leg.error)}`);
    }
    const events = Array.isArray(turn.events) ? turn.events : [];
    for (const event of events) lines.push(`  event ${JSON.stringify(event)}`);
  }
  const remaining = allTurns.filter((rawTurn) => Number(object(rawTurn).seq) >= fromTurn).length - turns.length;
  if (remaining > 0) {
    const last = object(turns.at(-1));
    lines.push('', `${remaining} later turn(s) omitted — call again with from_turn:${Number(last.seq) + 1}`);
  }
  return lines.join('\n');
}

const list = defineTool({
  name: 'decke_improvement_list',
  title: 'List shared Deck-E conversations',
  description: 'List explicitly shared, pseudonymised Deck-E conversations available to improvement readers. Filter by date, build, feedback, cost, errors, model or tool. Use next_cursor to continue.',
  inputSchema: z.object({
    from: z.string().optional().describe('Updated at or after this ISO 8601 timestamp.'),
    to: z.string().optional().describe('Updated before this ISO 8601 timestamp.'),
    build_sha: z.string().optional(),
    build_pr: z.number().int().optional(),
    vote: z.enum(['-1', '1']).optional(),
    min_cost: z.number().nonnegative().optional(),
    max_cost: z.number().nonnegative().optional(),
    has_error: z.boolean().optional(),
    model: z.string().optional(),
    tool: z.string().optional(),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(25),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true },
  handler: async (args, ctx) => {
    try {
      const params = new URLSearchParams();
      for (const [key, raw] of Object.entries(args)) {
        if (raw !== undefined && key !== 'cursor' && key !== 'limit') params.set(key, String(raw));
      }
      if (args.cursor) params.set('cursor', args.cursor);
      params.set('limit', String(args.limit));
      return ok(renderList(await ctx.api.get(`/admin/decke-improvement?${params.toString()}`)));
    } catch (error) {
      return fail(`decke_improvement_list failed: ${errText(error)}`);
    }
  },
});

const read = defineTool({
  name: 'decke_improvement_read',
  title: 'Read one shared Deck-E conversation',
  description: 'Read a compact transcript with turns, full redacted tool arguments and outputs, model legs, errors, relative timing, bucketed costs/tokens, feedback, approvals and animation/browser events. Results are paged by turn to keep agent context bounded.',
  inputSchema: z.object({
    id: z.string().uuid().describe('Pseudonymous conversation id from list or search.'),
    from_turn: z.number().int().nonnegative().default(0).describe('First turn sequence to include.'),
    limit: z.number().int().min(1).max(25).default(10).describe('Maximum turns to return (1–25).'),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true },
  handler: async (args, ctx) => {
    try {
      const detail = await ctx.api.get(`/admin/decke-improvement/${encodeURIComponent(args.id)}`);
      return ok(renderDetail(detail, args.from_turn, args.limit));
    } catch (error) {
      return fail(`decke_improvement_read failed: ${errText(error)}`);
    }
  },
});

const search = defineTool({
  name: 'decke_improvement_search',
  title: 'Search shared Deck-E conversations',
  description: 'Literal case-insensitive search across shared reader/Deck-E text and tool names. Returns bounded snippets and pseudonymous conversation ids.',
  inputSchema: z.object({
    query: z.string().min(2).max(100),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true },
  handler: async (args, ctx) => {
    try {
      const params = new URLSearchParams({ q: args.query, limit: String(args.limit) });
      return ok(renderSearch(await ctx.api.get(`/admin/decke-improvement/search?${params.toString()}`)));
    } catch (error) {
      return fail(`decke_improvement_search failed: ${errText(error)}`);
    }
  },
});

export const deckeImprovementTools: ToolDefinition[] = [list, read, search];
