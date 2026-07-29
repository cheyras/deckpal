import type { McpServer } from '@modelcontextprotocol/server';
import type { Ctx } from '../ctx.js';

// implemented by wave 2 — lists, edit_list, delete_list (SPEC §5 #11–#13),
// all via pokedex-api routes (apps/api/src/routes/lists.ts is the contract).
export function registerListTools(_server: McpServer, _ctx: Ctx): void {
  // no tools yet
}
