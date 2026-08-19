import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import type { Ctx } from './ctx.js';
import { registerCatalogTools } from './tools/catalog.js';
import { registerCollectionTools, summaryText } from './tools/collection.js';
import { registerDeckIntelTools } from './tools/deckIntel.js';
import { registerDeckTools } from './tools/decks.js';
import { registerHistoryTools } from './tools/history.js';
import { registerListTools } from './tools/lists.js';
import { registerLoggingTools } from './tools/logging.js';
import { registerShoppingTools } from './tools/shopping.js';
import { registerStatusTools } from './tools/status.js';

// package.json sits beside dist/ in the repo, but a serverless bundler only
// ships files it can see being read. If it did not make the bundle, advertise a
// version rather than failing to construct the server at all.
const version: string = (() => {
  try {
    return (createRequire(import.meta.url)('../package.json') as { version: string }).version;
  } catch {
    return '0.0.0';
  }
})();

// Server icon (the DeckPal mark on dark gray) advertised per MCP SEP-973 (spec 2025-11-25).
// claude.ai doesn't render custom-connector icons yet (shows a globe) — when it
// ships support, this is what appears. Read once at module load; the file lives
// in assets/ beside src/ and dist/, so resolve from this file's directory.
const iconDataUri: string | null = (() => {
  try {
    const p = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icon-128.png');
    return `data:image/png;base64,${readFileSync(p).toString('base64')}`;
  } catch {
    console.error('[deckpal-mcp] assets/icon-128.png missing — serving without an icon');
    return null;
  }
})();

/**
 * Build a fresh McpServer wired to a context. Called by createMcpHandler's
 * factory on every request (stateless HTTP mode, SPEC §2): registration is
 * cheap, state lives in ctx.
 *
 * The context is process-wide on self-host (one user, one pool) and
 * per-request in the cloud (the caller's token → their user id → their RLS
 * transaction client). Every tool registered below reads its identity from
 * `ctx` and never from module state, which is what makes the same 21 tools
 * safe to serve to one user or to thousands.
 */
export function buildServer(ctx: Ctx): McpServer {
  const server = new McpServer({
    name: 'deckpal-mcp',
    version,
    title: 'DeckPal — TCG collection assistant',
    ...(iconDataUri
      ? { icons: [{ src: iconDataUri, mimeType: 'image/png', sizes: ['128x128'] }] }
      : {}),
  });

  registerStatusTools(server, ctx);
  registerCollectionTools(server, ctx);
  registerCatalogTools(server, ctx);
  registerDeckTools(server, ctx);
  registerDeckIntelTools(server, ctx);
  registerListTools(server, ctx);
  registerLoggingTools(server, ctx);
  registerShoppingTools(server, ctx);
  registerHistoryTools(server, ctx);

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
