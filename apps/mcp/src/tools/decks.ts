import type { McpServer } from '@modelcontextprotocol/server';
import type { Ctx } from '../ctx.js';

// implemented by wave 2 — decks, save_deck, delete_deck (SPEC §5 #8–#10),
// all via pokedex-api routes (apps/api/src/routes/decks.ts is the contract).
export function registerDeckTools(_server: McpServer, _ctx: Ctx): void {
  // no tools yet
}
