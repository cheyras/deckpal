/**
 * THE QUERY EMBEDDER, SERVER-SIDE.
 *
 * Takes the bytes of a rectified card crop, hands them to the identity model,
 * and returns the L2-normalised vector `card_embedding` (migration 051) is
 * searched with. The other half of the pair `tools/embed-catalog` produces.
 *
 * ── WHY THIS IS ON THE SERVER AND NOT ON THE PHONE ──────────────────────────
 *
 * Owner ruling, 2026-09-05: "it's ok if we run that server-side". The branch
 * this merged from had the model on the device (`apps/web/src/scan/engine/
 * embed.ts`, now deleted), which meant an 88 MB int8 download before the scan
 * route could identify anything. The measured alternative is one HTTP round
 * trip on a crop the client already uploads to `POST /api/scan` today, so the
 * device pays nothing and the phone stops needing a model at all.
 *
 * What did NOT move is the input spec. `@deckpal/matching` still owns what an
 * image IS, and `apps/web/src/scan/engine/__tests__/embed-parity.test.ts` still
 * pins the capture geometry against the same golden the Python side checks —
 * because the phone still produces the pixels, it just no longer produces the
 * vector. The contract stretched across the wire; it did not disappear.
 *
 * ── THE RUNTIME, CHOSEN BY MEASUREMENT ──────────────────────────────────────
 *
 * `onnxruntime-node` is the obvious dependency and it is DISQUALIFIED, twice,
 * on numbers taken 2026-09-06:
 *
 *   * It unpacks to **296 MB** (1.29.0: `bin/napi-v6/{linux,darwin,win32}/
 *     {x64,arm64}`, all shipped in ONE tarball, no per-platform optional
 *     packages to prune). Vercel's serverless bundle ceiling is 250 MB
 *     uncompressed. The whole package does not fit, before a model is added.
 *   * Even pruned to linux/x64 it would not RUN. The binding is loaded as
 *     ``require(`../bin/napi-v6/${process.platform}/${process.arch}/
 *     onnxruntime_binding.node`)`` — @vercel/nft either wildcards that (and
 *     includes all 296 MB) or resolves it to the one 0.39 MB `.node` and
 *     misses `libonnxruntime.so.1`, the 44.7 MB shared object that file
 *     `dlopen`s and no static tracer can see. The second failure mode deploys
 *     green and 500s on the first scan.
 *
 * So the runtime is the **ORT-web WASM build the repo already vendors** for the
 * detector (`apps/web/public/scan-assets/`, `SOURCES.md` records where it came
 * from). It is 13.3 MB of `.wasm` and a 50 KB ESM loader, it has no native
 * component and nothing to trace, and it runs under plain Node — verified
 * 2026-09-06 against `lc050.onnx` in this repo: session created in 370 ms,
 * inference in 23 ms, correct output shapes. Two things make that work headless
 * and both are done below: the `.wasm` is handed over as BYTES (`env.wasm.
 * wasmBinary`) because the browser build would otherwise `fetch()` a URL Node
 * cannot fetch, and threads are off, because ORT's threaded path wants a
 * `Worker` and a serverless function is one CPU anyway.
 *
 * Measured cost, and the arithmetic behind the choice, is in DECISIONS.md
 * (2026-09-06). The short version: the function bundle is 62.8 MB today, the
 * runtime adds 13.3 MB, and the int8 CLIP ViT-B/32 checkpoint adds 88.2 MB —
 * about 164 MB against a 250 MB ceiling. The pre-measured TinyCLIP fallback
 * (61.7 MB, 6% less similarity headroom) is not needed and stays a fallback.
 *
 * ── THE SESSION IS CACHED PER INSTANCE, AND THAT IS NOT CONTRACT B5 ─────────
 *
 * B5 forbids holding DATABASE state in module scope: the original scanner kept
 * 23k hashes in a typed array, so an indexer run was invisible until a restart.
 * An ONNX session is not that. It is a pure function of a file that ships INSIDE
 * the bundle, so it cannot go stale relative to the code holding it — a new
 * model is a new deployment by construction. Caching it is the difference
 * between paying ~1.4 s of load once per instance and paying it per request.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { EMBED_INPUT_DIMS, EMBED_DIM, EMBED_MODEL_ID, embedInput, l2Normalize } from '@deckpal/matching';

/**
 * Background beyond the card on each side, as a fraction of the card's own
 * dimension, in the crop the capture path uploads.
 *
 * 🔴 `apps/web/src/scan/engine/rectify.ts` OWNS this number (`CAPTURE_MARGIN =
 * 0.05`) and this is a copy, because apps/api cannot import from apps/web. The
 * copy is safe only because the two are pinned together by a third thing: the
 * committed parity golden's `capture-480x670-margin5` case carries `marginFrac`
 * and the browser test asserts it equals `CAPTURE_MARGIN`, so a change on that
 * side fails a test rather than silently embedding a different picture here.
 * `assertCaptureMarginMatchesGolden()` is this side of that same pin.
 */
export const DEFAULT_CAPTURE_MARGIN = 0.05;

/**
 * The widest margin a caller may declare. Not a taste bound: `cardRect` clamps
 * so a silly margin cannot produce an empty rectangle, which means a wrong one
 * arrives as a plausible vector of the middle of a card rather than an error.
 * A quarter of the card on every side is already four times what the capture
 * path produces.
 */
const MAX_MARGIN = 0.25;

/**
 * Where the ONNX checkpoint lives. NOT IN THE REPO — it is 88 MB and this
 * project does not commit binaries (`tools/embed-catalog/README.md` says the
 * same thing about the same file, and has the export snippet that produces it).
 * The operator puts it here, `vercel.json`'s `includeFiles` carries it into the
 * function, and `SCAN_EMBED_MODEL_PATH` overrides the location.
 */
const DEFAULT_MODEL_PATH = fileURLToPath(
  new URL(`../../assets/embed/${EMBED_MODEL_ID}.onnx`, import.meta.url),
);

/**
 * Where the ORT-web WASM runtime lives. This one IS in the repo: the detector
 * already ships it to the browser, and the server reads the very same two files
 * off disk rather than vendoring a second copy of a 13 MB binary that would
 * then be able to drift from the one the phone runs.
 */
const DEFAULT_ORT_DIR = fileURLToPath(new URL('../../../web/public/scan-assets', import.meta.url));

const ORT_LOADER = 'ort.wasm.min.mjs';
const ORT_WASM = 'ort-wasm-simd-threaded.wasm';

export function modelPath(): string {
  return process.env.SCAN_EMBED_MODEL_PATH ?? DEFAULT_MODEL_PATH;
}

export function ortDir(): string {
  return process.env.SCAN_EMBED_ORT_DIR ?? DEFAULT_ORT_DIR;
}

/**
 * Everything this module needs that the code cannot provide for itself, checked
 * in one place and reported as a list rather than as whichever one happened to
 * be read first.
 *
 * Contract B11: the assets are an operator step, they are invisible from a
 * typecheck and a build, and the failure without this is an ORT stack trace
 * about a path. Returns the missing paths; empty means ready.
 */
export function missingEmbedAssets(): string[] {
  const missing: string[] = [];
  const m = modelPath();
  if (!existsSync(m)) missing.push(m);
  const d = ortDir();
  for (const f of [ORT_LOADER, ORT_WASM]) {
    if (!existsSync(join(d, f))) missing.push(join(d, f));
  }
  return missing;
}

/** The slice of onnxruntime-web this module uses. Structural because the
 *  bundle is imported from a PATH at runtime, so there is no package to import
 *  types from — the same reason `apps/web/src/scan/engine/model.ts` gives. */
interface OrtTensor {
  readonly data: Float32Array;
  readonly dims: readonly number[];
}
interface OrtSession {
  readonly inputNames: readonly string[];
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
}
interface OrtModule {
  env: { wasm: { wasmBinary?: ArrayBufferLike; numThreads: number; proxy: boolean; simd: boolean }; logLevel: string };
  Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => OrtTensor;
  InferenceSession: {
    create(model: Uint8Array, options: { executionProviders: string[]; graphOptimizationLevel: string }): Promise<OrtSession>;
  };
}

export interface EmbedSessionInfo {
  modelId: string;
  loadMs: number;
  inputName: string;
  modelBytes: number;
}

let pending: Promise<{ session: OrtSession; info: EmbedSessionInfo }> | null = null;

/**
 * Load the identity model once per instance. Concurrent callers share the
 * promise; a FAILED load clears the cache, so a missing file that the operator
 * then supplies does not leave the instance permanently poisoned by a rejection
 * it replays forever. Same shape and the same reasoning as the detector's
 * `loadModel()`.
 */
export function loadEmbedSession(): Promise<{ session: OrtSession; info: EmbedSessionInfo }> {
  if (!pending) {
    pending = openSession().catch((e: unknown) => {
      pending = null;
      throw e;
    });
  }
  return pending;
}

async function openSession(): Promise<{ session: OrtSession; info: EmbedSessionInfo }> {
  const missing = missingEmbedAssets();
  if (missing.length > 0) {
    // Names every missing path and what produces it. A message that says only
    // "ENOENT" costs somebody the twenty minutes this sentence saves.
    throw new Error(
      `the identity model is not on this deployment. Missing: ${missing.join(', ')}. ` +
        'The checkpoint is not committed (88 MB); export it per tools/embed-catalog/README.md ' +
        'and place it at SCAN_EMBED_MODEL_PATH. The ORT runtime ships in the repo at ' +
        'apps/web/public/scan-assets — if that is what is missing, the function bundle did not ' +
        "include it (vercel.json `includeFiles`).",
    );
  }

  const t0 = Date.now();
  const dir = ortDir();
  const ort = await importOrt(dir);

  // The browser build resolves its .wasm relative to its own module URL and
  // fetches it. Node's fetch does not do file:// — so it is handed the bytes
  // instead, which is a supported entry point and not a workaround.
  const wasm = readFileSync(join(dir, ORT_WASM));
  ort.env.wasm.wasmBinary = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength);
  // One thread and no proxy worker. ORT's threaded path wants `Worker` and
  // SharedArrayBuffer; a serverless function has neither reliably and is one
  // billable CPU regardless, so asking for threads buys a failure mode and no
  // throughput.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.simd = true;
  ort.env.logLevel = 'error';

  const model = readFileSync(modelPath());
  const session = await ort.InferenceSession.create(model, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  const inputName = session.inputNames[0];
  if (!inputName) throw new Error('the identity model declares no inputs');
  return {
    session,
    info: { modelId: EMBED_MODEL_ID, loadMs: Date.now() - t0, inputName, modelBytes: model.byteLength },
  };
}

/**
 * Load the vendored ORT bundle by PATH rather than by package name.
 *
 * It is a file on disk, not a dependency: adding `onnxruntime-web` to
 * package.json would pull a 142 MB npm package in to get the 13 MB already
 * sitting there, and would let the server's runtime drift from the phone's.
 *
 * `pathToFileURL` rather than `'file://' + path`, because the string form
 * percent-encodes nothing — a space or a `#` anywhere above the repo (and
 * Vercel's build paths are not ours to choose) silently produces a URL pointing
 * somewhere else.
 */
function importOrt(dir: string): Promise<OrtModule> {
  return import(pathToFileURL(join(dir, ORT_LOADER)).href) as unknown as Promise<OrtModule>;
}

/** The `ort` module object, for the Tensor constructor. Cached alongside the
 *  session because both come from the same import. */
let ortModule: OrtModule | null = null;

/**
 * Crop bytes in, unit vector out.
 *
 * `marginFrac` is the background the CALLER says is in the picture, not
 * something this function can measure — a tightly cropped card and one with 5%
 * of table around it are both perfectly valid images and only the capture path
 * knows which it sent.
 */
export async function embedCrop(bytes: Buffer, marginFrac = DEFAULT_CAPTURE_MARGIN): Promise<Float32Array> {
  if (!(marginFrac >= 0 && marginFrac <= MAX_MARGIN)) {
    throw new RangeError(`margin must be between 0 and ${MAX_MARGIN}; got ${marginFrac}`);
  }
  const { session, info } = await loadEmbedSession();
  // Same specifier as the session's load, so this resolves to the module the
  // loader already cached rather than a second instance of the runtime.
  if (!ortModule) ortModule = await importOrt(ortDir());

  // `ensureAlpha` guarantees 4 channels so the spec's stride arithmetic is the
  // same for a JPEG (3) and a PNG with transparency (4). `raw()` skips every
  // colour-management step sharp would otherwise apply, which matters because
  // the catalogue side decodes with Pillow and the two must agree about pixels
  // before they can agree about vectors.
  const { data, info: meta } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (meta.channels !== 4) {
    throw new Error(`expected 4 channels after ensureAlpha, got ${meta.channels}`);
  }

  const tensor = embedInput(
    { width: meta.width, height: meta.height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) },
    { marginFrac },
  );
  const feeds = { [info.inputName]: new ortModule.Tensor('float32', tensor, EMBED_INPUT_DIMS) };
  const out = await session.run(feeds);
  const first = Object.values(out)[0];
  if (!first) throw new Error('the identity model returned no output');
  if (first.data.length !== EMBED_DIM) {
    // A width mismatch here is a model that is not the one the catalogue was
    // embedded with, and every downstream number would be meaningless rather
    // than merely wrong. It is caught at the source, once.
    throw new Error(
      `the identity model produced ${first.data.length} features, but this build and migration 051 expect ${EMBED_DIM} — ` +
        `the file at ${modelPath()} is not ${EMBED_MODEL_ID}`,
    );
  }
  // A fresh array, never the session's: ORT owns that buffer and reuses it.
  return l2Normalize(Float32Array.from(first.data));
}
