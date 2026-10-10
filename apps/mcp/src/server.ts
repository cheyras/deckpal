import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import { summaryText, type Ctx } from '@deckpal/agent-tools';
import { registerAllTools, type ToolVisibility } from './adapters/mcp.js';
import { PROMPTS, SERVER_INSTRUCTIONS, promptArgsSchema } from './guidance.js';

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

// buildServer runs per request in the cloud, so the prompt schemas are built
// once here and shared by reference — as the tools' zod inputSchemas are.
const PROMPT_ARGS = PROMPTS.map((prompt) => [prompt, promptArgsSchema(prompt)] as const);

/**
 * Build a fresh McpServer wired to a context. Called by createMcpHandler's
 * factory on every request (stateless HTTP mode, SPEC §2): registration is
 * cheap, state lives in ctx.
 *
 * The context is process-wide on self-host (one user, one pool) and
 * per-request in the cloud (the caller's token → their user id → their RLS
 * transaction client). Every tool registered below reads its identity from
 * `ctx` and never from module state, which is what makes the same tool set
 * safe to serve to one user or to thousands.
 */
export function buildServer(ctx: Ctx, options: ToolVisibility = {}): McpServer {
  const server = new McpServer(
    {
      name: 'deckpal-mcp',
      version,
      title: 'DeckPal — TCG collection assistant',
      ...(iconDataUri
        ? { icons: [{ src: iconDataUri, mimeType: 'image/png', sizes: ['128x128'] }] }
        : {}),
    },
    // ServerOptions.instructions (@modelcontextprotocol/server 2.1): the SDK
    // returns it from `initialize` and from 2026-era `server/discover`, and
    // clients such as claude.ai place it in the model's system prompt. It is
    // the only guidance a connector client gets on every turn (2026-10-10:
    // before it, battle logs arrived with no debrief and no review). See
    // guidance.ts for what it says and why it stays under 4,000 characters.
    { instructions: SERVER_INSTRUCTIONS },
  );

  // Nine register*Tools calls used to stand here, one per tools/ module, in
  // exactly this order. They are now one call: the tool definitions live in
  // @deckpal/agent-tools and the adapter walks allTools() in registration
  // order, which is the order tools/list reports and therefore the order a
  // model reads them in. Adding a tool no longer means editing this file.
  registerAllTools(server, ctx, options);

  // Prompts (2026-10-10). A connector client never receives Deck-E's routed
  // pathway texts, so the judgment that must hold on every turn travels as
  // the `instructions` above, and these four give a person an explicit way in
  // to the longer playbooks (log a battle, review results, build a deck, plan
  // a set). Registering them makes the SDK advertise the `prompts` capability
  // and answer prompts/list and prompts/get; the tool catalogue is untouched.
  for (const [prompt, argsSchema] of PROMPT_ARGS) {
    server.registerPrompt(
      prompt.name,
      { title: prompt.title, description: prompt.description, argsSchema },
      (args) => ({
        messages: [{
          role: 'user' as const,
          content: { type: 'text' as const, text: prompt.render(args) },
        }],
      }),
    );
  }

  // SPEC §5 resource: same payload as collection_summary, so clients can pull
  // collection context without a tool round-trip. summaryText is exported by
  // @deckpal/agent-tools — a resource is not a tool, so it needs the function
  // rather than a ToolDefinition.
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
