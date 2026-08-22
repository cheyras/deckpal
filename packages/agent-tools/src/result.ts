/**
 * The house tool-result envelope, made protocol-neutral.
 *
 * This is `apps/mcp/src/envelope.ts` with the MCP shape taken out of it. That
 * file returned a `CallToolResult` — `{ content: [{ type: 'text', text }],
 * structuredContent? }` — which is the MCP wire type, and it was the single
 * reason 23 otherwise protocol-agnostic tool handlers had to know that MCP
 * existed at all. Every handler still wraps its body in try/catch and returns
 * one of these two shapes; it just no longer says so in MCP's vocabulary.
 *
 * The translation back to `CallToolResult` lives in exactly one place,
 * `apps/mcp/src/adapters/mcp.ts`, and a second adapter (the AI SDK one Deck-E
 * needs) can render the same value its own way without either adapter knowing
 * about the other.
 *
 * `structured` is the old `structuredContent` under a name that does not
 * presuppose a transport. It is optional everywhere and no tool depends on the
 * caller reading it — it is a machine-readable echo of the text, not a
 * replacement for it.
 */

export interface ToolResult {
  /** The compact, human/model-readable body. Always present (SPEC §4). */
  text: string;
  /** Optional machine-readable echo — MCP renders it as `structuredContent`. */
  structured?: Record<string, unknown>;
  /** True when the tool failed. Handlers never throw to the transport. */
  isError?: boolean;
}

export function ok(text: string, structured?: Record<string, unknown>): ToolResult {
  return {
    text,
    ...(structured !== undefined ? { structured } : {}),
  };
}

export function fail(message: string): ToolResult {
  return { isError: true, text: message };
}
