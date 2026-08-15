#!/usr/bin/env node
/**
 * gen-favicon.mjs — render the favicon from its 32×32 pixel-art source.
 *
 *   node scripts/gen-favicon.mjs           → favicon-32.png + favicon.ico
 *   node scripts/gen-favicon.mjs --preview → also writes a zoomed preview sheet
 *
 * The other app icons are downscales of the 3D render (scripts/gen-app-icons.mjs).
 * That is right at 128px and up and wrong at 32: a photographic render resampled
 * to 32² spends its pixels on gradients and the face turns to mush. So the
 * favicon is drawn for its own pixel budget instead — see lib/favicon-grid.mjs
 * for why it is authored rather than generated, and assets/brand/favicon-32.txt
 * for the artwork itself (one character per pixel, edit it directly).
 *
 * Nothing here calls a model or the network: the source is committed text.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import { SIZE, gridToRgba, parseGrid, usedColours } from './lib/favicon-grid.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets/brand/favicon-32.txt');
const PUB = path.join(ROOT, 'apps/web/public');

const lines = parseGrid(fs.readFileSync(SRC, 'utf8'));
const px = gridToRgba(lines);
const raw = () => sharp(px, { raw: { width: SIZE, height: SIZE, channels: 4 } });

await raw().png({ compressionLevel: 9, effort: 10 }).toFile(path.join(PUB, 'favicon-32.png'));

// The .ico carries 16 and 32. 16 is a clean 2:1 decimation — every output pixel
// maps to exactly one input pixel, so it stays crisp. 48 is deliberately absent:
// 1.5× lands pixel edges on half-pixels, which is precisely what makes scaled
// pixel art look broken. index.html declares the sizes this file actually has.
const tmp = fs.mkdtempSync(path.join(ROOT, '.favicon-ico-'));
try {
  const p32 = path.join(tmp, '32.png');
  const p16 = path.join(tmp, '16.png');
  await raw().png({ compressionLevel: 9 }).toFile(p32);
  await raw().resize(16, 16, { kernel: 'nearest' }).png({ compressionLevel: 9 }).toFile(p16);
  execFileSync('magick', [p16, p32, path.join(PUB, 'favicon.ico')]);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (process.argv.includes('--preview')) {
  const T = 320;
  const checker = Buffer.from(
    `<svg width="${T}" height="${T}"><defs><pattern id="c" width="16" height="16" patternUnits="userSpaceOnUse">
       <rect width="16" height="16" fill="#f5f5f5"/><rect width="8" height="8" fill="#d4d4d4"/>
       <rect x="8" y="8" width="8" height="8" fill="#d4d4d4"/></pattern></defs>
     <rect width="${T}" height="${T}" fill="url(#c)"/></svg>`,
  );
  const pad = (b, n) => sharp(b).extend({ top: n, bottom: n, left: n, right: n, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const tiles = await Promise.all([
    raw().resize(T, T, { kernel: 'nearest' }).png().toBuffer(),
    raw().png().toBuffer().then((b) => pad(b, (T - 32) / 2)),
    raw().resize(16, 16, { kernel: 'nearest' }).png().toBuffer().then((b) => pad(b, (T - 16) / 2)),
  ]);
  const composed = await Promise.all(
    tiles.map(async (input) => sharp(checker).composite([{ input }]).png().toBuffer()),
  );
  const out = path.join(ROOT, '.favicon-preview.png');
  await sharp({ create: { width: T * 3, height: T, channels: 4, background: '#ffffff' } })
    .composite(composed.map((input, i) => ({ input, left: i * T, top: 0 })))
    .png()
    .toFile(out);
  console.log(`preview → ${out}  (10× zoom | actual 32px | actual 16px)`);
}

const used = usedColours(lines);
const opaque = used.reduce((a, c) => a + c.px, 0);
console.log(`${used.length} colours, all canonical Tailwind:`);
for (const c of used) console.log(`  ${c.name.padEnd(12)} ${String(c.px).padStart(4)}px`);
console.log(`transparent: ${SIZE * SIZE - opaque}px of ${SIZE * SIZE}`);
for (const f of ['favicon-32.png', 'favicon.ico']) {
  console.log(`  ${f.padEnd(16)} ${(fs.statSync(path.join(PUB, f)).size / 1024).toFixed(1)} KB`);
}
