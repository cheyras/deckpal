/**
 * Vercel serverless function entry point — catch-all that mounts the Express
 * app as a single function. All /api/* requests route here via vercel.json
 * rewrites.
 *
 * The same Express app works as a standalone Node server (apps/api/src/index.ts)
 * for self-hosters and local development. This file only adds the Vercel
 * adapter layer.
 *
 * @see https://vercel.com/docs/functions/runtimes/node-js
 */

import { createApp } from '../apps/api/dist/index.js';

const app = createApp();
export default app;
