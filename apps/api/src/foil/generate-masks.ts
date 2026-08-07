// foil/generate-masks.ts — run a mask generator over targets, or evaluate one
// against the human corpus. DEV TOOL (foil track); never imported by the server.
//
//   # honest feasibility check FIRST — leave-one-out against the human corpus
//   pnpm --filter pokedex-api exec tsx src/foil/generate-masks.ts eval \
//     --generator window-artgate --era wotc --scope window
//
//   # then, only if eval justifies it, a small labeled trial batch
//   pnpm --filter pokedex-api exec tsx src/foil/generate-masks.ts run \
//     --generator window-artgate --era wotc --scope window \
//     --serie base --series-slug base --run-id trial-1 \
//     --cards base1-1:12,base1-2:15
//
//   # and it is reversible
//   pnpm --filter pokedex-api exec tsx src/foil/generate-masks.ts revert --run-id trial-1
//
// Everything it writes goes through provenance.writeMaskRecord with a full
// generator identity, so every mask lands as `ai` / unreviewed with its
// exemplars recorded. Exemplars come from selectExemplars(), which refuses to
// return unreviewed `ai` masks — a generation can never train on itself.
//
// Card art: decoded out of the image cache with ImageMagick (`magick`), which
// is present on this box. The API deliberately has no native image addon, and
// this is a CLI, not a request path — the server never shells out.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng, decodePng, type RgbaImage } from './png.js';
import { rasterizePriorAlpha, type MaskPrior } from './mask-artifacts.js';
import {
  alphaOf,
  writeMaskRecord,
  readSidecarFile,
  maskPathsIn,
  type GeneratorIdentity,
} from './provenance.js';
import { readCorpus, selectExemplars, toExemplarRefs, setIdOf } from './mask-corpus.js';
import { GENERATORS, rectCoverage, type GeneratorExemplar, type GeneratorTarget } from './generator.js';

const MASK_W = 490;
const MASK_H = Math.round((MASK_W * 337) / 245); // 674 — matches MaskEditor.tsx

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('repo root not found');
}
const ROOT = repoRoot();
const MASKS_DIR = join(ROOT, 'data', 'foil-masks');
const CACHE_ROOT = process.env.IMAGE_CACHE_ROOT ?? '/home/cheyras/pokedex/cache';

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

// ── Card art from the image cache ──────────────────────────────────────────

function cachePath(serie: string, setId: string, localId: string): string {
  return join(CACHE_ROOT, 'images', 'en', serie, setId, `${localId}.high.webp`);
}

/** Decode a cached WebP scan to RGBA at mask resolution. Null when uncached. */
function loadArtwork(serie: string, cardId: string, w = MASK_W, h = MASK_H): RgbaImage | null {
  const setId = setIdOf(cardId);
  const localId = setId ? cardId.slice(setId.length + 1) : null;
  if (!setId || !localId) return null;
  const p = cachePath(serie, setId, localId);
  if (!existsSync(p)) return null;
  try {
    const png = execFileSync('magick', [p, '-resize', `${w}x${h}!`, 'png32:-'], { maxBuffer: 64 * 1024 * 1024 });
    return decodePng(png);
  } catch {
    return null;
  }
}

// ── Era rects (same data + same math the web resolver uses) ────────────────

interface Layouts {
  cornerRadius: number;
  eras: Record<string, { artWindow: { x: number; y: number; w: number; h: number }; artWindowRadius: number }>;
}

async function loadLayouts(): Promise<Layouts> {
  return JSON.parse(await readFile(join(ROOT, 'apps', 'web', 'src', 'foil', 'era-layouts.json'), 'utf8')) as Layouts;
}

function maskForScope(
  layouts: Layouts,
  eraId: string,
  scope: string,
): { rect: [number, number, number, number]; radius: number; invert: boolean } {
  const era = layouts.eras[eraId];
  if (!era) throw new Error(`unknown era '${eraId}' in era-layouts.json`);
  const aw = era.artWindow;
  const rectYUp: [number, number, number, number] = [aw.x, 1 - aw.y - aw.h, aw.w, aw.h];
  if (scope === 'window') return { rect: rectYUp, radius: era.artWindowRadius, invert: false };
  if (scope === 'sheet') return { rect: rectYUp, radius: era.artWindowRadius, invert: true };
  return { rect: [0, 0, 1, 1], radius: layouts.cornerRadius, invert: false };
}

/** Jaccard over foil pixels — same definition as diff.agreement. */
function agreement(a: Uint8Array, b: Uint8Array): { agreement: number; addedPx: number; removedPx: number; unchangedPx: number } {
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (let i = 0; i < a.length; i++) {
    const inA = a[i]! >= 128;
    const inB = b[i]! >= 128;
    if (inA && inB) unchanged++;
    else if (inA) added++;
    else if (inB) removed++;
  }
  const union = unchanged + added + removed;
  return { agreement: union === 0 ? 1 : Number((unchanged / union).toFixed(4)), addedPx: added, removedPx: removed, unchangedPx: unchanged };
}

/** Nearest-neighbour resample of an alpha plane (masks are ~binary). */
function resampleAlpha(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  if (sw === dw && sh === dh) return src;
  const out = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
    for (let x = 0; x < dw; x++) {
      out[y * dw + x] = src[sy * sw + Math.min(sw - 1, Math.floor((x * sw) / dw))]!;
    }
  }
  return out;
}

// ── Exemplar assembly ──────────────────────────────────────────────────────

async function buildExemplars(
  layouts: Layouts,
  eraId: string,
  scope: string,
  serie: string,
  exclude?: { cardId: string; variantId: number },
): Promise<GeneratorExemplar[]> {
  const corpus = await readCorpus(MASKS_DIR);
  const sel = selectExemplars(corpus, { eraId, scope });
  const out: GeneratorExemplar[] = [];
  for (const [i, e] of sel.chosen.entries()) {
    if (exclude && e.cardId === exclude.cardId && e.variantId === exclude.variantId) continue;
    const png = await readFile(join(ROOT, e.files.mask)).catch(() => null);
    if (!png) continue;
    const img = decodePng(png);
    const alpha = resampleAlpha(alphaOf(img), img.width, img.height, MASK_W, MASK_H);
    out.push({
      ref: toExemplarRefs(sel)[i]!,
      alpha,
      artwork: loadArtwork(serie, e.cardId),
      rect: e.sidecar.prior?.rect ?? maskForScope(layouts, eraId, scope).rect,
      scope: e.sidecar.prior?.scope ?? scope,
      eraId: e.sidecar.prior?.eraId ?? eraId,
    });
  }
  return out;
}

function targetFor(
  layouts: Layouts,
  cardId: string,
  variantId: number,
  eraId: string,
  scope: string,
  serie: string,
  seriesSlug: string | null,
  artwork: RgbaImage,
): GeneratorTarget {
  const m = maskForScope(layouts, eraId, scope);
  const setId = setIdOf(cardId);
  const localId = setId ? cardId.slice(setId.length + 1) : '';
  return {
    cardId,
    variantId,
    eraId,
    scope: scope as GeneratorTarget['scope'],
    rect: m.rect,
    radius: m.radius,
    invert: m.invert,
    window: null,
    artwork,
    // Same URL shape the api's cardImages() emits (apps/api/src/db.ts) — the
    // scan the workbench textures, not the raw cache filename.
    artworkUrl: `/pokedex/images/en/${serie}/${setId ?? ''}/${localId}/high.webp`,
    width: MASK_W,
    height: MASK_H,
    setId,
    seriesSlug,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  };
}

// ── eval: leave-one-out against the human corpus ───────────────────────────

async function evaluate(): Promise<void> {
  const generatorName = arg('generator') ?? 'window-artgate';
  const gen = GENERATORS[generatorName];
  if (!gen) throw new Error(`unknown generator '${generatorName}' (have: ${Object.keys(GENERATORS).join(', ')})`);
  const eraId = arg('era');
  const scope = arg('scope');
  const serie = arg('serie') ?? 'base';
  if (!eraId || !scope) throw new Error('--era and --scope are required (never guessed)');
  const layouts = await loadLayouts();

  const corpus = await readCorpus(MASKS_DIR);
  const held = selectExemplars(corpus, { eraId, scope }).chosen;
  console.log(`\nEVAL  generator=${gen.name}@${gen.version}  era=${eraId}  scope=${scope}`);
  console.log(`human exemplars in corpus: ${held.length}  (leave-one-out ⇒ each run sees ${held.length - 1})\n`);
  if (held.length === 0) {
    console.log('No human exemplars — nothing to evaluate.');
    return;
  }

  const rows: { card: string; rect: number; gen: number | null; delta: number | null; note: string }[] = [];
  for (const e of held) {
    const artwork = loadArtwork(serie, e.cardId);
    const humanPng = await readFile(join(ROOT, e.files.mask));
    const humanImg = decodePng(humanPng);
    const human = resampleAlpha(alphaOf(humanImg), humanImg.width, humanImg.height, MASK_W, MASK_H);
    const m = maskForScope(layouts, eraId, scope);
    const rectAlpha = rectCoverage(MASK_W, MASK_H, m.rect, m.radius, m.invert);
    const rectScore = agreement(rectAlpha, human).agreement;
    if (!artwork) {
      rows.push({ card: `${e.cardId}/${e.variantId}`, rect: rectScore, gen: null, delta: null, note: 'scan not in image cache' });
      continue;
    }
    const exemplars = await buildExemplars(layouts, eraId, scope, serie, { cardId: e.cardId, variantId: e.variantId });
    if (exemplars.length < 1) {
      rows.push({ card: `${e.cardId}/${e.variantId}`, rect: rectScore, gen: null, delta: null, note: 'no other exemplar to learn from' });
      continue;
    }
    const out = gen.generate({
      target: targetFor(layouts, e.cardId, e.variantId, eraId, scope, serie, null, artwork),
      exemplars,
    });
    const genScore = agreement(out.alpha, human).agreement;
    rows.push({
      card: `${e.cardId}/${e.variantId}`,
      rect: rectScore,
      gen: genScore,
      delta: Number((genScore - rectScore).toFixed(4)),
      note: out.notes,
    });
  }
  console.log('card                 rect-only   generator   delta');
  for (const r of rows) {
    console.log(
      `${r.card.padEnd(20)} ${r.rect.toFixed(4)}      ${r.gen === null ? '  —   ' : r.gen.toFixed(4)}      ${
        r.delta === null ? '—' : (r.delta >= 0 ? '+' : '') + r.delta.toFixed(4)
      }`,
    );
    if (r.note) console.log(`  ↳ ${r.note}`);
  }
  const scored = rows.filter((r) => r.gen !== null);
  if (scored.length) {
    const mr = scored.reduce((a, r) => a + r.rect, 0) / scored.length;
    const mg = scored.reduce((a, r) => a + (r.gen ?? 0), 0) / scored.length;
    console.log(`\nmean rect-only ${mr.toFixed(4)}  →  mean generator ${mg.toFixed(4)}  (delta ${(mg - mr >= 0 ? '+' : '') + (mg - mr).toFixed(4)})`);
    console.log(
      `\nn=${held.length}. Leave-one-out at this n is a smoke test, NOT validation — a positive delta here\n` +
        'is evidence the pipeline runs, not evidence the generator generalizes.',
    );
  }
}

// ── run: write a labeled, reversible trial batch ───────────────────────────

async function run(): Promise<void> {
  const generatorName = arg('generator') ?? 'window-artgate';
  const gen = GENERATORS[generatorName];
  if (!gen) throw new Error(`unknown generator '${generatorName}'`);
  const eraId = arg('era');
  const scope = arg('scope');
  const serie = arg('serie');
  const seriesSlug = arg('series-slug');
  const runId = arg('run-id');
  const cardsArg = arg('cards');
  if (!eraId || !scope || !serie || !runId || !cardsArg) {
    throw new Error('run requires --era --scope --serie --run-id --cards <cardId:variantId,...>');
  }
  const targets = cardsArg.split(',').map((s) => {
    const [cardId, variantId] = s.split(':');
    if (!cardId || !variantId) throw new Error(`bad --cards entry '${s}' (want cardId:variantId)`);
    return { cardId, variantId: Number(variantId) };
  });
  if (targets.length > 10) throw new Error('trial batches are capped at 10 cards — keep them reviewable');

  const layouts = await loadLayouts();
  const exemplars = await buildExemplars(layouts, eraId, scope, serie);
  if (exemplars.length < gen.minExemplars) {
    throw new Error(
      `${gen.name} needs >= ${gen.minExemplars} human exemplars for era=${eraId} scope=${scope}; found ${exemplars.length}. ` +
        'Hand-paint more masks first — this is the anti-collapse floor, not a suggestion.',
    );
  }
  const dry = flag('dry-run');
  const m = maskForScope(layouts, eraId, scope);

  for (const t of targets) {
    // NEVER overwrite a human mask with a machine proposal.
    const existing = await readSidecarFile(MASKS_DIR, t.cardId, t.variantId);
    if (existing && existing.derivation_method !== 'ai') {
      console.log(`skip ${t.cardId}/${t.variantId}: already has a ${existing.derivation_method} mask (human work is never overwritten)`);
      continue;
    }
    const artwork = loadArtwork(serie, t.cardId);
    if (!artwork) {
      console.log(`skip ${t.cardId}/${t.variantId}: scan not in the image cache`);
      continue;
    }
    const target = targetFor(layouts, t.cardId, t.variantId, eraId, scope, serie, seriesSlug, artwork);
    const out = gen.generate({ target, exemplars });

    const rgba = new Uint8Array(MASK_W * MASK_H * 4);
    for (let i = 0; i < out.alpha.length; i++) {
      rgba[i * 4] = 255;
      rgba[i * 4 + 1] = 45;
      rgba[i * 4 + 2] = 100; // MASK_TINT — display only
      rgba[i * 4 + 3] = out.alpha[i]!;
    }
    const png = encodePng({ width: MASK_W, height: MASK_H, rgba });

    const prior: MaskPrior = {
      source: 'ai',
      eraId,
      scope: scope as MaskPrior['scope'],
      rect: m.rect,
      radius: m.radius,
      invert: m.invert,
      feather: 0,
      resolverVersion: Number(arg('resolver-version') ?? '5'),
    };
    const identity: GeneratorIdentity = {
      name: gen.name,
      version: gen.version,
      modelId: gen.modelId,
      runId,
      params: { ...gen.params, era: eraId, scope, notes: out.notes },
      exemplars: exemplars.map((e) => e.ref),
      confidence: out.confidence,
      generatedAt: new Date().toISOString(),
    };
    const rectScore = agreement(rasterizePriorAlpha(MASK_W, MASK_H, prior), out.alpha);
    if (dry) {
      console.log(`[dry] ${t.cardId}/${t.variantId}  conf=${String(out.confidence)}  vs-rect agreement=${rectScore.agreement}`);
      continue;
    }
    const sidecar = await writeMaskRecord({
      masksDir: MASKS_DIR,
      cardId: t.cardId,
      variantId: String(t.variantId),
      png,
      width: MASK_W,
      height: MASK_H,
      prior,
      startedFrom: 'layout',
      artworkUrl: target.artworkUrl,
      card: { setId: target.setId, seriesSlug: target.seriesSlug, name: null, number: null },
      machine: identity,
    });
    console.log(
      `wrote ${t.cardId}/${t.variantId}  method=${sidecar.derivation_method}  review=${sidecar.reviewStatus}  conf=${String(out.confidence)}`,
    );
  }
  if (!dry) {
    console.log(
      `\nrun ${runId}: ${targets.length} target(s). All masks are \`ai\` / unreviewed — they are PROPOSALS.\n` +
        `Revert with: tsx src/foil/generate-masks.ts revert --run-id ${runId}`,
    );
  }
}

// ── revert: delete a run's unreviewed output (never touches human work) ────

async function revert(): Promise<void> {
  const runId = arg('run-id');
  if (!runId) throw new Error('revert requires --run-id');
  const corpus = await readCorpus(MASKS_DIR);
  let removed = 0;
  for (const e of corpus) {
    const g = e.sidecar.prior?.generator;
    if (e.sidecar.derivation_method !== 'ai' || g?.runId !== runId) continue;
    const p = maskPathsIn(MASKS_DIR, e.cardId, e.variantId);
    for (const f of [p.png, p.json, p.prior, p.diff, p.parent, p.parentDiff]) await unlink(f).catch(() => undefined);
    removed++;
    console.log(`removed ${e.cardId}/${e.variantId}`);
  }
  console.log(`\nreverted ${removed} unreviewed mask(s) from run ${runId}. Corrected/hand masks were left alone.`);
}

const CMD = process.argv[2];
const main = CMD === 'eval' ? evaluate : CMD === 'run' ? run : CMD === 'revert' ? revert : null;
if (!main) {
  console.error('usage: generate-masks.ts <eval|run|revert> [flags] — see the header comment');
  process.exit(2);
}
void main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
