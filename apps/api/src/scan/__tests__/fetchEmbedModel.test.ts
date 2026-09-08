/**
 * `scripts/fetch-embed-model.mjs` — the build step that puts the scanner's
 * identity model on disk for `vercel.json`'s `includeFiles` to find.
 *
 * ── WHAT THESE PIN, AND WHY EACH ONE IS HERE ─────────────────────────────────
 *
 * The script runs on a cloud builder, once, with nobody watching. Every
 * property it has to get right is either checked here or is checked by nothing:
 *
 *  1. **A wrong file is refused.** This is the whole reason the digest is in
 *     the script. A model that is present and wrong produces query vectors that
 *     are not comparable with the catalogue's — the scanner ranks confidently
 *     and ranks nonsense, which is strictly worse than not having the rung.
 *  2. **The part loop ends at the first gap after part0, and NOT at part0.**
 *     "Stop at a 404" is what lets the staging choose its own chunk count; but
 *     a missing part0 means the model was never staged at all, with credentials
 *     present — a deployment mistake that must not resolve to an empty buffer
 *     that then fails the digest with a confusing message.
 *  3. **The duplicated constants still match their real owners.** The script
 *     may not import a workspace package (it runs before anything is built), so
 *     `EMBED_MODEL_ID` and the destination path are spelled twice. This is the
 *     thing that stops the copies drifting, and drift here means the API looks
 *     for one filename while the build writes another — an absence that only
 *     shows up as a 500 on the first real scan.
 *  4. **The build chain actually calls it**, and builds `@deckpal/matching`,
 *     which is a RUNTIME dependency of the API however much it looks like a
 *     type-only one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EMBED_MODEL_ID as SPEC_MODEL_ID } from '@deckpal/matching';
import {
  EMBED_MODEL_ID,
  MODEL_BYTES,
  MODEL_DEST,
  MODEL_SHA256,
  OBJECT_KEY,
  readParts,
  verifyDigest,
} from '../../../../../scripts/fetch-embed-model.mjs';

/** repo root, from apps/api/src/scan/__tests__/ */
const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

// ── 1 · the digest gate ─────────────────────────────────────────────────────

test('verifyDigest accepts bytes whose sha256 is the expected one', () => {
  const bytes = Buffer.from('not really a model, but it hashes');
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.equal(verifyDigest(bytes, digest), digest);
});

test('verifyDigest REFUSES bytes that do not match — a wrong model must not be written', () => {
  const bytes = Buffer.from('the wrong checkpoint entirely');
  const wrong = createHash('sha256').update(Buffer.from('something else')).digest('hex');
  assert.throws(
    () => verifyDigest(bytes, wrong),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /digest mismatch/i);
      // The message must name both digests: a build log that says only "it did
      // not match" sends whoever reads it back to compute the actual one by hand.
      assert.match(err.message, new RegExp(wrong));
      assert.match(err.message, /REFUSING to write/i);
      return true;
    },
  );
});

test('a single flipped byte is caught — the truncation/corruption case, not a typo case', () => {
  const good = Buffer.from('0123456789abcdef'.repeat(64));
  const digest = createHash('sha256').update(good).digest('hex');
  const bad = Buffer.from(good);
  bad[500] = bad[500]! ^ 0x01;
  assert.doesNotThrow(() => verifyDigest(good, digest));
  assert.throws(() => verifyDigest(bad, digest), /digest mismatch/i);
});

// ── 2 · the part loop ───────────────────────────────────────────────────────

/** A fake object store: an array of part buffers, everything past it missing. */
const stagedAs = (parts: Buffer[]) => async (i: number) =>
  i < parts.length ? { bytes: parts[i]! } : { missing: true as const };

test('parts are concatenated IN ORDER, and the count comes from the staging', async () => {
  const parts = [Buffer.from('alpha-'), Buffer.from('beta-'), Buffer.from('gamma')];
  assert.equal((await readParts(stagedAs(parts))).toString(), 'alpha-beta-gamma');
});

test('two parts and five parts both work — nothing here hardcodes three', async () => {
  for (const n of [1, 2, 3, 5, 9]) {
    const parts = Array.from({ length: n }, (_, i) => Buffer.from(`<${i}>`));
    const joined = await readParts(stagedAs(parts));
    assert.equal(joined.toString(), parts.map(String).join(''), `${n} parts`);
  }
});

test('a missing part0 is a hard error, not an empty download', async () => {
  await assert.rejects(
    () => readParts(stagedAs([])),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /part0/);
      assert.match(err.message, /not been staged/i);
      return true;
    },
  );
});

test('an absurd part count is refused rather than looped over forever', async () => {
  // Never missing: a staging bug, or a store answering 200 to everything.
  await assert.rejects(() => readParts(async () => ({ bytes: Buffer.from('x') })), /staging mistake/i);
});

// ── 3 · the duplicated constants ────────────────────────────────────────────

test("the script's EMBED_MODEL_ID is the one packages/matching actually declares", () => {
  assert.equal(
    EMBED_MODEL_ID,
    SPEC_MODEL_ID,
    'scripts/fetch-embed-model.mjs names a different model than packages/matching/src/input-spec.ts. ' +
      'The script cannot import the package (it runs before anything is built), so this test is the ' +
      'only thing holding the two copies together — update the script.',
  );
});

test('the destination is the path the API reads the model from', () => {
  assert.equal(MODEL_DEST, `apps/api/assets/embed/${SPEC_MODEL_ID}.onnx`);
  // queryEmbed.ts builds the same path from EMBED_MODEL_ID; if its shape ever
  // changes, the build would write a file nothing loads.
  const queryEmbed = readFileSync(new URL('../queryEmbed.ts', import.meta.url), 'utf8');
  assert.match(
    queryEmbed,
    /assets\/embed\/\$\{EMBED_MODEL_ID\}\.onnx/,
    "queryEmbed.ts no longer resolves the model at assets/embed/<EMBED_MODEL_ID>.onnx — " +
      'the build step writes there, so one of the two has to move.',
  );
});

test('the staged object key sits under models/ in the bucket', () => {
  assert.equal(OBJECT_KEY, `models/${SPEC_MODEL_ID}.onnx`);
});

test('the pinned digest is a sha256, and the size is the measured one', () => {
  assert.match(MODEL_SHA256, /^[0-9a-f]{64}$/, 'MODEL_SHA256 is not a 64-hex-character sha256');
  // 88.2 MB, the figure DECISIONS.md's timings were measured against.
  assert.equal(MODEL_BYTES, 88_187_806);
});

// ── 4 · the wiring ──────────────────────────────────────────────────────────

test('vercel.json runs the fetch step, and builds @deckpal/matching before the API', () => {
  const vercel = JSON.parse(readFileSync(new URL('vercel.json', `file://${ROOT}`), 'utf8')) as {
    buildCommand: string;
    functions: Record<string, { includeFiles?: string }>;
  };
  const cmd = vercel.buildCommand;

  assert.match(
    cmd,
    /node scripts\/fetch-embed-model\.mjs/,
    'vercel.json no longer runs the model fetch — a cloud build has no 88 MB checkpoint to include, ' +
      'so includeFiles below would carry nothing and POST /api/scan/embed would 500 on the first scan.',
  );

  const matchingAt = cmd.indexOf('@deckpal/matching build');
  const apiAt = cmd.indexOf('deckpal-api build');
  assert.ok(
    matchingAt >= 0,
    'vercel.json does not build @deckpal/matching. Its package exports resolve to dist/ at RUNTIME and ' +
      'apps/api/src/scan/router.ts imports EMBED_MODEL_ID from it at module scope, so an unbuilt ' +
      'matching makes api/index.mjs throw ERR_MODULE_NOT_FOUND and 500s the WHOLE API. ' +
      'tsc --noEmit cannot catch this: the "types" condition points at src/.',
  );
  assert.ok(matchingAt < apiAt, '@deckpal/matching must be built BEFORE deckpal-api');

  const includes = vercel.functions['api/index.mjs']?.includeFiles ?? '';
  assert.match(
    includes,
    /apps\/api\/assets\/embed\/\*\.onnx/,
    "api/index.mjs's includeFiles no longer carries the ONNX checkpoint — fetching it at build time " +
      'would then be pointless, because nothing would put it in the function bundle.',
  );
});

test('the model file stays out of git — the repo carries no binaries', () => {
  const ignore = readFileSync(new URL('.gitignore', `file://${ROOT}`), 'utf8');
  assert.match(
    ignore,
    /apps\/api\/assets\/embed\/\*\.onnx/,
    'the 88 MB checkpoint is no longer gitignored. If it is genuinely being committed, this build ' +
      'step and its whole rationale need deleting; far more likely somebody removed the wrong line.',
  );
});
