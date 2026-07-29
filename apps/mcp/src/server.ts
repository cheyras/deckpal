import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/server';
import type { Ctx } from './ctx.js';
import { registerCatalogTools } from './tools/catalog.js';
import { registerCollectionTools, summaryText } from './tools/collection.js';
import { registerDeckTools } from './tools/decks.js';
import { registerListTools } from './tools/lists.js';
import { registerLoggingTools } from './tools/logging.js';
import { registerStatusTools } from './tools/status.js';

const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

/**
 * Build a fresh McpServer wired to the shared, build-once context. Called by
 * createMcpHandler's factory on every request (stateless HTTP mode, SPEC §2):
 * registration is cheap, state lives in ctx.
 */
export function buildServer(ctx: Ctx): McpServer {
  const server = new McpServer({
    name: 'rotom-mcp',
    version: pkg.version,
    title: 'Rotom — pokedex collection assistant',
  });

  registerStatusTools(server, ctx);
  registerCollectionTools(server, ctx);
  registerCatalogTools(server, ctx);
  registerDeckTools(server, ctx);
  registerListTools(server, ctx);
  registerLoggingTools(server, ctx);

  // SPEC §5 resource: same payload as collection_summary, so clients can pull
  // collection context without a tool round-trip. summaryText lives in
  // tools/collection.ts (wave 2 fills in the real aggregation).
  server.registerResource(
    'collection-summary',
    'collection://summary',
    {
      title: 'Collection summary',
      description: 'Owned totals, estimated value, top cards, nearest-complete sets.',
      mimeType: 'text/plain',
    },
    async (uri) => ({ contents: [{ uri: uri.href, text: await summaryText(ctx) }] }),
  );

  return server;
}
