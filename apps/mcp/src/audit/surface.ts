import type { Ctx } from '@deckpal/agent-tools';
import type { ToolVisibility } from '../adapters/mcp.js';
import { connectInMemory } from './connect.js';

/**
 * What the tool surface costs a model before it has called anything.
 *
 * A client fetches `tools/list` once and (in every major client today) puts
 * the whole result in the model's context on every turn, next to the server
 * `instructions`. So the number that matters is the size of the JSON as it
 * goes over the wire, per tool and in total — not the size of the TypeScript
 * that declares it. This reads it back through the real SDK, exactly as a
 * client receives it.
 *
 * Token counts are an ESTIMATE: characters / 4, the usual rule of thumb for
 * English prose and JSON. Real tokenizers differ by model (schema JSON with
 * many short keys tokenizes worse than prose), so treat the column as a
 * relative measure for comparing tools and catching drift, not an exact cost.
 */

export interface SurfaceRow {
  name: string;
  readOnly: boolean;
  /** `description` characters. */
  description: number;
  /** `inputSchema` serialized as JSON, characters. */
  schema: number;
  /** The whole tools/list entry (name, title, description, schema, annotations), characters. */
  total: number;
  /** total / 4, rounded up. */
  tokens: number;
}

export interface Surface {
  rows: SurfaceRow[];
  /** The whole `tools/list` result, characters. */
  listChars: number;
  /** Server `instructions` from `initialize`, characters. */
  instructionsChars: number;
  /** Estimated tokens for tools/list + instructions together. */
  tokens: number;
}

export const estimateTokens = (chars: number): number => Math.ceil(chars / 4);

interface AdvertisedTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: { readOnlyHint?: boolean };
}

/**
 * `tools/list` and `initialize` as a client sees them. The ctx is never
 * touched — listing tools runs no handler — so any object will do.
 */
export async function measureSurface(options: ToolVisibility = {}, ctx: Ctx = {} as Ctx): Promise<Surface> {
  const conn = await connectInMemory(ctx, options);
  try {
    const reply = await conn.request('tools/list');
    if (reply.error) throw new Error(`tools/list failed: ${reply.error.message}`);
    const tools = (reply.result as { tools: AdvertisedTool[] }).tools;
    const rows = tools.map((tool): SurfaceRow => {
      const total = JSON.stringify(tool).length;
      return {
        name: tool.name,
        readOnly: tool.annotations?.readOnlyHint === true,
        description: (tool.description ?? '').length,
        schema: tool.inputSchema === undefined ? 0 : JSON.stringify(tool.inputSchema).length,
        total,
        tokens: estimateTokens(total),
      };
    });
    const listChars = JSON.stringify(reply.result).length;
    const instructionsChars = String(conn.init.instructions ?? '').length;
    return { rows, listChars, instructionsChars, tokens: estimateTokens(listChars + instructionsChars) };
  } finally {
    await conn.close();
  }
}

const pad = (s: string | number, n: number, right = false): string =>
  right ? String(s).padStart(n) : String(s).padEnd(n);

/** A fixed-width table for a terminal, widest tools first. */
export function renderSurface(surface: Surface): string {
  const rows = [...surface.rows].sort((a, b) => b.total - a.total);
  const w = Math.max(4, ...rows.map((r) => r.name.length));
  const lines = [
    `${pad('tool', w)}  ${pad('rw', 2)}  ${pad('desc', 6, true)}  ${pad('schema', 6, true)}  ${pad('entry', 6, true)}  ${pad('~tok', 5, true)}`,
    '-'.repeat(w + 37),
    ...rows.map((r) =>
      `${pad(r.name, w)}  ${pad(r.readOnly ? 'r' : 'w', 2)}  ${pad(r.description, 6, true)}  ${pad(r.schema, 6, true)}  ${pad(r.total, 6, true)}  ${pad(r.tokens, 5, true)}`),
    '-'.repeat(w + 37),
    `${pad(`${rows.length} tools`, w)}      ${pad(sum(rows, 'description'), 6, true)}  ${pad(sum(rows, 'schema'), 6, true)}  ${pad(sum(rows, 'total'), 6, true)}  ${pad(sum(rows, 'tokens'), 5, true)}`,
    '',
    `tools/list result: ${surface.listChars} chars (~${estimateTokens(surface.listChars)} tokens)`,
    `server instructions: ${surface.instructionsChars} chars (~${estimateTokens(surface.instructionsChars)} tokens)`,
    `per-turn context cost (list + instructions): ~${surface.tokens} tokens (chars/4 estimate)`,
  ];
  return lines.join('\n');
}

function sum(rows: SurfaceRow[], key: 'description' | 'schema' | 'total' | 'tokens'): number {
  return rows.reduce((n, r) => n + r[key], 0);
}
