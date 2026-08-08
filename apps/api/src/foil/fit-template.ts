// foil/fit-template.ts — fit, measure and verify the vector LAYOUT TEMPLATE.
//
// The artifact this lane ships is a template, not a batch of masks (Chey, 2026-08-08: "We
// don't need 3,454 vector masks. All of these share the same 2 layouts really."). So the CLI
// is about the template: fit it from his masks, measure how vector-like the result is
// against his masks and against the previous generator, and verify it over a sample of the
// population without generating anything.
//
//   fit        --era modern-sv --scope sheet --serie me --run-id <id> [--out <file>]
//   vectorness --era modern-sv --scope sheet --serie me [--dump <dir>]
//   sample     --era modern-sv --scope sheet --limit 300 [--out <file>]
//
// Exemplars are ALWAYS chosen through selectExemplars() — unreviewed `ai` masks are never
// evidence, at any corpus size, under any flag.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { decodePng, encodePng, type RgbaImage } from './png.js';
import { alphaOf } from './provenance.js';
import { readCorpus, selectExemplars, setIdOf } from './mask-corpus.js';
import {
  fitTemplate, discoverOptionalElement, probeOptional, rasterizeTemplate, vectorness,
  DEFAULT_VECTOR_FIT_PARAMS, VECTORNESS_TOLERANCE_PX, VECTORNESS_LONG_PRIM_PX, type VectorTemplate,
} from './vector-template.js';
import { iou, boundaryDistance } from './region-learn.js';

const ROOT = join(import.meta.dirname, '../../../..');
const MASKS_DIR = join(ROOT, 'data/foil-masks');
const CACHE_ROOT = process.env.IMAGE_CACHE_ROOT ?? '/home/cheyras/pokedex/cache';
const TEMPLATE_FILE = join(ROOT, 'apps/web/src/foil/vector-templates.json');
const MASK_W = 490;
const MASK_H = Math.round((MASK_W * 337) / 245);

const argv = process.argv.slice(2);
const arg = (n: string): string | null => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1]! : null;
};

function loadArtwork(serie: string, cardId: string, w = MASK_W, h = MASK_H): RgbaImage | null {
  const setId = setIdOf(cardId);
  if (!setId) return null;
  const localId = cardId.slice(setId.length + 1);
  const p = `${CACHE_ROOT}/images/en/${serie}/${setId}/${localId}.high.webp`;
  if (!existsSync(p)) return null;
  try {
    return decodePng(execFileSync('magick', [p, '-resize', `${w}x${h}!`, 'png32:-'], { maxBuffer: 64 * 1024 * 1024 }));
  } catch { return null; }
}

function resample(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  if (sw === dw && sh === dh) return Uint8Array.from(src);
  const out = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
    for (let x = 0; x < dw; x++) out[y * dw + x] = src[sy * sw + Math.min(sw - 1, Math.floor((x * sw) / dw))]!;
  }
  return out;
}

interface LoadedExemplar {
  cardId: string; variantId: number; method: string; weight: number;
  alpha: Uint8Array; evolves: boolean;
}

async function loadExemplars(eraId: string, scope: string): Promise<{ ex: LoadedExemplar[]; rejected: string[] }> {
  const corpus = await readCorpus(MASKS_DIR);
  const sel = selectExemplars(corpus, { eraId, scope });
  const ex: LoadedExemplar[] = [];
  for (const e of sel.chosen) {
    const img = decodePng(await readFile(join(ROOT, e.files.mask)));
    ex.push({
      cardId: e.cardId, variantId: e.variantId,
      method: e.sidecar.derivation_method, weight: e.weight,
      alpha: resample(alphaOf(img), img.width, img.height, MASK_W, MASK_H),
      evolves: false,
    });
  }
  return { ex, rejected: sel.rejected.map((r) => `${r.cardId}/${r.variantId} ${r.method} — ${r.reason}`) };
}

/** Split the corpus on the optional element it discovers in the corpus itself. */
function classify(ex: LoadedExemplar[]): ReturnType<typeof discoverOptionalElement> {
  const opt = discoverOptionalElement(ex.map((e) => ({ cardId: e.cardId, alpha: e.alpha })), MASK_W, MASK_H);
  if (!opt) return null;
  for (const e of ex) {
    const s = opt.shares.find((x) => x.cardId === e.cardId)!;
    e.evolves = s.share < opt.split;
  }
  return opt;
}

async function cmdFit(): Promise<void> {
  const eraId = arg('era') ?? 'modern-sv';
  const scope = arg('scope') ?? 'sheet';
  const runId = arg('run-id') ?? `vectemplate-${Date.now()}`;
  const out = arg('out') ?? TEMPLATE_FILE;

  const { ex, rejected } = await loadExemplars(eraId, scope);
  console.log(`exemplars: ${ex.length} chosen, ${rejected.length} rejected`);
  for (const r of rejected) console.log(`  REJECTED ${r}`);
  if (ex.length < 2) throw new Error('need at least 2 human exemplars');

  const opt = classify(ex);
  if (opt) {
    console.log(`\noptional element discovered from the corpus (not asserted): ${opt.px}px, ` +
      `cluster separation ${(opt.separation * 100).toFixed(1)}pp, split at ${opt.split.toFixed(3)}`);
    for (const s of opt.shares.sort((a, b) => a.share - b.share)) {
      console.log(`  ${s.cardId}  foil-share ${(s.share * 100).toFixed(1).padStart(5)}%  ${s.share < opt.split ? 'HAS the element' : 'lacks it'}`);
    }
  } else console.log('\nno optional element found — one unconditional layout');

  const res = fitTemplate({ exemplars: ex, width: MASK_W, height: MASK_H, eraId, scope, runId });
  console.log(`\n${res.template.provenance.statement}`);

  // Score the template against every exemplar it was fitted from (in-sample; the honest
  // held-out number comes from `generate-masks.ts eval`).
  console.log('\nin-sample fit (NOT held out — see `eval` for the real number):');
  let sum = 0;
  for (const e of ex) {
    const a = rasterizeTemplate(res.template, MASK_W, MASK_H, { evolves: e.evolves });
    const s = iou(a, e.alpha);
    sum += s;
    const b = boundaryDistance(a, e.alpha, MASK_W, MASK_H);
    console.log(`  ${e.cardId}/${e.variantId} ${e.evolves ? 'evolves' : 'basic  '} IoU ${s.toFixed(4)}  boundary mean ${b.mean}px p95 ${b.p95}px`);
  }
  console.log(`  mean IoU ${(sum / ex.length).toFixed(4)}`);

  const payload = { version: 1, templates: [res.template] };
  await writeFile(out, JSON.stringify(payload, null, 2) + '\n');
  const bytes = Buffer.byteLength(JSON.stringify(payload, null, 2));
  console.log(`\nwrote ${out} (${bytes} bytes, ${(bytes / 1024).toFixed(1)} KB)`);
}

async function cmdVectorness(): Promise<void> {
  const eraId = arg('era') ?? 'modern-sv';
  const scope = arg('scope') ?? 'sheet';
  const serie = arg('serie') ?? 'me';
  const dump = arg('dump');
  if (dump) await mkdir(dump, { recursive: true });

  const { ex } = await loadExemplars(eraId, scope);
  const opt = classify(ex);
  if (!opt) throw new Error('no optional element');
  const tpl: VectorTemplate = JSON.parse(await readFile(TEMPLATE_FILE, 'utf8')).templates[0];

  console.log('VECTOR-NESS — how much of a boundary is clean analytic geometry.');
  console.log('Not a quality score: a perfect vector boundary in the wrong place is still wrong.');
  console.log(`IoU gates; this describes. Decomposed at tolerance ${VECTORNESS_TOLERANCE_PX}px,`);
  console.log(`"long" = a primitive of at least ${VECTORNESS_LONG_PRIM_PX}px.\n`);
  console.log('The region-learn@1 rows are its ACTUAL shipped output — the `.parent.png` Chey');
  console.log('corrected, not a re-run — so this compares what he saw with what he drew.\n');
  console.log('source                          longFrac  prim/kpx  residual(px)  axis-aligned  IoU-vs-his');
  console.log('─'.repeat(96));

  const acc: Record<string, number[][]> = { HIS: [], 'region-learn@1': [], 'vector-template@1': [] };
  const push = (k: string, v: ReturnType<typeof vectorness>): void => {
    acc[k]!.push([v.explainedLong, v.primitivesPerKpx, v.residualPx, v.axisAlignedFrac]);
  };
  const line = (label: string, v: ReturnType<typeof vectorness>, io: number | null): void =>
    console.log(
      `${label.padEnd(31)} ${v.explainedLong.toFixed(4).padStart(8)}  ${v.primitivesPerKpx.toFixed(2).padStart(8)}  ` +
      `${v.residualPx.toFixed(4).padStart(12)}  ${v.axisAlignedFrac.toFixed(4).padStart(12)}  ` +
      `${io === null ? '     —' : io.toFixed(4).padStart(6)}`);

  for (const e of ex.sort((a, b) => a.cardId.localeCompare(b.cardId))) {
    const vHand = vectorness(e.alpha, MASK_W, MASK_H);
    line(`HIS   ${e.cardId}/${e.variantId}`, vHand, null);
    push('HIS', vHand);

    // region-learn@1's real output, when this card is one he corrected.
    const parentPath = join(MASKS_DIR, e.cardId, `${e.variantId}.parent.png`);
    if (existsSync(parentPath)) {
      const pimg = decodePng(await readFile(parentPath));
      const pa = resample(alphaOf(pimg), pimg.width, pimg.height, MASK_W, MASK_H);
      const vP = vectorness(pa, MASK_W, MASK_H);
      line('  region-learn@1', vP, iou(pa, e.alpha));
      push('region-learn@1', vP);
      if (dump) await writeFile(join(dump, `${e.cardId}.rl.png`), encodePng({ width: MASK_W, height: MASK_H, rgba: tint(pa) }));
    }

    const a = rasterizeTemplate(tpl, MASK_W, MASK_H, { evolves: e.evolves });
    const vT = vectorness(a, MASK_W, MASK_H);
    line('  vector-template@1', vT, iou(a, e.alpha));
    push('vector-template@1', vT);

    if (dump) {
      await writeFile(join(dump, `${e.cardId}.tpl.png`), encodePng({ width: MASK_W, height: MASK_H, rgba: tint(a) }));
      await writeFile(join(dump, `${e.cardId}.his.png`), encodePng({ width: MASK_W, height: MASK_H, rgba: tint(e.alpha) }));
    }
  }
  const mean = (rowsA: number[][], k: number): string =>
    (rowsA.reduce((a, b) => a + b[k]!, 0) / rowsA.length).toFixed(4);
  console.log('─'.repeat(96));
  for (const k of ['HIS', 'region-learn@1', 'vector-template@1']) {
    const r = acc[k]!;
    if (!r.length) continue;
    console.log(`MEAN ${k.padEnd(26)} ${mean(r, 0).padStart(8)}  ${mean(r, 1).padStart(8)}  ${mean(r, 2).padStart(12)}  ${mean(r, 3).padStart(12)}   (n=${r.length})`);
  }
  void serie;
}

const tint = (a: Uint8Array): Uint8Array => {
  const rgba = new Uint8Array(a.length * 4);
  for (let i = 0; i < a.length; i++) { rgba[i * 4] = 255; rgba[i * 4 + 1] = 45; rgba[i * 4 + 2] = 100; rgba[i * 4 + 3] = a[i]!; }
  return rgba;
};

async function main(): Promise<void> {
  const cmd = argv[0];
  if (cmd === 'fit') await cmdFit();
  else if (cmd === 'vectorness') await cmdVectorness();
  else {
    console.log('usage: fit-template.ts <fit|vectorness> --era <id> --scope <scope> [--serie <s>] [--run-id <id>] [--out <file>] [--dump <dir>]');
    process.exit(2);
  }
}
await main();
