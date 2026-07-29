import type { McpServer } from '@modelcontextprotocol/server';
import type { Ctx } from '../ctx.js';

// implemented by wave 2 — log_cards, THE write tool (SPEC §5 #14), via
// pokedex-api collection routes with source:'rotom-mcp' (needs migration 018).
export function registerLoggingTools(_server: McpServer, _ctx: Ctx): void {
  // no tools yet
}
