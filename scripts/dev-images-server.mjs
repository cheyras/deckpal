// Local stand-in for the Vercel `/api/images` function (api/images.mjs) so the
// Vite dev proxy has something to forward `/deckscout/images/*` to when running
// against the cloud (Supabase Storage) image tier locally. Not used in production.
import { createServer } from 'node:http';
import { handleImageRequest } from '../apps/api/dist/images/handler.js';

const port = Number(process.env.DECKSCOUT_IMAGES_PORT ?? 3701);
createServer((req, res) => {
  handleImageRequest(req, res).catch((err) => {
    console.error('[dev-images-server]', err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
}).listen(port, '127.0.0.1', () => {
  console.log(`dev-images-server listening on 127.0.0.1:${port}`);
});
