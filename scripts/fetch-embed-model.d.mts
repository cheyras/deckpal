/**
 * Types for `fetch-embed-model.mjs`.
 *
 * The script itself is plain `.mjs` and must stay that way: it runs on a Vercel
 * builder as the FIRST thing in the build chain, before `tsc` has produced a
 * single file and before any workspace package is linked usefully, so it may
 * use nothing but Node. That rules out authoring it in TypeScript, and it rules
 * out importing `@deckpal/matching` for `EMBED_MODEL_ID`.
 *
 * This file is what lets `apps/api/src/scan/__tests__/fetchEmbedModel.test.ts`
 * import it under `--noImplicitAny` — and the test is where the duplicated
 * constants are pinned back to their real owners.
 */

/** The export named by `EMBED_MODEL_ID` in `packages/matching/src/input-spec.ts`. */
export declare const EMBED_MODEL_ID: string

/** Repo-relative path the model is written to, and `includeFiles` collects. */
export declare const MODEL_DEST: string

/** Storage key prefix; parts are `${OBJECT_KEY}.part0`, `.part1`, … */
export declare const OBJECT_KEY: string

/** Pinned sha256 of the whole assembled file, lowercase hex. */
export declare const MODEL_SHA256: string

/** Whole-file size in bytes. */
export declare const MODEL_BYTES: number

/** One part: its bytes, or a marker that the object is not there. */
export type EmbedModelPart = { bytes: Buffer; missing?: undefined } | { missing: true; bytes?: undefined }

/**
 * Fetch every part in order and concatenate. Stops at the first missing part
 * AFTER part 0; a missing part 0 throws, because that means the model was never
 * staged rather than that the staging used fewer chunks.
 */
export declare function readParts(get: (index: number) => Promise<EmbedModelPart>): Promise<Buffer>

/**
 * Throw unless `bytes` hashes to `expected`. Returns the digest on success.
 * A wrong model is worse than no model — its vectors are not comparable with
 * the catalogue's — so this refuses rather than warns.
 */
export declare function verifyDigest(bytes: Buffer, expected?: string): string
