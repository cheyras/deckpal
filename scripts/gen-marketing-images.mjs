#!/usr/bin/env node
/**
 * gen-marketing-images.mjs — marketing imagery generator for the public landing page.
 *
 * Generates original, AI-generated marketing art through the **Vercel AI Gateway**
 * (no direct provider SDKs, no third-party image APIs), then optimises the chosen
 * candidates into responsive AVIF/WebP sets under apps/web/public/marketing/ and
 * writes an accurate MANIFEST.json for the landing page to build <picture> srcsets from.
 *
 * ── Pipeline ──────────────────────────────────────────────────────────────────
 *   generate   prompts → gateway image models → raw PNGs in .marketing-raw/<asset>/
 *   optimize   chosen raw PNG → resized AVIF/WebP (JPEG for og) → apps/web/public/marketing/
 *   manifest   scan the output dir → MANIFEST.json (dimensions + byte sizes read from
 *              the real files on disk, never hardcoded, so it cannot drift)
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *   node scripts/gen-marketing-images.mjs generate            # all assets, N candidates each
 *   node scripts/gen-marketing-images.mjs generate --only hero-bg
 *   node scripts/gen-marketing-images.mjs optimize            # uses .marketing-raw/picks.json
 *   node scripts/gen-marketing-images.mjs manifest
 *   node scripts/gen-marketing-images.mjs all
 *
 * After `generate`, look at the candidates and record your choices in
 * .marketing-raw/picks.json, e.g. { "hero-bg": "cand-2.png", "og-image": "cand-1.png" }.
 * If a pick is missing, `optimize` falls back to cand-1.png for that asset.
 *
 * ── Auth ──────────────────────────────────────────────────────────────────────
 * Vercel AI Gateway, resolved by @ai-sdk/gateway in this order:
 *   1. AI_GATEWAY_API_KEY
 *   2. VERCEL_OIDC_TOKEN  ← default; provision with:
 *        vercel env pull .env.local --environment=development
 *      The OIDC token is short-lived (~24h); re-pull when it expires.
 *
 * NOTE: the Vercel team must have a payment method on file, otherwise every gateway
 * request (text or image) returns 403 `customer_verification_required`, even though
 * the OIDC token itself authenticates correctly and model listing succeeds.
 *
 * ── Trademark safety ──────────────────────────────────────────────────────────
 * Every prompt is abstract by construction and carries an explicit exclusion list.
 * These assets must never depict real trading cards, existing TCG artwork, game
 * characters, logos, or any readable text. Keep NEGATIVE_SPACE_RULES applied to any
 * prompt added later.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { generateImage, gateway } from 'ai';
import sharp from 'sharp';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.join(REPO_ROOT, '.marketing-raw'); // gitignored: originals live here
const OUT_DIR = path.join(REPO_ROOT, 'apps', 'web', 'public', 'marketing');
const PICKS_FILE = path.join(RAW_DIR, 'picks.json');

/** Brand palette, kept in one place so every prompt stays cohesive with the app. */
const PALETTE = {
  surfaceDeep: '#15181f',
  surfaceRaised: '#1f232d',
  accent: '#ffd54a', // amber / gold
  link: '#32b5ff', // cool blue
};

/** Appended to every prompt. Trademark + legibility safety is not optional. */
const NEGATIVE_SPACE_RULES = [
  'Absolutely no text, no letters, no numbers, no words, no watermarks, no signatures.',
  'No logos, no brand marks, no icons of real companies.',
  'No recognizable characters, creatures, mascots, people, or faces.',
  'No real or imitation trading cards, no card faces, no card artwork, no game pieces.',
  'Purely abstract: light, atmosphere, geometry, and material only.',
].join(' ');

const PALETTE_CLAUSE =
  `Strict palette: deep slate near-black ${PALETTE.surfaceDeep} and ${PALETTE.surfaceRaised} surfaces, ` +
  `warm amber gold ${PALETTE.accent} as the single dominant accent, ` +
  `a restrained cool blue ${PALETTE.link} used sparingly as a secondary highlight. ` +
  'Dark, premium, understated, high production value.';

/**
 * Asset definitions.
 *
 * width/height  final intrinsic size of the "full size" render
 * widths        responsive widths emitted for the web (descending)
 * formats       output encodings; og must stay PNG/JPEG for social crawlers
 * seamless      post-process into a mirror-tiled seamless tile
 */
const ASSETS = [
  {
    name: 'hero-bg',
    model: 'bfl/flux-2-pro',
    width: 2560,
    height: 1440,
    aspectRatio: '16:9',
    candidates: 3,
    widths: [2560, 1600, 960],
    formats: ['avif', 'webp'],
    budgetKB: 250,
    prompt:
      'An abstract, atmospheric background for a premium dark software landing page. ' +
      'A vast, deep charcoal-slate void with soft volumetric depth and gentle haze. ' +
      'A warm amber-gold light bloom glows softly from the upper right, falling off into darkness. ' +
      'Faint, blurred rectangular geometric forms with rounded corners are suggested in shadow — ' +
      'implied planes floating at varied depths and slight angles, readable only as soft silhouettes ' +
      'and thin rim-light edges, never as objects. Subtle film grain, smooth cinematic gradients, ' +
      'generous empty space in the left half for overlaid text. ' +
      PALETTE_CLAUSE +
      ' ' +
      NEGATIVE_SPACE_RULES,
  },
  {
    name: 'texture-grid',
    model: 'bfl/flux-2-pro',
    width: 1600,
    height: 1600,
    aspectRatio: '1:1',
    candidates: 3,
    widths: [1600, 800],
    formats: ['avif', 'webp'],
    budgetKB: 120,
    seamless: true,
    prompt:
      'An extremely subtle dark texture for use as a tiled section background. ' +
      'Near-black slate surface with a very faint, evenly distributed mesh gradient — ' +
      'soft low-contrast blooms of deep blue-grey and a barely-there warm amber tint, ' +
      'overlaid with a delicate fine grid of thin darker lines at low opacity. ' +
      'Flat and even overall with no focal point, no vignette, no strong highlights, ' +
      'uniform brightness edge to edge so it tiles invisibly behind body text. ' +
      'Very low contrast, quiet, almost imperceptible. ' +
      PALETTE_CLAUSE +
      ' ' +
      NEGATIVE_SPACE_RULES,
  },
  {
    name: 'og-image',
    model: 'bfl/flux-2-pro',
    width: 1200,
    height: 630,
    aspectRatio: '16:9', // rendered wide, then cropped to the exact 1200x630 social ratio
    candidates: 3,
    widths: [1200],
    formats: ['jpeg'], // social crawlers do not reliably decode AVIF/WebP
    budgetKB: 200,
    prompt:
      'An abstract social share card background, dark and premium. ' +
      'Deep charcoal-slate field with a warm amber-gold light bloom concentrated in the right third, ' +
      'dissolving into soft shadow. Elegant faint geometric planes drift through the right side at ' +
      'shallow angles, catching thin gold rim light. The entire middle-left region is calm, uncluttered ' +
      'negative space — smooth dark gradient only, nothing competing there. ' +
      'Cinematic, balanced, restrained, subtle grain. ' +
      PALETTE_CLAUSE +
      ' ' +
      NEGATIVE_SPACE_RULES,
  },
  {
    name: 'accent-collection',
    model: 'bfl/flux-2-pro',
    width: 800,
    height: 800,
    aspectRatio: '1:1',
    candidates: 3,
    widths: [800, 400],
    formats: ['avif', 'webp'],
    budgetKB: 80,
    prompt:
      'A small abstract feature illustration evoking collection and organisation, dark and premium. ' +
      'A neat, orderly stack of thin translucent rectangular planes arranged in precise parallel layers, ' +
      'receding into soft shadow, each edge catching a fine amber-gold rim light. ' +
      'A sense of order, structure, and quiet accumulation. Deep slate background, soft depth of field, ' +
      'centred composition with breathing room. Pure geometry and light. ' +
      PALETTE_CLAUSE +
      ' ' +
      NEGATIVE_SPACE_RULES,
  },
  {
    name: 'accent-insights',
    model: 'bfl/flux-2-pro',
    width: 800,
    height: 800,
    aspectRatio: '1:1',
    candidates: 3,
    widths: [800, 400],
    formats: ['avif', 'webp'],
    budgetKB: 80,
    prompt:
      'A small abstract feature illustration evoking insight and analytics, dark and premium. ' +
      'Luminous amber-gold lines rise and inflect through dark space like an elegant abstract trend curve, ' +
      'accompanied by soft glowing nodes and a faint cool-blue secondary trace. ' +
      'Gentle bloom where the lines brighten, deep slate background, subtle grid implied in shadow far behind. ' +
      'Clean, precise, weightless. Pure geometry and light. ' +
      PALETTE_CLAUSE +
      ' ' +
      NEGATIVE_SPACE_RULES,
  },
  {
    name: 'accent-discovery',
    model: 'bfl/flux-2-pro',
    width: 800,
    height: 800,
    aspectRatio: '1:1',
    candidates: 3,
    widths: [800, 400],
    formats: ['avif', 'webp'],
    budgetKB: 80,
    prompt:
      'A small abstract feature illustration evoking discovery and scanning, dark and premium. ' +
      'A soft amber-gold beam of light sweeps across a dark slate field, its leading edge glowing, ' +
      'revealing faint geometric contours and fine scan lines as it passes. ' +
      'Concentric ripples of light expand outward from the sweep. A single cool-blue accent glint. ' +
      'Sense of search, reveal, and motion. Deep shadow, volumetric haze, centred composition. ' +
      'Pure geometry and light. ' +
      PALETTE_CLAUSE +
      ' ' +
      NEGATIVE_SPACE_RULES,
  },
];

// ── env ───────────────────────────────────────────────────────────────────────

/** Load KEY=VALUE pairs from a dotenv file without clobbering the real environment. */
function loadEnv(file) {
  if (!fs.existsSync(file)) return false;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
  return true;
}

function ensureAuth() {
  const explicit = process.env.MARKETING_ENV_FILE;
  if (explicit) loadEnv(path.resolve(explicit));
  loadEnv(path.join(REPO_ROOT, '.env.local'));

  if (process.env.AI_GATEWAY_API_KEY) return 'AI_GATEWAY_API_KEY';
  if (process.env.VERCEL_OIDC_TOKEN) return 'VERCEL_OIDC_TOKEN';

  throw new Error(
    'No AI Gateway credential found. Run:\n' +
      '  vercel env pull .env.local --environment=development\n' +
      'to provision VERCEL_OIDC_TOKEN, or export AI_GATEWAY_API_KEY.',
  );
}

// ── generate ──────────────────────────────────────────────────────────────────

/**
 * Ask the gateway for one image.
 *
 * Image models disagree on sizing controls: OpenAI/Recraft take `size`, while BFL,
 * Imagen and xAI take `aspectRatio` (xAI rejects `size` outright). We prefer the
 * explicit pixel `size` and fall back to `aspectRatio` when the provider rejects it,
 * so swapping the `model` field of an asset does not require editing this function.
 */
async function requestImage(asset, seed) {
  const base = {
    model: asset.model,
    prompt: asset.prompt,
    seed,
    providerOptions: { gateway: { tags: ['feature:marketing-images', 'project:deckscout'] } },
  };

  try {
    return await generateImage({ ...base, size: `${asset.width}x${asset.height}` });
  } catch (err) {
    const unsupportedSize =
      err?.statusCode === 400 || /size|dimension|unsupported/i.test(String(err?.message));
    if (!unsupportedSize || !asset.aspectRatio) throw err;
    console.warn(`    · 'size' rejected by ${asset.model}, retrying with aspectRatio`);
    return await generateImage({ ...base, aspectRatio: asset.aspectRatio });
  }
}

/**
 * Account-level failures (billing, revoked/expired credentials) will fail every
 * subsequent request identically. Detect them so we abort instead of grinding
 * through every remaining candidate and burning minutes on certain failure.
 */
function isFatalAccountError(err) {
  if (err?.statusCode === 401 || err?.statusCode === 403) return true;
  return /credit card|customer_verification|unauthorized|invalid token|expired/i.test(
    String(err?.message ?? ''),
  );
}

async function generate(only) {
  const auth = ensureAuth();
  console.log(`Gateway auth: ${auth}`);

  const targets = only ? ASSETS.filter((a) => a.name === only) : ASSETS;
  if (targets.length === 0) throw new Error(`Unknown asset: ${only}`);

  let produced = 0;

  for (const asset of targets) {
    const dir = path.join(RAW_DIR, asset.name);
    fs.mkdirSync(dir, { recursive: true });
    console.log(`\n${asset.name}  (${asset.model}, ${asset.candidates} candidates)`);

    for (let i = 1; i <= asset.candidates; i++) {
      const started = Date.now();
      try {
        // Distinct seeds keep candidates genuinely different rather than near-duplicates.
        const result = await requestImage(asset, 1000 + i * 137);
        const image = result.images[0];
        const buf = Buffer.from(image.base64, 'base64');
        const file = path.join(dir, `cand-${i}.png`);
        await sharp(buf).png().toFile(file);
        const meta = await sharp(file).metadata();
        produced++;
        console.log(
          `  cand-${i}: ${meta.width}x${meta.height} ` +
            `${(fs.statSync(file).size / 1024).toFixed(0)}KB ` +
            `${((Date.now() - started) / 1000).toFixed(1)}s`,
        );
      } catch (err) {
        // Re-throw account-level failures: retrying cannot help, and the top-level
        // handler prints the actionable remedy instead of N identical stack traces.
        if (isFatalAccountError(err)) throw err;
        console.error(`  cand-${i}: FAILED ${err?.statusCode ?? ''} ${err?.message ?? err}`);
      }
    }
  }

  if (produced === 0) {
    throw new Error('No candidates were generated — every request failed. See errors above.');
  }

  console.log(
    `\n${produced} raw candidate(s) in ${path.relative(REPO_ROOT, RAW_DIR)}/. ` +
      `Review them, then record choices in ${path.relative(REPO_ROOT, PICKS_FILE)}.`,
  );
}

// ── optimize ──────────────────────────────────────────────────────────────────

/**
 * Make a tile seamless by mirroring it into a 2x2 quad and taking the centre crop.
 * Mirrored edges are continuous by construction, which no prompt can guarantee.
 */
async function makeSeamless(input, size) {
  const half = Math.round(size / 2);
  const tl = await sharp(input).resize(half, half, { fit: 'fill' }).toBuffer();
  const tr = await sharp(tl).flop().toBuffer();
  const bl = await sharp(tl).flip().toBuffer();
  const br = await sharp(tl).flip().flop().toBuffer();

  return sharp({ create: { width: size, height: size, channels: 3, background: '#15181f' } })
    .composite([
      { input: tl, left: 0, top: 0 },
      { input: tr, left: half, top: 0 },
      { input: bl, left: 0, top: half },
      { input: br, left: half, top: half },
    ])
    .png()
    .toBuffer();
}

/** Encode one width/format pair, tightening quality until it fits the byte budget. */
async function encode(source, asset, width, format) {
  const height = Math.round((width / asset.width) * asset.height);
  const ext = format === 'jpeg' ? 'jpg' : format;
  const file = path.join(OUT_DIR, `${asset.name}-${width}.${ext}`);
  const budget = asset.budgetKB * 1024 * (width / asset.width); // scale budget with area-ish

  // Quality ladders: start high, step down only if the budget demands it.
  const ladder =
    format === 'avif' ? [58, 50, 42, 34] : format === 'webp' ? [82, 74, 66, 58] : [90, 84, 78];

  let last;
  for (const quality of ladder) {
    const pipeline = sharp(source).resize(width, height, { fit: 'cover', position: 'centre' });
    const encoded =
      format === 'avif'
        ? pipeline.avif({ quality, effort: 6, chromaSubsampling: '4:2:0' })
        : format === 'webp'
          ? pipeline.webp({ quality, effort: 6 })
          : pipeline.jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:2:0' });

    const buf = await encoded.toBuffer();
    last = { buf, quality };
    if (buf.length <= budget) break;
  }

  fs.writeFileSync(file, last.buf);
  const meta = await sharp(file).metadata();
  return {
    file: path.basename(file),
    asset: asset.name,
    width: meta.width,
    height: meta.height,
    format,
    quality: last.quality,
    bytes: fs.statSync(file).size,
  };
}

async function optimize(only) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const picks = fs.existsSync(PICKS_FILE) ? JSON.parse(fs.readFileSync(PICKS_FILE, 'utf8')) : {};
  const targets = only ? ASSETS.filter((a) => a.name === only) : ASSETS;
  const results = [];

  for (const asset of targets) {
    const chosen = picks[asset.name] ?? 'cand-1.png';
    const source = path.join(RAW_DIR, asset.name, chosen);
    if (!fs.existsSync(source)) {
      console.warn(`skip ${asset.name}: no raw candidate at ${path.relative(REPO_ROOT, source)}`);
      continue;
    }
    console.log(`\n${asset.name}  ← ${chosen}`);

    // Normalise to the asset's intrinsic size first, so every derivative crops identically.
    let base = asset.seamless
      ? await makeSeamless(source, asset.width)
      : await sharp(source)
          .resize(asset.width, asset.height, { fit: 'cover', position: 'centre' })
          .png()
          .toBuffer();

    for (const width of asset.widths) {
      for (const format of asset.formats) {
        const r = await encode(base, asset, width, format);
        results.push(r);
        console.log(`  ${r.file.padEnd(28)} ${r.width}x${r.height} q${r.quality} ${(r.bytes / 1024).toFixed(1)}KB`);
      }
    }
  }
  return results;
}

// ── manifest ──────────────────────────────────────────────────────────────────

/**
 * Build MANIFEST.json purely from what is actually on disk. Every dimension and byte
 * count is measured, never assumed — the landing page builds srcsets from this, so a
 * stale number here becomes a wrong `sizes`/`srcset` there.
 */
async function manifest() {
  if (!fs.existsSync(OUT_DIR)) throw new Error(`No output dir at ${OUT_DIR} — run optimize first.`);

  const files = fs
    .readdirSync(OUT_DIR)
    .filter((f) => /\.(avif|webp|jpg|jpeg|png)$/i.test(f))
    .sort();

  const assets = {};
  for (const file of files) {
    const full = path.join(OUT_DIR, file);
    const meta = await sharp(full).metadata();
    const def = ASSETS.find((a) => file.startsWith(`${a.name}-`));
    const name = def?.name ?? file.replace(/-\d+\.\w+$/, '');

    // sharp reports AVIF as 'heif' (AVIF is a HEIF-family container). Trust the
    // extension we wrote instead: emitting type="image/heif" in a <picture> makes
    // browsers skip the source entirely, silently disabling every AVIF we ship.
    const ext = path.extname(file).slice(1).toLowerCase();
    const format = ext === 'jpg' ? 'jpeg' : ext;
    const mimeType = `image/${format}`;

    assets[name] ??= { name, role: def ? roleFor(def) : 'unknown', sources: [] };
    assets[name].sources.push({
      file,
      path: `/marketing/${file}`,
      width: meta.width,
      height: meta.height,
      format,
      mimeType,
      bytes: fs.statSync(full).size,
    });
  }

  for (const a of Object.values(assets)) {
    a.sources.sort((x, y) => y.width - x.width || x.format.localeCompare(y.format));
    a.formats = [...new Set(a.sources.map((s) => s.format))];
    a.widths = [...new Set(a.sources.map((s) => s.width))].sort((x, y) => y - x);
    const largest = a.sources[0];
    a.intrinsicWidth = largest.width;
    a.intrinsicHeight = largest.height;
    a.aspectRatio = +(largest.width / largest.height).toFixed(4);
  }

  const out = {
    $comment:
      'Generated by scripts/gen-marketing-images.mjs — do not hand-edit. ' +
      'Dimensions and byte counts are measured from the files on disk.',
    generatedAt: new Date().toISOString(),
    baseUrl: '/marketing/',
    assets: Object.values(assets).sort((a, b) => a.name.localeCompare(b.name)),
  };

  const file = path.join(OUT_DIR, 'MANIFEST.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  console.log(`\nWrote ${path.relative(REPO_ROOT, file)} (${out.assets.length} assets)`);
  return out;
}

function roleFor(def) {
  if (def.name === 'hero-bg') return 'hero-background';
  if (def.name === 'texture-grid') return 'section-texture';
  if (def.name === 'og-image') return 'social-card';
  return 'feature-accent';
}

// ── models (diagnostic helper) ────────────────────────────────────────────────

/**
 * Print the asset table and prompts as markdown. CREDITS.md is generated from this
 * rather than hand-transcribed, so the documented prompts cannot drift from the ones
 * actually sent to the gateway.
 */
function printPrompts() {
  console.log('| Asset | Model | Intrinsic | Widths | Formats |');
  console.log('| --- | --- | --- | --- | --- |');
  for (const a of ASSETS) {
    console.log(
      `| \`${a.name}\` | \`${a.model}\` | ${a.width}x${a.height} | ${a.widths.join(', ')} | ` +
        `${a.formats.map((f) => (f === 'jpeg' ? 'jpeg' : f)).join(', ')} |`,
    );
  }
  for (const a of ASSETS) {
    console.log(`\n### \`${a.name}\`\n`);
    console.log('```text');
    console.log(a.prompt);
    console.log('```');
  }
}

async function listModels() {
  ensureAuth();
  const res = await gateway.getAvailableModels();
  const models = res.models ?? res;
  for (const m of models.filter((m) => (m.modelType ?? m.type) === 'image')) {
    console.log(`${m.id}\t${m.name ?? ''}`);
  }
}

// ── cli ───────────────────────────────────────────────────────────────────────

async function main() {
  const [command = 'all', ...rest] = process.argv.slice(2);
  const onlyIndex = rest.indexOf('--only');
  const only = onlyIndex >= 0 ? rest[onlyIndex + 1] : undefined;

  switch (command) {
    case 'generate':
      await generate(only);
      break;
    case 'optimize':
      await optimize(only);
      break;
    case 'manifest':
      await manifest();
      break;
    case 'models':
      await listModels();
      break;
    case 'prompts':
      printPrompts();
      break;
    case 'all':
      await generate(only);
      await optimize(only);
      await manifest();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Usage: gen-marketing-images.mjs [generate|optimize|manifest|models|prompts|all] [--only <asset>]');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n${err?.name ?? 'Error'}: ${err?.message ?? err}`);
  if (err?.statusCode === 403 && /credit card|customer_verification/i.test(String(err.message))) {
    console.error(
      '\nThe AI Gateway is authenticating fine but the Vercel team has no payment method,\n' +
        'so no request is served. Add a card at Vercel → team → AI Gateway, then re-run.',
    );
  }
  process.exit(1);
});
