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
import { registerListTools } from './tools/lists.js';
import { registerLoggingTools } from './tools/logging.js';
import { registerShoppingTools } from './tools/shopping.js';
import { registerStatusTools } from './tools/status.js';
import { registerSynthesisTools } from './tools/synthesis.js';

const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

// Server icon (Rotom on dark gray) advertised per MCP SEP-973 (spec 2025-11-25).
// claude.ai doesn't render custom-connector icons yet (shows a globe) — when it
// ships support, this is what appears. Read once at module load; the file lives
// in assets/ beside src/ and dist/, so resolve from this file's directory.
const iconDataUri: string | null = (() => {
  try {
    const p = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icon-128.png');
    return `data:image/png;base64,${readFileSync(p).toString('base64')}`;
  } catch {
    console.error('[deckscout-mcp] assets/icon-128.png missing — serving without an icon');
    return null;
  }
})();

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
    ...(iconDataUri
      ? { icons: [{ src: iconDataUri, mimeType: 'image/png', sizes: ['128x128'] }] }
      : {}),
  });

  registerStatusTools(server, ctx);
  registerCollectionTools(server, ctx);
  registerCatalogTools(server, ctx);
  registerDeckTools(server, ctx);
  registerDeckIntelTools(server, ctx);
  registerSynthesisTools(server, ctx);
  registerListTools(server, ctx);
  registerLoggingTools(server, ctx);
  registerShoppingTools(server, ctx);

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
