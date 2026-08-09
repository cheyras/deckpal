// foil/generate-masks.ts — run a mask generator over targets, or evaluate one
// against the human corpus. DEV TOOL (foil track); never imported by the server.
//
//   # honest feasibility check FIRST — leave-one-out against the human corpus
//   pnpm --filter deckscout-api exec tsx src/foil/generate-masks.ts eval \
//     --generator window-artgate --era wotc --scope window
//
//   # then, only if eval justifies it, a small labeled trial batch
//   pnpm --filter deckscout-api exec tsx src/foil/generate-masks.ts run \
//     --generator window-artgate --era wotc --scope window \
//     --serie base --series-slug base --run-id trial-1 \
//     --cards base1-1:12,base1-2:15
//
//   # REFINE an existing HUMAN mask with a refiner generator (line-snap):
//   #   --refine loads the mask already at each target as the generator's
//   #   source, archives it verbatim, and writes the result as `ai`/unreviewed.
//   pnpm --filter deckscout-api exec tsx src/foil/generate-masks.ts run \
//     --generator line-snap --refine --era modern-sv --scope sheet \
//     --serie me --series-slug mega-evolution --run-id straighten-1 \
//     --cards me05-001:37184
//
//   # and it is reversible — restores what it replaced, BYTE-FOR-BYTE
//   pnpm --filter deckscout-api exec tsx src/foil/generate-masks.ts revert --run-id trial-1
//   pnpm --filter deckscout-api exec tsx src/foil/generate-masks.ts archives   # what is undoable
//
//   # MEASURE, don't assert: how well does each mask's boundary sit on the
//   # card's own printed edges? (the metric that decides approve vs revert)
//   pnpm --filter deckscout-api exec tsx src/foil/generate-masks.ts adherence \
//     --serie me --card me05-001 --masks "his=data/foil-masks/me05-001/37184.png,new=/tmp/x.png"
//
// Everything it writes goes through provenance.writeMaskRecord with a full
// generator identity, so every mask lands as `ai` / unreviewed with its
// exemplars recorded. Exemplars come from selectExemplars(), which refuses to
// return unreviewed `ai` masks — a generation can never train on itself.
//
// Card art comes from `foil/analysis-source.ts`, which decides between the
// cached (lossy) WebP and the upstream lossless PNG and REPORTS which it used —
// recorded per card in the generator's params (`analysisSource`) so a mask can
// always answer "what pixels was I fitted to". `--analysis-source lossless`
// fetches the upstream PNG on demand (never cached to disk); the default is
// `cached`, because TCGdex's PNGs are 256-colour palette and measurably band in
// flat regions (DECISIONS 2026-08-08). Decoding is ImageMagick (`magick`), a
// CLI-only dependency — this is a CLI, not a request path; the server never
// shells out.

import { existsSync } from 'node:fs';
import { mkdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng, decodePng, type RgbaImage } from './png.js';
import { rasterizePriorAlpha, type MaskPrior } from './mask-artifacts.js';
import {
  alphaOf,
  sha256,
  writeMaskRecord,
  readSidecarFile,
  maskPathsIn,
  findArchives,
  restoreArchive,
  EXEMPLAR_WEIGHT,
  type GeneratorIdentity,
} from './provenance.js';
import { readCorpus, selectExemplars, toExemplarRefs, setIdOf } from './mask-corpus.js';
import { gradientOf } from './line-snap.js';
import {
  DEFAULT_ADHERENCE_PARAMS,
  DEFAULT_EDGE_TRACE_PARAMS,
  buildEdgeMap,
  luminanceProbe,
  measureAdherence,
  tensorProbe,
  type AdherenceParams,
} from './edge-trace.js';
import {
  GENERATORS,
  rectCoverage,
  type GeneratorExemplar,
  type GeneratorSource,
  type GeneratorTarget,
} from './generator.js';
import { boundaryDistance } from './region-learn.js';
import { AnalysisSource, closeAnalysisSource, type AnalysisImage } from './analysis-source.js';

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

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

// ── Card art, through the analysis source ──────────────────────────────────
//
// ONE way in, for every command, so the provenance of the pixels a generator
// fitted to is never a guess. `--analysis-source lossless` asks for the upstream
// PNG; when that is impossible (no recorded source_url, a 404, a non-PNG body)
// the source falls back to the cached WebP and SAYS SO, and that sentence is
// what gets recorded. It is never silently swapped.

/** `cached` (default) | `lossless`. Read once so every command agrees. */
function analysisPreference(): 'cached' | 'lossless' {
  const v = arg('analysis-source') ?? 'cached';
  if (v !== 'cached' && v !== 'lossless') {
    throw new Error(`--analysis-source must be 'cached' or 'lossless' (got '${v}')`);
  }
  return v;
}

const ART = new AnalysisSource();
/** cardId → the provenance of the art actually used, for the run report. */
const ART_PROVENANCE = new Map<string, AnalysisImage>();

/** Decode a card scan to RGBA at mask resolution. Null when there is none. */
async function loadArtwork(serie: string, cardId: string, w = MASK_W, h = MASK_H): Promise<RgbaImage | null> {
  const got = await ART.get(cardId, { serie, prefer: analysisPreference(), width: w, height: h });
  if (!got) return null;
  ART_PROVENANCE.set(cardId, got);
  return got.image;
}

/** What `loadArtwork` last returned for this card, for params/notes. */
function artProvenance(cardId: string): AnalysisImage | null {
  return ART_PROVENANCE.get(cardId) ?? null;
}

/** The provenance fields recorded in a generator identity's params. */
function provenanceParams(cardId: string): Record<string, string | boolean> {
  const p = artProvenance(cardId);
  if (!p) return {};
  return {
    analysisSource: p.source,
    analysisSourceLossless: p.lossless,
    ...(p.url ? { analysisSourceUrl: p.url } : {}),
    ...(p.palette === true ? { analysisSourcePalette: true } : {}),
    ...(p.fallbackReason ? { analysisSourceFallback: p.fallbackReason } : {}),
  };
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

/** Alpha plane → the RGBA a mask PNG stores: MASK_TINT in RGB, coverage in alpha. */
function tintAlpha(alpha: Uint8Array): Uint8Array {
  const rgba = new Uint8Array(alpha.length * 4);
  for (let i = 0; i < alpha.length; i++) {
    rgba[i * 4] = 255;
    rgba[i * 4 + 1] = 45;
    rgba[i * 4 + 2] = 100; // display only — the ALPHA is the mask
    rgba[i * 4 + 3] = alpha[i]!;
  }
  return rgba;
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
      artwork: await loadArtwork(serie, e.cardId),
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
    artworkUrl: `/deckscout/images/en/${serie}/${setId ?? ''}/${localId}/high.webp`,
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

  // THE BAR — stated before any number for the generator under test existed
  // (scratchpad BAR.md, repeated verbatim in DECISIONS 2026-08-08): a class is ready
  // for a batch iff mean IoU >= 0.90 AND no held-out card is below 0.85. Boundary
  // distance is a SECONDARY diagnostic and never promotes a class: the previous lane
  // proved edge metrics measure precision, not correctness.
  const barMean = Number(arg('bar-mean') ?? '0.90');
  const barMin = Number(arg('bar-min') ?? '0.85');

  interface EvalRow {
    card: string;
    rect: number;
    gen: number | null;
    delta: number | null;
    bnd: { mean: number; p95: number; max: number } | null;
    note: string;
  }
  const rows: EvalRow[] = [];
  for (const e of held) {
    const artwork = await loadArtwork(serie, e.cardId);
    const humanPng = await readFile(join(ROOT, e.files.mask));
    const humanImg = decodePng(humanPng);
    const human = resampleAlpha(alphaOf(humanImg), humanImg.width, humanImg.height, MASK_W, MASK_H);
    const m = maskForScope(layouts, eraId, scope);
    const rectAlpha = rectCoverage(MASK_W, MASK_H, m.rect, m.radius, m.invert);
    const rectScore = agreement(rectAlpha, human).agreement;
    const card = `${e.cardId}/${e.variantId}`;
    if (!artwork) {
      rows.push({ card, rect: rectScore, gen: null, delta: null, bnd: null, note: 'scan not in image cache' });
      continue;
    }
    // LEAVE-ONE-OUT: the held-out card's own mask is pulled out of the pool the
    // generator learns from. Without that the "evaluation" is the model grading its
    // own homework — the same failure `selectExemplars` exists to prevent.
    const exemplars = await buildExemplars(layouts, eraId, scope, serie, { cardId: e.cardId, variantId: e.variantId });
    if (exemplars.length < gen.minExemplars) {
      rows.push({
        card,
        rect: rectScore,
        gen: null,
        delta: null,
        bnd: null,
        note: `only ${exemplars.length} other exemplar(s); ${gen.name} needs ${gen.minExemplars}`,
      });
      continue;
    }
    const out = gen.generate({
      target: targetFor(layouts, e.cardId, e.variantId, eraId, scope, serie, null, artwork),
      exemplars,
    });
    const genScore = agreement(out.alpha, human).agreement;
    // --dump writes what was actually scored, so review screenshots come out of the
    // evaluated code path rather than a re-implementation that can quietly diverge.
    const dumpDir = arg('dump');
    if (dumpDir) {
      await mkdir(dumpDir, { recursive: true });
      const base = join(dumpDir, `${e.cardId}-${e.variantId}`);
      await writeFile(`${base}.loo.png`, encodePng({ width: MASK_W, height: MASK_H, rgba: tintAlpha(out.alpha) }));
      await writeFile(`${base}.human.png`, encodePng({ width: MASK_W, height: MASK_H, rgba: tintAlpha(human) }));
      await writeFile(`${base}.rule.png`, encodePng({ width: MASK_W, height: MASK_H, rgba: tintAlpha(rectAlpha) }));
    }
    rows.push({
      card,
      rect: rectScore,
      gen: genScore,
      delta: Number((genScore - rectScore).toFixed(4)),
      bnd: boundaryDistance(out.alpha, human, MASK_W, MASK_H),
      note: out.notes,
    });
  }
  console.log('card                 rect-only   generator     delta    bnd mean      p95');
  for (const r of rows) {
    console.log(
      `${r.card.padEnd(20)} ${r.rect.toFixed(4)}      ${r.gen === null ? '  —   ' : r.gen.toFixed(4)}    ${
        r.delta === null ? '   —   ' : ((r.delta >= 0 ? '+' : '') + r.delta.toFixed(4)).padStart(8)
      }  ${r.bnd ? `${r.bnd.mean.toFixed(2).padStart(8)}px ${r.bnd.p95.toFixed(1).padStart(6)}px` : '       —         —'}`,
    );
    if (r.note) console.log(`  ↳ ${r.note}`);
  }
  const scored = rows.filter((r) => r.gen !== null);
  if (!scored.length) {
    console.log('\nnothing scored — no verdict.');
    return;
  }
  const mr = scored.reduce((a, r) => a + r.rect, 0) / scored.length;
  const mg = scored.reduce((a, r) => a + (r.gen ?? 0), 0) / scored.length;
  const worst = scored.reduce((a, r) => ((r.gen ?? 1) < (a.gen ?? 1) ? r : a));
  console.log(
    `\nmean rect-only ${mr.toFixed(4)}  →  mean generator ${mg.toFixed(4)}  (delta ${(mg - mr >= 0 ? '+' : '') + (mg - mr).toFixed(4)})`,
  );
  const pass = mg >= barMean && (worst.gen ?? 0) >= barMin;
  console.log(
    `\nBAR (stated before this generator produced a single number): mean IoU >= ${barMean.toFixed(2)}, no card below ${barMin.toFixed(2)}.\n` +
      `  mean ${mg.toFixed(4)} ${mg >= barMean ? '>=' : '<'} ${barMean.toFixed(2)}    worst ${worst.card} ${(worst.gen ?? 0).toFixed(4)} ${
        (worst.gen ?? 0) >= barMin ? '>=' : '<'
      } ${barMin.toFixed(2)}\n` +
      `  VERDICT: ${pass ? 'PASS — a batch for this class is justified.' : 'FAIL — do NOT generate a batch for this class.'}`,
  );
  console.log(
    `\nn=${held.length}, so this is a small test — but it is held-out, and it is the only honest one available.\n` +
      'A positive delta over the rect says the pipeline runs; only the BAR says whether to ship.',
  );
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
  const refine = flag('refine');
  if (gen.requiresSource && !refine) {
    throw new Error(
      `${gen.name} is a REFINER: it reworks an existing human mask rather than proposing one. Pass --refine, ` +
        'which loads the mask already at each target as the source and archives it byte-for-byte before writing.',
    );
  }
  const m = maskForScope(layouts, eraId, scope);

  for (const t of targets) {
    const existing = await readSidecarFile(MASKS_DIR, t.cardId, t.variantId);
    // NEVER overwrite a human mask with a machine proposal — unless the run is
    // an explicit --refine of that very mask, which archives it first.
    if (existing && existing.derivation_method !== 'ai' && !refine) {
      console.log(`skip ${t.cardId}/${t.variantId}: already has a ${existing.derivation_method} mask (human work is never overwritten)`);
      continue;
    }

    // ── Refine mode: the source mask, and the rule that keeps it honest ──
    let source: GeneratorSource | null = null;
    if (refine) {
      if (!existing) {
        console.log(`skip ${t.cardId}/${t.variantId}: --refine needs an existing mask and there is none`);
        continue;
      }
      // ANTI-COMPOUNDING: a refiner may not eat unreviewed machine output. Same
      // rule as selectExemplars, applied to the SOURCE rather than the corpus —
      // otherwise a straightener would nudge a boundary every pass forever.
      if (EXEMPLAR_WEIGHT[existing.derivation_method] === 0) {
        console.log(
          `skip ${t.cardId}/${t.variantId}: source mask is ${existing.derivation_method} (exemplar weight 0). ` +
            'A refiner only reworks masks a human painted.',
        );
        continue;
      }
      const srcPng = await readFile(maskPathsIn(MASKS_DIR, t.cardId, t.variantId).png).catch(() => null);
      if (!srcPng) {
        console.log(`skip ${t.cardId}/${t.variantId}: sidecar present but no mask PNG`);
        continue;
      }
      const srcImg = decodePng(srcPng);
      source = {
        ref: {
          cardId: t.cardId,
          variantId: t.variantId,
          savedAt: existing.savedAt ?? null,
          method: existing.derivation_method,
          weight: EXEMPLAR_WEIGHT[existing.derivation_method],
          sha256: sha256(srcPng),
        },
        alpha: resampleAlpha(alphaOf(srcImg), srcImg.width, srcImg.height, MASK_W, MASK_H),
        image: srcImg,
        method: existing.derivation_method,
      };
    }

    const artwork = await loadArtwork(serie, t.cardId);
    if (!artwork) {
      console.log(`skip ${t.cardId}/${t.variantId}: scan not in the image cache`);
      continue;
    }
    // Say it out loud, per card, before the generator runs. A lossy fallback
    // that only shows up in a JSON field is a fallback nobody reads.
    const prov = artProvenance(t.cardId);
    if (prov) console.log(`  art  ${t.cardId}: ${prov.note}`);
    const target = targetFor(layouts, t.cardId, t.variantId, eraId, scope, serie, seriesSlug, artwork);
    // A refine inherits the geometry the source was drawn against, including
    // the window rect Chey adjusted by hand — a generator must not have to
    // rediscover a decision he already made.
    if (source && existing?.prior?.window) target.window = existing.prior.window;
    const out = gen.generate({ target, exemplars, source });

    const png = encodePng({ width: MASK_W, height: MASK_H, rgba: tintAlpha(out.alpha) });

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
      params: {
        ...gen.params,
        era: eraId,
        scope,
        notes: out.notes,
        // WHICH PIXELS THIS WAS FITTED TO. A boundary localised to 0.2px is a
        // claim about an image; the mask has to be able to say which image.
        ...provenanceParams(t.cardId),
        ...(source ? { source: `${source.ref.cardId}/${source.ref.variantId}@${source.ref.method}`, sourceSha256: source.ref.sha256 } : {}),
        ...(out.report ? { report: JSON.stringify(out.report) } : {}),
      },
      // A refiner's evidence is the mask it was handed; say so explicitly
      // instead of implying it generalised from a corpus it never read.
      exemplars: source ? [{ ...source.ref }] : exemplars.map((e) => e.ref),
      confidence: out.confidence,
      generatedAt: new Date().toISOString(),
    };
    const rectScore = agreement(rasterizePriorAlpha(MASK_W, MASK_H, prior), out.alpha);
    if (dry) {
      console.log(`[dry] ${t.cardId}/${t.variantId}  conf=${String(out.confidence)}  vs-rect agreement=${rectScore.agreement}`);
      if (out.notes) console.log(`  ↳ ${out.notes}`);
      // --dump makes review screenshots come out of the REAL code path instead of a
      // re-implementation that can quietly diverge from what would be written.
      const dumpDir = arg('dump');
      if (dumpDir) {
        await mkdir(dumpDir, { recursive: true });
        const base = join(dumpDir, `${t.cardId}-${t.variantId}`);
        await writeFile(`${base}.proposal.png`, png);
        await writeFile(`${base}.rule.png`, encodePng({ width: MASK_W, height: MASK_H, rgba: tintAlpha(rasterizePriorAlpha(MASK_W, MASK_H, prior)) }));
        await writeFile(
          `${base}.report.json`,
          JSON.stringify({ card: t, confidence: out.confidence, notes: out.notes, vsRect: rectScore, report: out.report ?? null }, null, 2),
        );
        console.log(`  ↳ dumped ${base}.{proposal,rule}.png + .report.json`);
      }
      // A dry run's whole job is showing the reviewer WHICH parts of the
      // boundary the generator would move and why — the notes are the summary,
      // this is the evidence. Refusals are never truncated; they are the part a
      // reviewer most needs to see.
      const segs = (out.report?.segments ?? null) as Record<string, unknown>[] | null;
      if (segs) {
        const limit = Number(arg('max-segments') ?? '40');
        const moved = segs.filter((s) => s.action === 'traced' || s.action === 'artwork' || s.action === 'window' || s.action === 'self');
        const held = segs.filter((s) => !moved.includes(s));
        const fmt = (s: Record<string, unknown>): string =>
          `    ${String(s.action).padEnd(7)} L${String(s.loop)}#${String(s.index).padStart(3)} ` +
          `${String(s.lengthPx ?? s.handLengthPx ?? '?').padStart(5)}px ` +
          `${s.meanMovePx == null ? '' : `move μ${String(s.meanMovePx)}/max${String(s.maxMovePx)} `}` +
          `${s.meanRidge == null ? '' : `ridge ${String(s.meanRidge)} `}` +
          `${String(s.reason ?? '')}`;
        const shown = [...moved].sort((a, b) => Number(b.maxMovePx ?? b.maxDeviationPx ?? 0) - Number(a.maxMovePx ?? a.maxDeviationPx ?? 0)).slice(0, limit);
        console.log(`  segments: ${segs.length} total — ${moved.length} moved, ${held.length} held. Largest moves first:`);
        for (const s of shown) console.log(fmt(s));
        if (moved.length > shown.length) console.log(`    … ${moved.length - shown.length} more moved segment(s) (--max-segments to widen)`);
        if (held.length) {
          console.log('  held (his hand, exactly as drawn):');
          for (const s of held) console.log(fmt(s));
        }
      }
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
      card: {
        setId: target.setId,
        seriesSlug: target.seriesSlug,
        name: existing?.card?.name ?? null,
        number: existing?.card?.number ?? null,
      },
      machine: identity,
      ...(existing ? { supersede: { runId } } : {}),
    });
    console.log(
      `wrote ${t.cardId}/${t.variantId}  method=${sidecar.derivation_method}  review=${sidecar.reviewStatus}  conf=${String(out.confidence)}` +
        (sidecar.supersedes
          ? `\n  superseded ${sidecar.supersedes.parent.method} mask (agreement ${sidecar.supersedes.agreement}, ` +
            `${sidecar.supersedes.changedPx}px changed); original archived at ${sidecar.supersedes.archiveDir}`
          : ''),
    );
    if (out.notes) console.log(`  ↳ ${out.notes}`);
  }
  if (!dry) {
    console.log(
      `\nrun ${runId}: ${targets.length} target(s). All masks are \`ai\` / unreviewed — they are PROPOSALS.\n` +
        (refine
          ? 'A superseded human mask is NOT an exemplar while the proposal sits on top of it — reverting or\n' +
            'correcting the proposal brings it back into the training pool.\n'
          : '') +
        `Revert with: pnpm --filter deckscout-api exec tsx src/foil/generate-masks.ts revert --run-id ${runId}`,
    );
  }
}

// ── revert: undo a run — RESTORE what it replaced, delete what it added ────
//
// The old behaviour (delete the `ai` mask) is still right for a proposal on a
// card that had nothing. But a refine run replaced a real mask, and deleting
// there would destroy the very thing it was supposed to be reversible against.
// So revert restores from the run's verbatim archive, sha256-verified, and only
// falls back to deletion when the run genuinely created a mask from nothing.

async function revert(): Promise<void> {
  const runId = arg('run-id');
  if (!runId) throw new Error('revert requires --run-id');

  let restored = 0;
  for (const archive of await findArchives(MASKS_DIR, runId)) {
    const live = await readSidecarFile(MASKS_DIR, archive.cardId, archive.variantId);
    // Only undo machine output. If a human has since corrected it, HIS work is
    // now the truth — the archive stays put and says so.
    if (live && live.derivation_method !== 'ai' && !flag('force')) {
      console.log(
        `keep ${archive.cardId}/${archive.variantId}: now a ${live.derivation_method} mask — a human has edited it since. ` +
          `The original is still at ${archive.dir}; pass --force to put it back anyway.`,
      );
      continue;
    }
    const r = await restoreArchive(MASKS_DIR, archive);
    restored++;
    console.log(
      `restored ${r.cardId}/${r.variantId} → ${r.method} (${r.restored.length} files, sha256-verified: ` +
        `${r.restored.map((f) => f.file).join(', ')})`,
    );
  }

  const corpus = await readCorpus(MASKS_DIR);
  let removed = 0;
  for (const e of corpus) {
    const g = e.sidecar.prior?.generator;
    if (e.sidecar.derivation_method !== 'ai' || g?.runId !== runId) continue;
    const p = maskPathsIn(MASKS_DIR, e.cardId, e.variantId);
    for (const f of [p.png, p.json, p.prior, p.diff, p.parent, p.parentDiff]) await unlink(f).catch(() => undefined);
    // …and the card directory the run created, if it is now empty. "Byte-identical"
    // has to mean the TREE too: an empty `data/foil-masks/me05-014/` left behind is a
    // card that looks masked to anything that lists the directory, and `readCorpus`
    // walks directories. Only ever removed when the run created it and nothing else
    // (no sibling variant, no `superseded/` archive) lives there.
    await rmdir(join(MASKS_DIR, e.cardId)).catch(() => undefined);
    removed++;
    console.log(`removed ${e.cardId}/${e.variantId} (this run created it; there was nothing underneath)`);
  }
  console.log(
    `\nrun ${runId}: restored ${restored} superseded mask(s) byte-for-byte, removed ${removed} freshly-created one(s). ` +
      'Human masks the run never touched were not looked at.',
  );
}

// ── adherence: does this boundary actually sit on the card's printed edges? ─
//
// The number that settles "is the new mask better", instead of asserting it.
// Any set of mask PNGs, one card scan, one table. Default probe is line-snap's
// own luminance Sobel — NOT edge-trace's colour tensor — so the incumbent gets
// the home field and a win means something.
//
//   pnpm --filter deckscout-api exec tsx src/foil/generate-masks.ts adherence \
//     --serie me --card me05-001 \
//     --masks "his=data/foil-masks/me05-001/37184.png,archived=data/…/37184.png"

async function adherence(): Promise<void> {
  const serie = arg('serie');
  const cardId = arg('card');
  const masksArg = arg('masks');
  if (!serie || !cardId || !masksArg) throw new Error('adherence requires --serie --card --masks <label>=<path>[,…]');
  const artwork = await loadArtwork(serie, cardId);
  if (!artwork) throw new Error(`scan for ${cardId} is not in the image cache (serie ${serie})`);
  const which = (arg('probe') ?? 'luminance') as 'luminance' | 'tensor';
  const params: AdherenceParams = {
    searchPx: Number(arg('search') ?? DEFAULT_ADHERENCE_PARAMS.searchPx),
    strengthFloor: Number(arg('floor') ?? (which === 'tensor' ? 24 : DEFAULT_ADHERENCE_PARAMS.strengthFloor)),
    samplePx: DEFAULT_ADHERENCE_PARAMS.samplePx,
  };
  const probe =
    which === 'tensor'
      ? tensorProbe(buildEdgeMap(artwork, DEFAULT_EDGE_TRACE_PARAMS).tensor)
      : luminanceProbe(gradientOf(artwork));

  console.log(
    `\nEDGE ADHERENCE  card=${cardId}  probe=${which}  floor=${params.strengthFloor}  search=±${params.searchPx}px\n` +
      `${artProvenance(cardId)?.note ?? 'art provenance unknown'}\n` +
      'Distance from each boundary sample to the NEAREST edge maximum along its own normal.\n' +
      '"supp%" = share of boundary with any such edge at all — where it is low, the mask is\n' +
      'following something the probe cannot see, which is a fact about the probe as much as the mask.\n',
  );
  console.log('mask                            bnd px  supp%  <=1px%  <=1px|supp   mean    p95    max');
  for (const entry of masksArg.split(',')) {
    const eq = entry.indexOf('=');
    const label = eq > 0 ? entry.slice(0, eq) : entry;
    const rel = eq > 0 ? entry.slice(eq + 1) : entry;
    const png = await readFile(rel.startsWith('/') ? rel : join(ROOT, rel)).catch(() => null);
    if (!png) {
      console.log(`${label.padEnd(30)} (not found: ${rel})`);
      continue;
    }
    const img = decodePng(png);
    const alpha = resampleAlpha(alphaOf(img), img.width, img.height, MASK_W, MASK_H);
    const m = measureAdherence(alpha, MASK_W, MASK_H, probe, params);
    console.log(
      `${label.padEnd(30)} ${String(m.boundaryPx).padStart(7)} ${(m.supportedFrac * 100).toFixed(1).padStart(6)} ` +
        `${(m.within1px * 100).toFixed(1).padStart(7)} ${(m.within1pxOfSupported * 100).toFixed(1).padStart(11)} ` +
        `${m.meanDistPx.toFixed(3).padStart(6)} ${m.p95DistPx.toFixed(2).padStart(6)} ${m.maxDistPx.toFixed(2).padStart(6)}`,
    );
  }
}

// ── archives: what is currently undoable, and from when ───────────────────

async function archives(): Promise<void> {
  const found = await findArchives(MASKS_DIR, arg('run-id'));
  if (found.length === 0) {
    console.log('no generator archives on disk — nothing was superseded.');
    return;
  }
  for (const a of found) {
    console.log(
      `${a.cardId}/${a.variantId}  run=${a.runId}  was=${a.manifest.method}  archived=${a.manifest.archivedAt}\n` +
        `  ${Object.keys(a.manifest.files).length} files at ${a.dir}\n` +
        `  undo: pnpm --filter deckscout-api exec tsx src/foil/generate-masks.ts revert --run-id ${a.runId}`,
    );
  }
}

const CMD = process.argv[2];
const main =
  CMD === 'eval'
    ? evaluate
    : CMD === 'run'
      ? run
      : CMD === 'revert'
        ? revert
        : CMD === 'archives'
          ? archives
          : CMD === 'adherence'
            ? adherence
            : null;
if (!main) {
  console.error('usage: generate-masks.ts <eval|run|revert|archives|adherence> [flags] — see the header comment');
  process.exit(2);
}

/** The run's honest provenance ledger — printed whether or not it went well. */
function reportArtProvenance(): void {
  if (ART.stats.requests === 0) return;
  console.log(`\n${ART.summary()}`);
  const lossy = Object.entries(ART.stats.fallbackReasons);
  if (lossy.length && analysisPreference() === 'lossless') {
    console.log('LOSSY FALLBACKS — these cards were analysed on the cached WebP, not lossless pixels:');
    for (const [cardId, why] of lossy) console.log(`  ${cardId}: ${why}`);
  }
}

void main()
  .then(reportArtProvenance)
  .catch((e: Error) => {
    reportArtProvenance();
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(closeAnalysisSource);
