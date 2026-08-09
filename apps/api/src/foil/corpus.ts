// foil/corpus.ts — CLI over the hand-mask corpus. DEV TOOL (foil track).
//
//   pnpm --filter deckscout-api exec tsx src/foil/corpus.ts report
//   pnpm --filter deckscout-api exec tsx src/foil/corpus.ts report --json
//   pnpm --filter deckscout-api exec tsx src/foil/corpus.ts tuples --out /tmp/tuples.json
//   pnpm --filter deckscout-api exec tsx src/foil/corpus.ts exemplars --era wotc --scope window
//   pnpm --filter deckscout-api exec tsx src/foil/corpus.ts migrate [--dry-run]
//
// `migrate` rewrites v1/v2 sidecars in place as v3. It NEVER touches the mask
// PNG and never re-labels: a pre-v3 sidecar's `derivation_method` was the
// hardcoded 'hand' placeholder, and every mask that predates this module was in
// fact Pencil-drawn by Chey — so 'hand' is carried forward as the truth it
// happens to be, not re-derived. (From v3 on, the label is computed from pixels
// at write time; see provenance.ts.)

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReport, readCorpus, selectExemplars, trainingTuples } from './mask-corpus.js';
import {
  AUTHORSHIP_BY_METHOD,
  EXEMPLAR_WEIGHT,
  REVIEW_BY_METHOD,
  SIDECAR_VERSION,
  maskPathsIn,
  normalizeSidecar,
} from './provenance.js';

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
const flag = (n: string): boolean => process.argv.includes(`--${n}`);

const pct = (n: number | null): string => (n === null ? '  —  ' : n.toFixed(4));

function printBuckets(title: string, buckets: Record<string, { n: number; byMethod: Record<string, number | undefined>; meanAgreement: number | null }>): void {
  const keys = Object.keys(buckets);
  if (keys.length === 0) return;
  console.log(`\n${title}`);
  for (const k of keys) {
    const b = buckets[k]!;
    const methods = Object.entries(b.byMethod)
      .filter(([, v]) => v)
      .map(([m, v]) => `${m} ${v}`)
      .join(', ');
    console.log(`  ${k.padEnd(18)} n=${String(b.n).padStart(3)}  agree ${pct(b.meanAgreement)}  [${methods}]`);
  }
}

async function report(): Promise<void> {
  const corpus = await readCorpus(MASKS_DIR);
  const r = buildReport(corpus);
  if (flag('json')) {
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  console.log(`\nFOIL MASK CORPUS — ${r.total} mask(s)   ${r.generatedAt}`);
  console.log(`sidecar versions on disk: ${JSON.stringify(r.bySidecarVersion)}  (current: v${SIDECAR_VERSION})`);
  console.log('\nby derivation method');
  for (const [m, n] of Object.entries(r.byMethod)) {
    console.log(
      `  ${m.padEnd(15)} ${String(n).padStart(3)}   ${AUTHORSHIP_BY_METHOD[m as keyof typeof AUTHORSHIP_BY_METHOD]
        .padEnd(8)} ${REVIEW_BY_METHOD[m as keyof typeof REVIEW_BY_METHOD].padEnd(15)} exemplar weight ${
        EXEMPLAR_WEIGHT[m as keyof typeof EXEMPLAR_WEIGHT]
      }`,
    );
  }
  console.log(`\nmean rule-vs-mask agreement: ${pct(r.meanAgreement)}   (1.0 = the layout rule was already right)`);
  console.log(
    `exemplars a generator may learn from: ${r.exemplarsAvailable.total}` +
      `  by era ${JSON.stringify(r.exemplarsAvailable.byEra)}  by scope ${JSON.stringify(r.exemplarsAvailable.byScope)}`,
  );
  printBuckets('by era', r.byEra);
  printBuckets('by set', r.bySet);
  printBuckets('by series', r.bySeries);
  printBuckets('by scope', r.byScope);

  console.log(`\nAI masks awaiting review: ${r.awaitingReview.length}`);
  for (const a of r.awaitingReview) {
    console.log(
      `  ${a.cardId}/${a.variantId}  ${a.generator ? `${a.generator.name}@${a.generator.version} run=${a.generator.runId}` : 'no generator id'}` +
        `  conf=${a.confidence ?? '—'}  exemplars=${a.exemplars}  vs-rule ${pct(a.agreement)}`,
    );
    // A proposal that REPLACED human work is the one to review first — and the
    // only one whose undo restores something rather than deleting it.
    if (a.superseded) {
      console.log(
        `    ↑ replaced a ${a.superseded.method} mask (agreement ${a.superseded.agreement}, ` +
          `${(a.superseded.changedFraction * 100).toFixed(2)}% of the face changed). That mask is NOT an ` +
          'exemplar while this proposal is live.\n' +
          `      undo byte-for-byte: generate-masks.ts revert --run-id ${a.superseded.runId}`,
      );
    }
  }
  console.log(`\ncorrections recorded: ${r.corrections.n}` +
    (r.corrections.n
      ? `  mean agreement-vs-parent ${pct(r.corrections.meanAgreementVsParent)}  mean changed ${pct(r.corrections.meanChangedFraction)}`
      : ''));
  for (const c of r.corrections.entries) {
    console.log(
      `  ${c.cardId}/${c.variantId}  parent=${c.parentMethod}${c.generator ? ` (${c.generator})` : ''}` +
        `  agree ${c.agreement}  +${c.addedPx}px / -${c.removedPx}px  (${(c.changedFraction * 100).toFixed(2)}% of face)`,
    );
  }
  console.log('');
}

async function tuples(): Promise<void> {
  const corpus = await readCorpus(MASKS_DIR);
  const manifest = trainingTuples(corpus);
  const out = arg('out');
  const json = JSON.stringify(manifest, null, 2) + '\n';
  if (out) {
    await writeFile(out, json, 'utf8');
    console.log(
      `wrote ${out}: ${manifest.counts.total} tuple(s) — ${manifest.counts.exemplars} exemplar(s), ` +
        `${manifest.counts.corrections} correction(s), ${manifest.counts.unreviewedAi} unreviewed ai`,
    );
  } else {
    console.log(json);
  }
}

async function exemplars(): Promise<void> {
  const corpus = await readCorpus(MASKS_DIR);
  const sel = selectExemplars(corpus, { eraId: arg('era'), scope: arg('scope') });
  console.log(`\neligible exemplars: ${sel.chosen.length}`);
  for (const e of sel.chosen) {
    console.log(`  ${e.cardId}/${e.variantId}  ${e.sidecar.derivation_method}  weight ${e.weight}  ${e.files.mask}`);
  }
  console.log(`\nrejected: ${sel.rejected.length}`);
  for (const r of sel.rejected) console.log(`  ${r.cardId}/${r.variantId}  ${r.method}  — ${r.reason}`);
  console.log('');
}

async function migrate(): Promise<void> {
  const dry = flag('dry-run');
  const corpus = await readCorpus(MASKS_DIR);
  let n = 0;
  for (const e of corpus) {
    const path = maskPathsIn(MASKS_DIR, e.cardId, e.variantId).json;
    const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    if (raw.version === SIDECAR_VERSION && raw.authorship && raw.reviewStatus) continue;
    const norm = normalizeSidecar(raw);
    if (!norm) {
      console.log(`skip ${e.cardId}/${e.variantId}: unreadable sidecar`);
      continue;
    }
    const upgraded = {
      ...raw,
      version: SIDECAR_VERSION,
      artworkKey: norm.artworkKey,
      derivation_method: norm.derivation_method,
      authorship: norm.authorship,
      reviewStatus: norm.reviewStatus,
      artworkUrl: norm.artworkUrl,
      lineage: [
        {
          method: norm.derivation_method,
          savedAt: norm.savedAt ?? null,
          source: norm.prior?.source ?? 'layout',
          generator: null,
        },
      ],
    };
    console.log(`${dry ? '[dry] ' : ''}v${String(raw.version)} → v${SIDECAR_VERSION}  ${e.cardId}/${e.variantId}  method=${norm.derivation_method}`);
    if (!dry) await writeFile(path, JSON.stringify(upgraded, null, 2) + '\n', 'utf8');
    n++;
  }
  console.log(`\n${dry ? 'would migrate' : 'migrated'} ${n} sidecar(s).`);
}

const CMD = process.argv[2];
const main =
  CMD === 'report' ? report : CMD === 'tuples' ? tuples : CMD === 'exemplars' ? exemplars : CMD === 'migrate' ? migrate : null;
if (!main) {
  console.error('usage: corpus.ts <report|tuples|exemplars|migrate> [flags] — see the header comment');
  process.exit(2);
}
void main().catch((e: Error) => {
  console.error(e.stack ?? e.message);
  process.exit(1);
});
