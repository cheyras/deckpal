// Regenerate the app-icon set from assets/brand/deckpal-app-icon.jpg.
//
//   node scripts/gen-app-icons.mjs
//
// Two crops of the same render, because the two icon classes are masked
// differently and want opposite things:
//
//   TIGHT  — apple-touch, brand mark, and the `any` PWA icons. These
//            are shown as-is (or with a gentle squircle), so the art is cropped
//            in to make the face read at 16–32px. Measured against the full
//            frame at 16px, the trimmed dead space is the difference between a
//            legible mark and mush.
//
//   FULL   — the `maskable` PWA icons. Android crops these to a circle inscribed
//            in the central 80%, and anything outside that is fair game. The
//            full frame keeps the face comfortably inside that circle; the tight
//            crop does not — it loses the lightning bolts and the left edge of
//            the box. Full-bleed rather than scaled-and-padded so there is no
//            seam between the artwork's own backdrop and a flat pad colour.
//
// Alpha is deliberate: only the top-bar mark keeps it (baked rounded corners).
// iOS composites a home-screen icon over BLACK, so apple-touch-icon must be
// opaque or the corners go dark.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'assets/brand/deckpal-app-icon.jpg');
const OUT = join(root, 'apps/web/public');
const MCP = join(root, 'apps/mcp/assets');

// Source is 1080². Chosen by rendering candidates at 16/32/48px and comparing.
const TIGHT = { left: 130, top: 70, width: 850, height: 850 };

const tight = () => sharp(SRC).extract(TIGHT);
const full = () => sharp(SRC);

/**
 * PNG tuned for size — these are precached by the service worker, so bytes
 * here are bytes every install pays for. Full colour, not paletted: the source
 * is a smooth 3D render and quantising it bands the gradients on the box for
 * no gain (measured: identical output size either way).
 */
const png = (p) => p.png({ compressionLevel: 9, effort: 10 });

async function write(pipeline, size, file, { alpha = false } = {}) {
  let p = pipeline.resize(size, size, { fit: 'cover' });
  if (!alpha) p = p.flatten({ background: '#0d1520' }); // matches the render's own backdrop
  await png(p).toFile(file);
}

/** Rounded-corner mask, so the top-bar mark carries its own shape. */
function roundedMask(size, radiusPct = 22) {
  const r = Math.round(size * (radiusPct / 100));
  return Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#fff"/></svg>`,
  );
}

const made = [];
function note(file) {
  // statSync, not sharp.metadata: sharp cannot read back an ICO.
  made.push(`${file.replace(root + '/', '').padEnd(42)} ${(statSync(file).size / 1024).toFixed(1)} KB`);
}

// ── Top-bar mark: rounded corners baked in, alpha kept ───────────────────────
const brand = join(OUT, 'brand-icon.png');
await png(
  tight()
    .resize(128, 128)
    .composite([{ input: roundedMask(128), blend: 'dest-in' }]),
).toFile(brand);
note(brand);

// ── Favicons are NOT generated here ──────────────────────────────────────────
// favicon-32.png and favicon.ico belong to scripts/gen-favicon.mjs, which draws
// them as 32x32 pixel art instead of resampling this render. Do not add them
// back: whichever script ran last would win, and running this one would
// silently replace the drawn favicon with a mushy downscale.

// ── Home screen ──────────────────────────────────────────────────────────────
// Opaque: iOS composites a home-screen icon over black.
await write(tight(), 180, join(OUT, 'apple-touch-icon.png'));
note(join(OUT, 'apple-touch-icon.png'));

// iOS probes `apple-touch-icon-precomposed.png` at the site root BEFORE it
// falls back to the <link> tag, whether or not you declare it. It has to be a
// real file: with a SPA rewrite in front, a missing one answers 200 with the
// HTML shell, iOS fails to decode that as an image, gives up on the icon
// entirely and screenshots the page instead — which is how the marketing hero
// ended up on the home screen. vercel.json now 404s unknown asset paths too,
// but shipping the file is the belt to that braces.
await write(tight(), 180, join(OUT, 'apple-touch-icon-precomposed.png'));
note(join(OUT, 'apple-touch-icon-precomposed.png'));

for (const s of [192, 512]) {
  await write(tight(), s, join(OUT, `pwa-${s}.png`));
  note(join(OUT, `pwa-${s}.png`));
}
for (const s of [192, 512]) {
  await write(full(), s, join(OUT, `pwa-maskable-${s}.png`));
  note(join(OUT, `pwa-maskable-${s}.png`));
}

// ── MCP connector icon (SEP-973), so the connector matches the app ───────────
for (const s of [128, 512]) {
  await write(tight(), s, join(MCP, `icon-${s}.png`));
  note(join(MCP, `icon-${s}.png`));
}

console.log(made.join('\n'));
