import type { ToolDefinition } from './registry.js';
import { catalogTools } from './tools/catalog.js';
import { collectionTools } from './tools/collection.js';
import { deckIntelTools } from './tools/deckIntel.js';
import { deckTools } from './tools/decks.js';
import { historyTools } from './tools/history.js';
import { listTools } from './tools/lists.js';
import { loggingTools } from './tools/logging.js';
import { shoppingTools } from './tools/shopping.js';
import { statusTools } from './tools/status.js';

/**
 * `@deckpal/agent-tools` — DeckPal's tool layer, with no protocol in it.
 *
 * This is what `apps/mcp/src/tools/` used to be. Nothing about the 23 tools was
 * ever MCP-specific except three details — the `McpServer` parameter on the
 * `register*Tools` signature, the `server.registerTool(...)` call shape, and
 * `ok()`/`fail()` returning MCP's `CallToolResult`. Those three now live in
 * `apps/mcp/src/adapters/mcp.ts` and nowhere else, so a second caller (Deck-E,
 * over the AI SDK) gets the same tools without a second copy of them.
 *
 * A tool is a {@link ToolDefinition}: name, title, description, zod
 * `inputSchema`, `annotations`, and a `handler(args, ctx)`. The handler takes
 * its context as an argument rather than closing over one, which is what lets
 * this single list serve every request for every user instead of being rebuilt
 * per call — see `registry.ts` for why that mattered.
 */

/**
 * Every tool, in registration order.
 *
 * The ORDER IS LOAD-BEARING and must not be tidied. `tools/list` returns tools
 * in registration order, and that order is what a model sees first; the
 * grouping below is the one the MCP server has always registered — status,
 * collection, catalog, decks, deck intelligence, lists, logging, shopping,
 * history.
 */
const ALL: ToolDefinition[] = [
  ...statusTools,
  ...collectionTools,
  ...catalogTools,
  ...deckTools,
  ...deckIntelTools,
  ...listTools,
  ...loggingTools,
  ...shoppingTools,
  ...historyTools,
];

/**
 * The whole tool catalogue.
 *
 * Returns a fresh array so a caller that sorts or filters in place cannot
 * reorder the shared list — the definitions themselves are shared and
 * stateless, which is the point.
 */
export function allTools(): ToolDefinition[] {
  return [...ALL];
}

// ── The shared surface every caller needs ────────────────────────────────────

export type { Ctx } from './ctx.js';
export { defineTool, type ToolAnnotations, type ToolDefinition } from './registry.js';
export { ok, type ToolResult } from './result.js';

export { apiBase, makeApi, type Api } from './api.js';
export { q, q1, type Queryable } from './db.js';

/**
 * Re-exported for `apps/api/src/decke/noOp.ts`, which has to resolve a deck
 * reference the same way the write tool does in order to ask whether a write
 * would change anything. Resolving it differently there — by trusting the id as
 * sent, say — would compare against a deck the write would not have touched.
 */
export { needDeck } from './entities.js';

/**
 * Re-exported because `apps/mcp/src/server.ts` backs the `collection://summary`
 * resource with the same text `collection_summary` returns (SPEC §5 resource),
 * and a resource is not a tool — it needs the function, not the definition.
 */
export { summaryText } from './tools/collection.js';

/**
 * Re-exported for `apps/mcp`, whose server-side `console.error` lines print a
 * caught `pg` error's message — built from the connection parameters, so it
 * carries the DSN precisely when the database is unreachable. AGENTS.md is
 * unconditional: secrets are never logged. `errText` is the tool-result form of
 * the same redaction and is deliberately lossy; a log wants the message with
 * the endpoint removed, not a bare SQLSTATE.
 */
export { redactEndpoints } from './shared.js';
