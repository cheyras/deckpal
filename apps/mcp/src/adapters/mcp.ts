import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import { allTools, type Ctx, type ToolDefinition, type ToolResult } from '@deckpal/agent-tools';

/**
 * The MCP adapter — the ONLY place in DeckPal that knows the tool layer is
 * being spoken to over MCP.
 *
 * Everything here used to be spread across nine `tools/*.ts` modules: each one
 * imported `McpServer` for its `register*Tools(server, ctx)` signature, called
 * `server.registerTool(...)` per tool, and returned MCP's `CallToolResult` from
 * `ok()`/`fail()`. That is three protocol details and no more — the other
 * ~4,000 lines were SQL, REST calls and text rendering. Collapsing those three
 * into this file is what let the tools move to `@deckpal/agent-tools` unchanged,
 * and it is what lets a second adapter exist without a second copy of them.
 */

/**
 * `ToolResult` → MCP's wire result.
 *
 * `text` becomes the single text content block and `isError` passes through.
 * **`structured` deliberately does NOT become `structuredContent`.** That needs
 * the paragraph below, because it used to and the change is a visible one.
 *
 * ── WHY `structuredContent` IS NOT SENT ──────────────────────────────────────
 *
 * Eleven tools pass a second argument to `ok()` — `search_cards`, `get_card`,
 * `set_progress`, `collection_log`, `mutation_history`, `health` and the rest.
 * Every one of those was answering a client with its METADATA AND NOTHING ELSE.
 * Observed directly, 2026-08-23, against production:
 *
 *   search_cards("charizard")  →  {"total":125,"page":1,"pageSize":3}
 *   get_card("me05-084")       →  {"cardId":"me05-084","variantCount":3}
 *   set_progress("me05")       →  {"set":"me05","goal":"complete","missing":50}
 *
 * Not one card, in the tool the whole catalogue is searched through. Meanwhile
 * `decks`, `lists`, `battle_logs`, `deck_history` and `collection_summary` —
 * the five that pass no metadata — returned their full rendered text. Same
 * client, same session, same round trip. The presence of `structuredContent`
 * is the only variable.
 *
 * **The server was not at fault and neither is the SDK.** `projectCallToolResult`
 * in `@modelcontextprotocol/server` only ever APPENDS to `content`; it has no
 * path that drops it. Both blocks went out on the wire. A client is then free to
 * decide which one it shows, and at least one major one shows the structured
 * half — reasonably, since `structuredContent` normally travels with an
 * `outputSchema` that says what it means.
 *
 * **No tool here declares an `outputSchema`.** So the structured payload was
 * unlabelled, unvalidated, and a client had nothing to interpret it with.
 *
 * ── AND NOTHING IS LOST BY DROPPING IT ───────────────────────────────────────
 *
 * Every field any of the eleven put in there is ALREADY IN THE TEXT: the paging
 * numbers come from `pagingFooter`, `missing` from the "missing for 'complete'
 * (50)" line, `cardId`/`variantCount` from the identity and variant lines. It
 * was pure redundancy, and the redundancy was costing the answer.
 *
 * The INTERNAL `ToolResult.structured` is untouched and still carries data —
 * Deck-E's AI-SDK adapter reads it to render `log_cards` rows
 * (`apps/api/src/decke/adapters/aisdk.ts`). That path never goes near MCP and
 * was never affected by this; Deck-E has always received `result.text` in full.
 *
 * **If it comes back, it comes back with an `outputSchema`**, so a client knows
 * what it is holding and the text is not competing with an unlabelled blob.
 */
export function toCallToolResult(result: ToolResult): CallToolResult {
  return {
    content: [{ type: 'text', text: result.text }],
    ...(result.isError ? { isError: true } : {}),
  };
}

/**
 * Register every tool on a fresh `McpServer`.
 *
 * The two branches are not stylistic. The SDK's callback signature depends on
 * whether a config carries an `inputSchema`: with one the handler is called as
 * `(args, serverCtx)`, without one as `(serverCtx)` — the FIRST argument is the
 * server context, not an empty args object. `health` is the no-argument tool
 * (SPEC §5 #1), so registering it through the with-args branch would hand its
 * handler the server context in the position where it expects its arguments.
 * Branching on `inputSchema` keeps that impossible rather than merely unlikely.
 *
 * `inputSchema` and `annotations` are passed through by reference — the same
 * zod object and the same annotations record the tools have always declared —
 * so the advertised schema in `tools/list` is unchanged by the move.
 */
export function registerAllTools(server: McpServer, ctx: Ctx): void {
  for (const tool of allTools()) {
    register(server, ctx, tool);
  }
}

function register(server: McpServer, ctx: Ctx, tool: ToolDefinition): void {
  const base = {
    title: tool.title,
    description: tool.description,
    annotations: tool.annotations,
  };

  if (tool.inputSchema === undefined) {
    server.registerTool(tool.name, base, async () => toCallToolResult(await tool.handler({}, ctx)));
    return;
  }

  server.registerTool(
    tool.name,
    { ...base, inputSchema: tool.inputSchema },
    async (args) => toCallToolResult(await tool.handler(args, ctx)),
  );
}
