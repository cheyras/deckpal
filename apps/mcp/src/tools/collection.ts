import type { McpServer } from '@modelcontextprotocol/server';
import type { Ctx } from '../ctx.js';

// implemented by wave 2 — collection_summary, search_cards (owned side),
// collection_log, collection_value (SPEC §5 #2, #6, #7).
export function registerCollectionTools(_server: McpServer, _ctx: Ctx): void {
  // no tools yet
}

/**
 * Text payload shared by the `collection_summary` tool and the
 * `collection://summary` resource (SPEC §5 resource).
 *
 * implemented by wave 2 — this placeholder keeps the resource registered and
 * well-formed until the real aggregation lands.
 */
export async function summaryText(_ctx: Ctx): Promise<string> {
  return 'collection_summary is not implemented yet (wave 2 fills this in).';
}
