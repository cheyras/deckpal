// Pure tests for the supersede/undo half of sidecar v3 — the promise that a
// generator can rework a mask a HUMAN painted without that being a one-way
// door. No DB, no server, one scratch dir.
//
// What these lock down:
//   1. A generator write onto an existing mask THROWS unless it says
//      `supersede`. Silence used to mean overwrite; that is how work vanishes.
//   2. With supersede: the result is `ai`/unreviewed, the human's pixels are
//      kept at `.parent.png`, a change map is rendered, and every artifact the
//      mask had is archived VERBATIM with sha256s.
//   3. `restoreArchive` puts all of it back BYTE-FOR-BYTE — the property the
//      whole feature rests on — and cleans the archive away after.
//   4. A corrupt archive aborts BEFORE deleting the live files, so "undo" can
//      never turn into "lose both versions".
//   5. ANTI-COLLAPSE still holds while the `ai` mask is live: it is never an
//      exemplar, and it shows up in the review queue.
//   6. `supersedes` is NOT `correction` — a machine replacing a human must not
//      masquerade as a human correcting a machine.

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { encodePng } from '../png.js';
import type { MaskPrior } from '../mask-artifacts.js';
import {
  findArchives,
  maskPathsIn,
  readSidecarFile,
  restoreArchive,
  sha256,
  writeMaskRecord,
  type GeneratorIdentity,
} from '../provenance.js';
import { buildReport, readCorpus, selectExemplars } from '../mask-corpus.js';

const W = 64;
const H = 88;
const CARD = 'zztest-1';
const VAR = '7';
const RUN = 'straighten-test-1';

const PRIOR: MaskPrior = {
  source: 'layout',
  eraId: 'modern-sv',
  scope: 'sheet',
  rect: [0.1, 0.45, 0.8, 0.42],
  radius: 0.006,
  invert: true,
  feather: 0.008,
  resolverVersion: 5,
};

function maskPng(paint: (x: number, y: number) => boolean): Buffer {
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = 255;
    rgba[i * 4 + 1] = 45;
    rgba[i * 4 + 2] = 100;
    rgba[i * 4 + 3] = paint(i % W, (i / W) | 0) ? 255 : 0;
  }
  return encodePng({ width: W, height: H, rgba });
}

const identity = (runId: string): GeneratorIdentity => ({
  name: 'line-snap',
  version: 1,
  modelId: null,
  runId,
  params: { minSegmentPx: 40 },
  exemplars: [{ cardId: CARD, variantId: Number(VAR), savedAt: null, method: 'hand', weight: 1 }],
  confidence: 0.55,
  generatedAt: new Date().toISOString(),
});

const scratch = (): string => mkdtempSync(join(tmpdir(), 'foil-supersede-'));

/** Write the human mask every test starts from, and hash what it left on disk. */
async function seedHumanMask(dir: string): Promise<Record<string, string>> {
  await writeMaskRecord({
    masksDir: dir,
    cardId: CARD,
    variantId: VAR,
    png: maskPng((x, y) => !(x > 8 && x < 40 && y > 12 && y < 50)),
    width: W,
    height: H,
    prior: PRIOR,
    startedFrom: 'layout',
  });
  const p = maskPathsIn(dir, CARD, VAR);
  const hashes: Record<string, string> = {};
  for (const [name, path] of Object.entries({ png: p.png, json: p.json, prior: p.prior, diff: p.diff })) {
    hashes[name] = sha256(await readFile(path));
  }
  return hashes;
}

/** The generator's proposal: same shape, boundaries nudged straight. */
const straightened = maskPng((x, y) => !(x >= 8 && x < 40 && y >= 12 && y < 50));

test('a generator write onto an existing mask throws without explicit supersede', async () => {
  const dir = scratch();
  try {
    await seedHumanMask(dir);
    await assert.rejects(
      () =>
        writeMaskRecord({
          masksDir: dir,
          cardId: CARD,
          variantId: VAR,
          png: straightened,
          width: W,
          height: H,
          prior: PRIOR,
          startedFrom: 'layout',
          machine: identity(RUN),
        }),
      /explicit supersede/,
    );
    const still = await readSidecarFile(dir, CARD, VAR);
    assert.equal(still?.derivation_method, 'hand', 'and the human mask is untouched');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('supersede keeps the human pixels, archives everything, and stays unreviewed', async () => {
  const dir = scratch();
  try {
    const before = await seedHumanMask(dir);
    const sidecar = await writeMaskRecord({
      masksDir: dir,
      cardId: CARD,
      variantId: VAR,
      png: straightened,
      width: W,
      height: H,
      prior: PRIOR,
      startedFrom: 'layout',
      machine: identity(RUN),
      supersede: { runId: RUN },
    });

    assert.equal(sidecar.derivation_method, 'ai');
    assert.equal(sidecar.reviewStatus, 'unreviewed');
    assert.equal(sidecar.authorship, 'machine');
    assert.ok(sidecar.supersedes, 'the supersede record exists');
    assert.equal(sidecar.supersedes.parent.method, 'hand', 'and names what it replaced');
    assert.equal(sidecar.supersedes.parent.sha256, before.png, 'pinned to the exact human pixels');
    assert.equal(sidecar.supersedes.runId, RUN);
    assert.equal(sidecar.correction, undefined, 'a machine replacing a human is NOT a correction');
    assert.equal(sidecar.prior.parentMask?.method, 'hand', 'the prior remembers the ancestor');
    assert.deepEqual(
      sidecar.lineage?.map((l) => l.method),
      ['hand', 'ai'],
      'lineage runs human → machine',
    );

    const p = maskPathsIn(dir, CARD, VAR);
    assert.equal(sha256(await readFile(p.parent)), before.png, '.parent.png holds his pixels verbatim');
    await readFile(p.parentDiff); // throws if the change map was not rendered

    const archives = await findArchives(dir, RUN);
    assert.equal(archives.length, 1);
    assert.equal(archives[0]!.manifest.method, 'hand');
    assert.deepEqual(
      Object.keys(archives[0]!.manifest.files).sort(),
      [`${VAR}.diff.png`, `${VAR}.json`, `${VAR}.png`, `${VAR}.prior.png`],
      'every artifact the human mask had is archived',
    );
    for (const [name, sha] of Object.entries(archives[0]!.manifest.files)) {
      assert.equal(sha256(await readFile(join(archives[0]!.dir, name))), sha, `${name} archived verbatim`);
    }
    assert.equal(await findArchives(dir, 'some-other-run').then((a) => a.length), 0, 'archives filter by run');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('anti-collapse still holds while the proposal is live', async () => {
  const dir = scratch();
  try {
    await seedHumanMask(dir);
    await writeMaskRecord({
      masksDir: dir,
      cardId: CARD,
      variantId: VAR,
      png: straightened,
      width: W,
      height: H,
      prior: PRIOR,
      startedFrom: 'layout',
      machine: identity(RUN),
      supersede: { runId: RUN },
    });
    const corpus = await readCorpus(dir);
    assert.equal(corpus.length, 1, 'the archive directory is not mistaken for a corpus entry');
    const sel = selectExemplars(corpus, { eraId: 'modern-sv', scope: 'sheet' });
    assert.equal(sel.chosen.length, 0, 'an unreviewed `ai` mask is never an exemplar');
    assert.match(sel.rejected[0]!.reason, /anti-feedback-collapse/);
    const report = buildReport(corpus);
    assert.equal(report.awaitingReview.length, 1, 'and it is queued for human review');
    assert.equal(report.awaitingReview[0]!.generator?.runId, RUN);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('restore puts the human mask back BYTE-FOR-BYTE and clears the archive', async () => {
  const dir = scratch();
  try {
    const before = await seedHumanMask(dir);
    await writeMaskRecord({
      masksDir: dir,
      cardId: CARD,
      variantId: VAR,
      png: straightened,
      width: W,
      height: H,
      prior: PRIOR,
      startedFrom: 'layout',
      machine: identity(RUN),
      supersede: { runId: RUN },
    });

    const [found] = await findArchives(dir, RUN);
    const result = await restoreArchive(dir, found!);
    assert.equal(result.method, 'hand');
    assert.equal(result.restored.length, 4);

    const p = maskPathsIn(dir, CARD, VAR);
    for (const [name, path] of Object.entries({ png: p.png, json: p.json, prior: p.prior, diff: p.diff })) {
      assert.equal(sha256(await readFile(path)), before[name], `${name} restored byte-for-byte`);
    }
    await assert.rejects(() => readFile(p.parent), 'the machine-vs-human parent artifact is gone');
    assert.equal(await findArchives(dir).then((a) => a.length), 0, 'the archive was consumed');

    const back = await readSidecarFile(dir, CARD, VAR);
    assert.equal(back?.derivation_method, 'hand');
    assert.equal(back?.supersedes, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a corrupt archive aborts before anything live is deleted', async () => {
  const dir = scratch();
  try {
    await seedHumanMask(dir);
    await writeMaskRecord({
      masksDir: dir,
      cardId: CARD,
      variantId: VAR,
      png: straightened,
      width: W,
      height: H,
      prior: PRIOR,
      startedFrom: 'layout',
      machine: identity(RUN),
      supersede: { runId: RUN },
    });
    const [found] = await findArchives(dir, RUN);
    await writeFile(join(found!.dir, `${VAR}.png`), Buffer.from('not a png'));

    await assert.rejects(() => restoreArchive(dir, found!), /corrupt/);
    const p = maskPathsIn(dir, CARD, VAR);
    const live = await readSidecarFile(dir, CARD, VAR);
    assert.equal(live?.derivation_method, 'ai', 'the live mask is still there');
    assert.ok((await readFile(p.parent)).length > 0, 'and so are his pixels at .parent.png');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
