/**
 * `ToolDefinition` → the AI SDK's `tool()`. The other front-end onto the same
 * 23 tools the MCP server exposes.
 *
 * `apps/mcp/src/adapters/mcp.ts` is this file's sibling and its mirror: same
 * definitions, different protocol. A tool added for Claude appears for Deck-E in
 * the same commit, because there is now only one place a tool can be added.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * The tool layer is not the magic, and wiring it alone would make things worse
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Worth saying here, where someone will read it while adding a tool: the MCP
 * server is a data layer and a filing cabinet. There is no intelligence in it.
 * `deck_strategy`'s whole contract is "pass markdown to REPLACE the whole
 * guide" — it STORES a strategy guide, it does not write one.
 *
 * So porting the tools without also routing the thinking (`models.ts`) produces
 * a well-informed version of the same disappointment: he reads 604 cards
 * correctly and then has a fast model write the deck plan. The two are one
 * deliverable. Neither ships alone.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * READ TOOLS ONLY, until the approval flow exists
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `include` defaults to read-only. The write half is gated on the SDK's native
 * approval round-trip, and until that is built, a write tool reachable from a
 * conversational model is a tool that will eventually be called by accident.
 *
 * The filter is on `annotations.readOnlyHint` and NEVER on the verb in the
 * name. That distinction is load-bearing: `set_cart` sounds like a write and
 * only composes an outbound URL; `deck_history` sounds like a read and can roll
 * a deck back.
 */
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { allTools, type Ctx, type ToolDefinition, type ToolResult } from '@deckpal/agent-tools';
import { withToolCtx, type ToolCtxOptions } from '../ctx.js';

/**
 * A tool-call lifecycle event, for the chip the reader sees.
 *
 * Work is currently indistinguishable from theatre: `thinking` is driven by
 * request latency, so a fabricated answer and a real one look exactly the same
 * while they are being produced. These events are what make the difference
 * visible.
 *
 * EMITTED FROM HERE, not from the model. A chip the model could ask for would
 * be a second surface to fabricate on — "Checking your collection…" with no
 * lookup behind it is strictly worse than no chip, because it manufactures
 * evidence. Every chip corresponds 1:1 to a real invocation of a real handler,
 * by construction, because this is the only code that emits one.
 */
export type ToolEvent =
  | { phase: 'start'; id: string; name: string; title: string }
  | { phase: 'ok'; id: string; name: string; title: string; summary: string }
  | { phase: 'error'; id: string; name: string; title: string; summary: string };

export interface AiSdkAdapterOptions extends ToolCtxOptions {
  /**
   * Which tools to expose. Defaults to every read-only tool.
   *
   * Pass a narrower list to give a sub-agent a subset — a research sub-agent
   * must never hold a write tool, and the way to guarantee that is to not hand
   * it one.
   */
  include?: (def: ToolDefinition) => boolean;
  /** Receives the lifecycle events above. Optional; the chips are a UI concern. */
  onEvent?: (e: ToolEvent) => void;
  /**
   * Character budget for one tool's output. See `clamp` below.
   * `0` disables truncation — for the analysis tier, which wants everything.
   */
  maxChars?: number;
}

/**
 * How much tool output one call may put into the model's context.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS (spec §8.7)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The MCP's prose was written for Claude's context window and for human pacing
 * — a person reads a 200-row page and scrolls. `search_cards` pages to 200
 * rows; `set_progress` can list every missing card in a set. Twelve steps of
 * that into a fast conversational model, on every turn, is both a quality
 * problem and a cost problem, and the cost one is the sort that is invisible
 * until someone reads `usage`.
 *
 * So the CHAT tier gets a ceiling and the analysis tier does not. 6,000
 * characters is roughly 1,500 tokens — enough for a full `collection_summary`
 * or a couple of dozen card rows, and far short of a 200-row dump.
 *
 * TRUNCATION IS ANNOUNCED, never silent. A model handed a quietly cut list will
 * describe it as the whole list, which is the same failure mode as everything
 * else being fixed here: a confident statement about data that was not actually
 * seen. The replacement text tells him what happened and what to do about it,
 * in words he can also say out loud.
 */
export const DEFAULT_MAX_TOOL_CHARS = 6_000;

export function clampToolText(text: string, maxChars: number): string {
  if (maxChars <= 0 || text.length <= maxChars) return text;
  // Cut on a line boundary. Half a row reads as data and is not.
  const cut = text.lastIndexOf('\n', maxChars);
  const head = text.slice(0, cut > maxChars * 0.5 ? cut : maxChars);
  const shownLines = head.split('\n').length;
  const totalLines = text.split('\n').length;
  return (
    `${head}\n\n[Cut off here: showing ${shownLines} of ${totalLines} lines. ` +
    `This is NOT the whole result — do not describe it as complete. ` +
    `Narrow the search, or ask for the next page.]`
  );
}

/** One-line summary of what a tool actually returned, for its chip. */
function summarise(result: ToolResult): string {
  const first = result.text.split('\n', 1)[0] ?? '';
  return first.length > 120 ? `${first.slice(0, 117)}…` : first;
}

/**
 * Build the AI SDK tool set.
 *
 * Every `execute` is wrapped so that a tool CANNOT throw into the stream. A
 * thrown tool kills the turn; a returned error is a sentence the model can
 * react to and recover from — "that lookup timed out, want me to try a narrower
 * search?" is a usable answer and a stack trace is not. This is the same
 * reasoning `runUiTool` carries on the browser side.
 */
export function buildDataTools(opts: AiSdkAdapterOptions): ToolSet {
  const include = opts.include ?? ((d: ToolDefinition) => d.annotations.readOnlyHint);
  const maxChars = opts.maxChars ?? DEFAULT_MAX_TOOL_CHARS;
  const out: ToolSet = {};

  for (const def of allTools()) {
    if (!include(def)) continue;

    out[def.name] = tool({
      description: def.description,
      // The tools' own zod objects, unchanged. `health` genuinely has no
      // schema; the SDK requires one, so it gets an empty object — which is
      // what the MCP wire already advertises for it anyway.
      inputSchema: def.inputSchema ?? z.object({}),
      execute: async (args: unknown, { toolCallId }) => {
        const chip = { id: toolCallId, name: def.name, title: def.title };
        opts.onEvent?.({ phase: 'start', ...chip });
        try {
          const result = await withToolCtx(opts, (ctx: Ctx) => def.handler(args, ctx));
          const text = clampToolText(result.text, maxChars);
          opts.onEvent?.({
            phase: result.isError ? 'error' : 'ok',
            ...chip,
            summary: summarise(result),
          });
          return text;
        } catch (err) {
          // A message, not an object: this string goes straight into the
          // model's context, and it should read like something that happened
          // rather than like a serialised exception.
          const message = err instanceof Error ? err.message : String(err);
          opts.onEvent?.({ phase: 'error', ...chip, summary: message });
          return `That did not work: ${message}`;
        }
      },
    });
  }

  return out;
}

/**
 * The same list, as `{name, title}` for the system prompt.
 *
 * Generated from the definitions rather than typed into the prompt, so a tool
 * that is added, removed or renamed cannot leave the prompt describing a
 * capability he does not have — which is precisely how he came to spend every
 * turn offering to look things up with no tool that could look.
 */
export function dataToolSummary(opts?: {
  include?: (def: ToolDefinition) => boolean;
}): { name: string; title: string }[] {
  const include = opts?.include ?? ((d: ToolDefinition) => d.annotations.readOnlyHint);
  return allTools()
    .filter(include)
    .map((d) => ({ name: d.name, title: d.title }));
}
