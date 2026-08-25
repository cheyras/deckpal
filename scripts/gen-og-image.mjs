#!/usr/bin/env node
/**
 * gen-og-image.mjs — the link-preview card (og:image / twitter:image).
 *
 *   pnpm --filter deckpal-web build      # this reads the built CSS + fonts
 *   node scripts/gen-og-image.mjs
 *
 * What a link preview is for: someone pastes deckpal.app into iMessage or Slack
 * and gets one 1200×630 rectangle to understand what this is. The slot used to
 * hold an abstract AI-generated gradient, which told them nothing. This renders
 * an actual promo card — the app icon, the wordmark, the one-line pitch.
 *
 * ── Why it renders in a browser ──────────────────────────────────────────────
 * The wordmark is not a picture. It is Figtree 900, skewed -6deg, with a
 * four-stop cyan gradient clipped to the glyphs (`.brand-wordmark`, theme.css).
 * Reproducing that by hand in SVG would be a second copy that drifts the first
 * time anyone retunes the gradient. So the card is real HTML pointed at the
 * REAL built stylesheet and the REAL woff2 files, screenshotted at 1200×630.
 * Change the brand colours and this card follows on the next run.
 *
 * That is also why it needs `pnpm --filter deckpal-web build` first: it reads
 * apps/web/dist, not src.
 *
 * NOTE: this script reads `PLAYWRIGHT_PATH` — a require() specifier handed
 * straight to createRequire below — while every other script in this repo
 * (decke-gates.mjs, scripts/visual-harness/*) reads `PLAYWRIGHT_MODULE`, a
 * `playwright` package DIRECTORY (see visual-harness/lib/resolve-playwright.mjs
 * for that convention). The names are not interchangeable and neither are the
 * values; this difference is documented here rather than papered over.
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'apps/web/dist');
const OUT = path.join(ROOT, 'apps/web/public/marketing/og-image-1200.jpg');
const PLAYWRIGHT = process.env.PLAYWRIGHT_PATH ?? 'playwright';

const W = 1200;
const H = 630;

if (!fs.existsSync(DIST)) {
  console.error('apps/web/dist not found — run `pnpm --filter deckpal-web build` first.');
  process.exit(1);
}

const cssFile = fs.readdirSync(path.join(DIST, 'assets')).find((f) => f.endsWith('.css'));
if (!cssFile) {
  console.error('no built stylesheet in apps/web/dist/assets — build the web app first.');
  process.exit(1);
}

/**
 * `data-skin="premium"` and `data-topbar="cover"` are what the app boots with
 * (lib/skin.ts DEFAULT_SKIN), so the card inherits the same palette a visitor
 * actually sees rather than the unstyled fallback.
 */
const html = `<!doctype html>
<html lang="en" class="pkmnDark" data-theme="dark" data-skin="premium" data-topbar="cover">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="/assets/${cssFile}">
<style>
  html, body { margin: 0; padding: 0; background: var(--color-surface-primary); }
  #card {
    width: ${W}px; height: ${H}px; position: relative; overflow: hidden;
    background: var(--color-surface-primary);
    display: grid; grid-template-columns: auto 1fr; align-items: center;
    gap: 64px; padding: 0 88px; box-sizing: border-box;
    font-family: var(--font-sans);
  }
  /* A cyan bloom behind the icon, and a warm counter-light bottom-right, so the
     card has depth instead of reading as a flat swatch. */
  #card::before {
    content: ''; position: absolute; inset: 0;
    background:
      radial-gradient(760px 520px at 20% 34%, color-mix(in srgb, var(--color-brand-primary-400) 20%, transparent), transparent 68%),
      radial-gradient(620px 460px at 96% 108%, color-mix(in srgb, var(--color-brand-primary-700) 24%, transparent), transparent 62%);
  }
  #card > * { position: relative; }
  .icon {
    width: 268px; height: 268px; border-radius: 22%; display: block;
    box-shadow: 0 40px 90px -20px rgb(0 0 0 / 0.85), 0 0 0 1px rgb(255 255 255 / 0.06);
  }
  .wordmark { font-size: 104px; line-height: 1; }
  .pitch {
    font-family: var(--font-display);
    font-size: 40px; line-height: 1.18; font-weight: 600;
    color: var(--color-text-primary); margin: 26px 0 0; max-width: 15ch;
    letter-spacing: -0.01em;
  }
  .meta {
    margin-top: 30px; display: flex; align-items: center; gap: 14px;
    font-size: 21px; font-weight: 600; color: var(--color-text-muted);
  }
  .pill {
    display: inline-flex; align-items: center; gap: 10px;
    padding: 9px 20px; border-radius: 999px;
    background: color-mix(in srgb, var(--color-brand-primary-400) 15%, transparent);
    color: var(--color-brand-primary-200);
    border: 1px solid color-mix(in srgb, var(--color-brand-primary-400) 34%, transparent);
    font-size: 20px;
  }
  .dot { width: 9px; height: 9px; border-radius: 999px; background: var(--color-action-primary); }
</style>
</head>
<body>
  <div id="card">
    <img class="icon" src="/pwa-512.png" alt="">
    <div>
      <span class="brand-wordmark wordmark">DeckPal</span>
      <p class="pitch">Ask Claude what you can build from the cards you own.</p>
      <div class="meta">
        <span class="pill"><span class="dot"></span>21 tools over MCP</span>
        <span>Free &amp; open source</span>
      </div>
    </div>
  </div>
</body>
</html>`;

// Serve dist so the stylesheet, fonts and icon resolve as same-origin, exactly
// as they do in the app.
const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (url === '/og.html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html);
    return;
  }
  // dist may have been built for either deploy: cloud serves from '/', self-host
  // from '/deckpal/'. Strip the prefix so this works against whichever build is
  // sitting there rather than forcing the caller to rebuild with cloud env.
  const file = path.join(DIST, url.replace(/^\/deckpal\//, '/'));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  const type =
    { '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.js': 'text/javascript' }[
      path.extname(file)
    ] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type });
  fs.createReadStream(file).pipe(res);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// createRequire, not import(): playwright is CJS, and importing a bare
// directory path throws ERR_UNSUPPORTED_DIR_IMPORT under ESM.
const { chromium } = createRequire(import.meta.url)(PLAYWRIGHT);
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  const missing = [];
  page.on('response', (r) => { if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`); });
  await page.goto(`http://127.0.0.1:${port}/og.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  if (missing.length) {
    throw new Error(`card referenced assets that 404'd:\n  ${missing.join('\n  ')}`);
  }
  const png = await page.locator('#card').screenshot({ type: 'png' });
  // JPEG at 2x downsampled to 1200×630: crawlers cap around 5MB and prefer JPEG,
  // and the downsample is what keeps the wordmark's gradient edge clean.
  await sharp(png).resize(W, H).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toFile(OUT);
} finally {
  await browser.close();
  server.close();
}

const { size } = fs.statSync(OUT);
const meta = await sharp(OUT).metadata();
console.log(`${path.relative(ROOT, OUT)}  ${meta.width}×${meta.height}  ${(size / 1024).toFixed(1)} KB`);
