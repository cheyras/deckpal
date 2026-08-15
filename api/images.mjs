/**
 * Vercel serverless function — the cloud image tier for `/deckpal/images/*`.
 *
 * vercel.json rewrites `/deckpal/images/(.*)` here (ahead of the SPA catch-all,
 * which is what used to swallow these URLs and answer `200 text/html` for every
 * <img>). The capture group arrives as `?p=…` so the handler never has to guess
 * how the platform rewrote the path.
 *
 * Self-hosters do not use this file at all — they run `apps/images` against a
 * local WebP cache. Both tiers share the path algebra in `@deckpal/storage`.
 *
 * @see apps/api/src/images/handler.ts
 * @see https://vercel.com/docs/functions/runtimes/node-js
 */

import { handleImageRequest } from '../apps/api/dist/images/handler.js';

export default async function handler(req, res) {
  await handleImageRequest(req, res);
}
