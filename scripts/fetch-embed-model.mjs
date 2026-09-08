#!/usr/bin/env node
/**
 * Fetch the scanner's identity model into the build, from object storage.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * Why this exists
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `apps/api/assets/embed/clip-vit-b32-openai.onnx` is 88 MB of int8 ONNX. It is
 * gitignored, because this repo carries no binaries, and `vercel.json`'s
 * `includeFiles` needs it to be ON DISK at the moment Vercel traces the API
 * function's files. Those two facts have no overlap on a cloud builder, which
 * clones the repo and nothing else — so the file was present on the machine
 * that placed it by hand and absent on every deploy. This closes that gap: it
 * runs first in the build chain, puts the file where `includeFiles` will look
 * for it, and gets out of the way.
 *
 * No dependencies, and that is a constraint rather than a preference: this runs
 * BEFORE `pnpm install`'s workspace links are useful and before any package has
 * been built, so it may use nothing but Node itself. It therefore cannot import
 * `@deckpal/matching` for `EMBED_MODEL_ID`, and the name below is duplicated —
 * `apps/api/src/scan/__tests__/fetchEmbedModel.test.ts` is what stops the two
 * from drifting.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THREE PARTS, because the object store refused one
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Uploading 88 MB as a single object answered **413 EntityTooLarge**, so the
 * model is staged as `<key>.part0`, `.part1`, `.partN…` and concatenated here.
 * The loop stops at the first 404 AFTER part0 rather than hardcoding three, so
 * a re-stage at a different chunk size needs no code change — but a part count
 * is not a checksum, and the digest below is what actually decides whether the
 * bytes are right. A truncated download and a stale re-stage both fail there.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * It SKIPS rather than fails, and that is a deliberate ruling
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * With no credentials — a fork's CI, a self-host build, a contributor's laptop
 * — this logs loudly and exits 0. It must not break a build that was never
 * going to run the vector rung: `SCAN_EMBED_MATCH` is off by default, and with
 * it off `POST /api/scan/embed` answers 404 and `POST /api/scan/resolve`
 * ignores vector evidence entirely, which is exactly the state a missing model
 * file produces anyway. The degradation is already designed and already tested
 * (`apps/api/src/scan/__tests__/embedMatch.test.ts`, and the `scanEmbed` field
 * on `GET /health`); this refusing to build would be a new failure mode, not a
 * safer one.
 *
 * A CORRUPT download is the opposite case and exits non-zero. A model that is
 * present and wrong produces vectors that are silently incomparable with the
 * catalogue's — the scanner would rank confidently and rank nonsense, which is
 * far worse than not having the rung at all. Same reasoning `tools/embed-catalog`
 * records for refusing to run without its checkpoint.
 */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repo root, from `scripts/`. */
const ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * The export named by `EMBED_MODEL_ID` (`packages/matching/src/input-spec.ts`).
 * Duplicated because this script may not import a workspace package; pinned to
 * that constant by a test.
 */
export const EMBED_MODEL_ID = 'clip-vit-b32-openai'

/** Where `queryEmbed.ts`'s `DEFAULT_MODEL_PATH` and `includeFiles` both look. */
export const MODEL_DEST = `apps/api/assets/embed/${EMBED_MODEL_ID}.onnx`

/** The staged object's key prefix; parts are `${OBJECT_KEY}.part0`, `.part1`, … */
export const OBJECT_KEY = `models/${EMBED_MODEL_ID}.onnx`

/**
 * SHA-256 of the whole file, computed from the checkpoint the owner exported
 * and measured the 88.2 MB / 57 ms figures in DECISIONS.md against.
 *
 * **Changing this line is changing which model production runs.** A query
 * vector and a catalogue vector are comparable only when one model made both,
 * so a new digest here without a re-run of `tools/embed-catalog` for the
 * current stamp gives a scanner that is confidently wrong. Update the two
 * together or not at all.
 */
export const MODEL_SHA256 = '871a5a900b284ce0c1e5615fd43bf5c24828f003545df2a1a193947131421759'

/** Whole-file size, for the log line and for a cheap pre-digest sanity check. */
export const MODEL_BYTES = 88_187_806

/** Give up on a part rather than hang a build forever. */
const PART_TIMEOUT_MS = 120_000
/** Parts are ~40 MB; a transient 5xx or a dropped socket deserves a retry. */
const MAX_ATTEMPTS = 3
/** A stop, not a limit: past this the staging is wrong, not merely chunky. */
const MAX_PARTS = 64

const log = (msg) => console.log(`[fetch-embed-model] ${msg}`)
const warn = (msg) => console.warn(`[fetch-embed-model] ${msg}`)

/**
 * The authenticated object endpoint, not the public one.
 *
 * `card-art` happens to be a public bucket today, but a build-time fetch of a
 * production asset should not depend on that staying true — and the build
 * already holds the service-role key for the image tier, so using it costs
 * nothing. Same URL shape and same two headers as
 * `packages/storage/src/object-store.ts`, which is the module that owns this
 * conversation everywhere else.
 */
function partUrl(supabaseUrl, bucket, key) {
  const base = supabaseUrl.replace(/\/+$/, '')
  const encoded = key.split('/').map(encodeURIComponent).join('/')
  return `${base}/storage/v1/object/${encodeURIComponent(bucket)}/${encoded}`
}

async function fetchPart(url, serviceKey) {
  let lastError
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
        signal: AbortSignal.timeout(PART_TIMEOUT_MS),
      })
      // 404 (and Storage's 400-with-a-JSON-error for a missing key) is the
      // loop's terminator, not a failure — see readParts.
      if (res.status === 404 || res.status === 400) return { missing: true }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      return { bytes: Buffer.from(await res.arrayBuffer()) }
    } catch (err) {
      lastError = err
      if (attempt < MAX_ATTEMPTS) {
        warn(`attempt ${attempt}/${MAX_ATTEMPTS} failed (${err instanceof Error ? err.message : err}); retrying`)
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/**
 * Every part, in order, concatenated.
 *
 * Part 0 must exist — its absence means the model was never staged, which is a
 * hard error, because the credentials were present and the operator therefore
 * believes this deployment has a model. Every part after it stops the loop when
 * it 404s, which is what makes the part COUNT a property of the staging rather
 * than of this file.
 */
export async function readParts(get) {
  const parts = []
  for (let i = 0; i < MAX_PARTS; i++) {
    const part = await get(i)
    if (part.missing) {
      if (i === 0) {
        throw new Error(
          `no object at ${OBJECT_KEY}.part0 — the model has not been staged in this project's ` +
            'storage. Upload it (split into <40 MB parts) before deploying, or unset ' +
            'SUPABASE_SERVICE_ROLE_KEY for a build that deliberately ships without the vector rung.',
        )
      }
      return Buffer.concat(parts)
    }
    parts.push(part.bytes)
  }
  throw new Error(`more than ${MAX_PARTS} parts under ${OBJECT_KEY} — that is a staging mistake, not a big model`)
}

/**
 * The digest gate.
 *
 * Exported and pure so the failure path is a unit test rather than a thing we
 * assert about by reading. A build that writes an 88 MB file it has not proved
 * is a build that can ship a silently wrong scanner.
 */
export function verifyDigest(bytes, expected = MODEL_SHA256) {
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== expected) {
    throw new Error(
      `digest mismatch: expected ${expected}, got ${actual} (${bytes.length} bytes). ` +
        'The staged parts are not the model this build was pinned to — REFUSING to write it. ' +
        'A wrong model is worse than no model: its vectors are not comparable with the ' +
        "catalogue's, so the scanner would rank confidently and rank nonsense.",
    )
  }
  return actual
}

async function main() {
  const dest = resolvePath(ROOT, MODEL_DEST)

  // Already there and already right — the local dev case, where the owner
  // placed the file by hand. Re-downloading 88 MB to arrive at the same bytes
  // is a minute of somebody's life for nothing.
  if (existsSync(dest) && statSync(dest).size === MODEL_BYTES) {
    log(`${MODEL_DEST} is already present at the expected size — leaving it alone.`)
    return
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const bucket = process.env.CARD_ART_BUCKET ?? 'card-art'

  if (!supabaseUrl || !serviceKey) {
    // LOUD, and then out of the way. Four lines rather than one because the
    // consequence is a scanner that silently loses a rung, and the person who
    // needs to read this is scrolling a build log.
    warn('════════════════════════════════════════════════════════════════════')
    warn('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set, so the')
    warn(`scanner's identity model was NOT fetched. ${MODEL_DEST}`)
    warn('will be absent from this build. POST /api/scan/embed will answer 404')
    warn('and the ladder degrades exactly as it does with SCAN_EMBED_MATCH off')
    warn('— see DEPLOYMENT.md. This is a normal state for a fork, a self-host')
    warn('build or CI, and a deployment mistake anywhere else.')
    warn('════════════════════════════════════════════════════════════════════')
    return
  }

  log(`fetching ${OBJECT_KEY}.part* from ${bucket}`)
  const bytes = await readParts((i) => fetchPart(partUrl(supabaseUrl, bucket, `${OBJECT_KEY}.part${i}`), serviceKey))
  log(`downloaded ${bytes.length} bytes; verifying sha256`)
  verifyDigest(bytes)

  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, bytes)
  log(`wrote ${MODEL_DEST} (${bytes.length} bytes, sha256 verified)`)
}

// Importable for the unit test without running the download.
if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`[fetch-embed-model] ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  })
}
