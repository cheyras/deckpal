/**
 * Vercel serverless function entry point for the MCP server.
 *
 * `/mcp` is rewritten here by vercel.json. The Express app it mounts is the
 * multi-user (per-token) face of deckpal-mcp — see apps/mcp/src/cloud.ts. The
 * self-host server (apps/mcp/src/index.ts, shared-key, single-user) is
 * unaffected and keeps its own entry point.
 *
 * @see https://vercel.com/docs/functions/runtimes/node-js
 */

import { createCloudApp } from '../apps/mcp/dist/cloud.js';

const app = createCloudApp();
export default app;
