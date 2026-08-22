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
 * The shapes are deliberately close: `text` becomes the single text content
 * block, `structured` becomes `structuredContent`, `isError` passes through.
 * `structuredContent` is only emitted when the tool actually produced one —
 * emitting `undefined` and emitting nothing are different on the wire for a
 * client that inspects the key.
 */
export function toCallToolResult(result: ToolResult): CallToolResult {
  return {
    content: [{ type: 'text', text: result.text }],
    ...(result.structured !== undefined ? { structuredContent: result.structured } : {}),
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
