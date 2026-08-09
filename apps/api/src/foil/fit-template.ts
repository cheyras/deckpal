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
import { measureAdherence, luminanceProbe } from './edge-trace.js';
import { gradientOf } from './line-snap.js';

const ROOT = join(import.meta.dirname, '../../../..');
const MASKS_DIR = join(ROOT, 'data/foil-masks');
const CACHE_ROOT = process.env.IMAGE_CACHE_ROOT ?? join(ROOT, 'cache');
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

/**
 * Did the template learn HIS CORRECTION, or the machine version he rejected?
 *
 * For every mask he corrected we have both: the parent (`region-learn@1`'s proposal) and
 * the corrected mask. A generator that merely reproduced the previous generation would sit
 * closer to the parent. The number that matters is the MARGIN — IoU against his corrected
 * mask minus IoU against the parent — and it has to be positive on every card, not on
 * average, or the template is partly re-learning the mistake he took the time to fix.
 */
async function cmdCorrections(): Promise<void> {
  const eraId = arg('era') ?? 'modern-sv';
  const scope = arg('scope') ?? 'sheet';
  const { ex } = await loadExemplars(eraId, scope);
  classify(ex);
  const tpl: VectorTemplate = JSON.parse(await readFile(TEMPLATE_FILE, 'utf8')).templates[0];

  console.log('DID IT LEARN HIS CORRECTION, OR THE MACHINE VERSION HE REJECTED?\n');
  console.log('card                  vs HIS(corrected)  vs PARENT(region-learn@1)   margin   verdict');
  console.log('─'.repeat(88));
  let worst = Infinity;
  let n = 0;
  for (const e of ex.sort((a, b) => a.cardId.localeCompare(b.cardId))) {
    const parentPath = join(MASKS_DIR, e.cardId, `${e.variantId}.parent.png`);
    if (!existsSync(parentPath)) continue;
    const pimg = decodePng(await readFile(parentPath));
    const parent = resample(alphaOf(pimg), pimg.width, pimg.height, MASK_W, MASK_H);
    const mine = rasterizeTemplate(tpl, MASK_W, MASK_H, { evolves: e.evolves });
    const vsHis = iou(mine, e.alpha);
    const vsParent = iou(mine, parent);
    const margin = vsHis - vsParent;
    if (margin < worst) worst = margin;
    n++;
    console.log(
      `${(e.cardId + '/' + e.variantId).padEnd(21)} ${vsHis.toFixed(4).padStart(17)}  ${vsParent.toFixed(4).padStart(24)}  ` +
      `${(margin >= 0 ? '+' : '') + margin.toFixed(4)}   ${margin > 0 ? 'HIS' : 'PARENT — investigate'}`);
  }
  console.log('─'.repeat(88));
  console.log(`${n} corrected cards; worst margin ${(worst >= 0 ? '+' : '') + worst.toFixed(4)}`);
  console.log(worst > 0
    ? 'PASS — on every card the template is closer to what he drew than to what he rejected.'
    : 'FAIL — at least one card sits closer to the machine version. Do not ship.');
}

/**
 * Verify the template over the POPULATION without generating over the population.
 *
 * Two independent checks per sampled card, neither of which needs a hand mask:
 *
 *  1. ADHERENCE — does the template's boundary actually sit on THIS card's printed edges?
 *     Measured with line-snap's luminance Sobel, i.e. a probe this generator never
 *     optimised against, so the incumbent keeps the home field.
 *  2. THE OPTIONAL-ELEMENT PROBE vs THE CATALOG — the template reads "does this card have
 *     the medallion" off the artwork; the catalog knows it from `card.stage`. They were
 *     derived completely independently, so agreement over hundreds of cards is real
 *     evidence that the per-card parameter is being read correctly, and every disagreement
 *     is either a probe failure or a genuinely odd card. Both are worth seeing.
 *
 * EXCEPTION RULE, stated before the numbers exist: a card is an exception if its
 * `within1px` adherence is below `median − 3×MAD` of the sample, or below an absolute floor
 * of 0.60, or if the probe disagrees with the catalog. Exceptions are LISTED, not fixed —
 * the list is the deliverable, and it is what a hand mask should be spent on.
 */
const ADHERENCE_ABS_FLOOR = 0.60;
const MAD_K = 3;

async function cmdSample(): Promise<void> {
  const eraId = arg('era') ?? 'modern-sv';
  const scope = arg('scope') ?? 'sheet';
  const perSet = Number(arg('per-set') ?? '15');
  const popFile = arg('pop')!;
  const outFile = arg('out');

  const { ex } = await loadExemplars(eraId, scope);
  const opt = classify(ex);
  if (!opt) throw new Error('no optional element discovered');
  const tpl: VectorTemplate = JSON.parse(await readFile(TEMPLATE_FILE, 'utf8')).templates[0];

  const rows = (await readFile(popFile, 'utf8')).split('\n').filter(Boolean).map((l) => {
    const [cardId, setId, series, category, stage, name] = l.split('\t');
    return { cardId: cardId!, setId: setId!, series: series!, category: category!, stage: stage!, name: name ?? '' };
  });
  // Stratified: every set represented, evenly spaced through its numbering so the sample
  // is not all low-numbered Basics.
  const bySet = new Map<string, typeof rows>();
  for (const r of rows) (bySet.get(r.setId) ?? bySet.set(r.setId, []).get(r.setId)!).push(r);
  const sample: typeof rows = [];
  for (const [, list] of [...bySet.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const step = Math.max(1, Math.floor(list.length / perSet));
    for (let i = 0; i < list.length && sample.filter((s) => s.setId === list[0]!.setId).length < perSet; i += step) sample.push(list[i]!);
  }
  console.log(`population ${rows.length} distinct cards across ${bySet.size} sets; sampling ${sample.length} (~${perSet}/set)\n`);

  interface Res { cardId: string; setId: string; category: string; stage: string; name: string; within1px: number; supported: number; meanPx: number; probeHas: boolean; catalogHas: boolean; chroma: number }
  const res: Res[] = [];
  const skipped: { cardId: string; reason: string }[] = [];
  const t0 = Date.now();
  for (const r of sample) {
    const serie = r.setId.startsWith('sv') || r.setId.startsWith('me02.5') ? 'sv' : 'me';
    const art = loadArtwork(serie, r.cardId) ?? loadArtwork(serie === 'sv' ? 'me' : 'sv', r.cardId);
    if (!art) { skipped.push({ cardId: r.cardId, reason: 'scan not in image cache' }); continue; }
    const probe = probeOptional(art, opt.region);
    const alpha = rasterizeTemplate(tpl, MASK_W, MASK_H, { evolves: probe.hasElement });
    const ad = measureAdherence(alpha, MASK_W, MASK_H, luminanceProbe(gradientOf(art)));
    res.push({
      cardId: r.cardId, setId: r.setId, category: r.category, stage: r.stage, name: r.name,
      within1px: ad.within1px, supported: ad.supportedFrac, meanPx: ad.meanDistPx,
      probeHas: probe.hasElement, catalogHas: r.stage === 'Stage1' || r.stage === 'Stage2',
      chroma: probe.chromaFrac,
    });
  }
  const wall = (Date.now() - t0) / 1000;
  console.log(`scored ${res.length} cards in ${wall.toFixed(1)}s (${(wall / Math.max(1, res.length) * 1000).toFixed(0)} ms/card), ${skipped.length} skipped\n`);

  const vals = res.map((r) => r.within1px).sort((a, b) => a - b);
  const q = (p: number): number => vals[Math.min(vals.length - 1, Math.floor(vals.length * p))] ?? 0;
  const median = q(0.5);
  const mad = [...vals].map((v) => Math.abs(v - median)).sort((a, b) => a - b)[Math.floor(vals.length / 2)] ?? 0;
  const cut = Math.max(ADHERENCE_ABS_FLOOR, median - MAD_K * mad);
  console.log(`ADHERENCE (within1px of a printed edge, luminance probe — NOT the operator this generator uses)`);
  console.log(`  min ${q(0).toFixed(3)}  p05 ${q(0.05).toFixed(3)}  p25 ${q(0.25).toFixed(3)}  median ${median.toFixed(3)}  p75 ${q(0.75).toFixed(3)}  p95 ${q(0.95).toFixed(3)}  max ${q(1).toFixed(3)}`);
  console.log(`  MAD ${mad.toFixed(4)} ⇒ exception cut = max(${ADHERENCE_ABS_FLOOR}, median − ${MAD_K}·MAD) = ${cut.toFixed(3)}\n`);

  const agree = res.filter((r) => r.probeHas === r.catalogHas).length;
  console.log(`OPTIONAL-ELEMENT PROBE vs CATALOG stage: ${agree}/${res.length} agree (${(100 * agree / res.length).toFixed(2)}%)`);
  const disagree = res.filter((r) => r.probeHas !== r.catalogHas);
  for (const d of disagree.slice(0, 20)) {
    console.log(`  DISAGREE ${d.cardId} ${d.name} — catalog ${d.stage}, probe ${d.probeHas ? 'HAS' : 'lacks'} it (chroma ${(d.chroma * 100).toFixed(1)}%)`);
  }
  if (disagree.length > 20) console.log(`  … +${disagree.length - 20} more`);

  const low = res.filter((r) => r.within1px < cut).sort((a, b) => a.within1px - b.within1px);
  console.log(`\nEXCEPTIONS — ${low.length} of ${res.length} cards below the adherence cut:`);
  for (const l of low.slice(0, 30)) console.log(`  ${l.cardId} ${l.setId} ${l.category}/${l.stage} within1px ${l.within1px.toFixed(3)} mean ${l.meanPx}px — ${l.name}`);
  if (low.length > 30) console.log(`  … +${low.length - 30} more`);

  console.log('\nper-set adherence median:');
  const sets = [...new Set(res.map((r) => r.setId))].sort();
  for (const s of sets) {
    const v = res.filter((r) => r.setId === s).map((r) => r.within1px).sort((a, b) => a - b);
    const m = v[Math.floor(v.length / 2)] ?? 0;
    const ag = res.filter((r) => r.setId === s && r.probeHas === r.catalogHas).length;
    console.log(`  ${s.padEnd(9)} n=${String(v.length).padStart(3)}  median ${m.toFixed(3)}  probe-agrees ${ag}/${v.length}${m < cut ? '   ⚠ SET BELOW CUT' : ''}`);
  }
  console.log('\nper-category adherence median:');
  for (const c of [...new Set(res.map((r) => `${r.category}/${r.stage}`))].sort()) {
    const v = res.filter((r) => `${r.category}/${r.stage}` === c).map((r) => r.within1px).sort((a, b) => a - b);
    console.log(`  ${c.padEnd(16)} n=${String(v.length).padStart(3)}  median ${(v[Math.floor(v.length / 2)] ?? 0).toFixed(3)}`);
  }
  if (skipped.length) {
    console.log(`\nSKIPPED (${skipped.length}) — art missing from the cache, never guessed at:`);
    for (const s of skipped.slice(0, 15)) console.log(`  ${s.cardId} — ${s.reason}`);
    if (skipped.length > 15) console.log(`  … +${skipped.length - 15} more`);
  }
  if (outFile) {
    await writeFile(outFile, JSON.stringify({ sampledAt: new Date().toISOString(), cut, median, mad, res, skipped }, null, 2) + '\n');
    console.log(`\nwrote ${outFile}`);
  }
}

async function main(): Promise<void> {
  const cmd = argv[0];
  if (cmd === 'sample') { await cmdSample(); return; }
  if (cmd === 'fit') await cmdFit();
  else if (cmd === 'vectorness') await cmdVectorness();
  else if (cmd === 'corrections') await cmdCorrections();
  else {
    console.log('usage: fit-template.ts <fit|vectorness> --era <id> --scope <scope> [--serie <s>] [--run-id <id>] [--out <file>] [--dump <dir>]');
    process.exit(2);
  }
}
await main();
