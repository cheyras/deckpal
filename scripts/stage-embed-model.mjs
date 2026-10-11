#!/usr/bin/env node
/**
 * Stage the scanner's identity model in object storage — the counterpart of
 * `fetch-embed-model.mjs`, which pulls it back into every build.
 *
 *   node scripts/stage-embed-model.mjs <path/to/model.int8.onnx>
 *
 * Uploads the file as `models/<EMBED_MODEL_ID>.onnx.part0..N` (the store
 * refuses one 88 MB object with 413, so it is split, exactly as the fetch
 * expects), then READS IT BACK through the fetch script's own code path and
 * checks the whole-file sha256 against `MODEL_SHA256`. A staging that would
 * not pass the build's check fails here instead of in a deploy.
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (the
 * same pair the build uses); CARD_ART_BUCKET overrides the bucket. It writes
 * to production storage, so it is the OWNER's to run (AGENTS.md B9), and it
 * never prints the key.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { supabaseKeyHeaders } from '../packages/storage/src/supabase-key-headers.mjs'
import { EMBED_MODEL_ID, MODEL_BYTES, MODEL_SHA256, OBJECT_KEY } from './fetch-embed-model.mjs'

const PART_BYTES = 40 * 1024 * 1024

const file = process.argv[2]
if (!file) {
  console.error('usage: node scripts/stage-embed-model.mjs <path/to/model.int8.onnx>')
  process.exit(2)
}
const url = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '')
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const bucket = process.env.CARD_ART_BUCKET ?? 'card-art'
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (load the production .env first)')
  process.exit(2)
}

const bytes = readFileSync(file)
const digest = createHash('sha256').update(bytes).digest('hex')
if (digest !== MODEL_SHA256 || bytes.length !== MODEL_BYTES) {
  console.error(
    `refusing: ${file} is ${bytes.length} bytes sha256 ${digest.slice(0, 12)}…, but fetch-embed-model.mjs pins ` +
      `${MODEL_BYTES} bytes sha256 ${MODEL_SHA256.slice(0, 12)}… for ${EMBED_MODEL_ID}. Stage the file the code expects.`,
  )
  process.exit(1)
}

const objectUrl = (k) => `${url}/storage/v1/object/${encodeURIComponent(bucket)}/${k.split('/').map(encodeURIComponent).join('/')}`
const parts = Math.ceil(bytes.length / PART_BYTES)
for (let i = 0; i < parts; i++) {
  const body = bytes.subarray(i * PART_BYTES, Math.min(bytes.length, (i + 1) * PART_BYTES))
  const res = await fetch(objectUrl(`${OBJECT_KEY}.part${i}`), {
    method: 'POST',
    headers: { ...supabaseKeyHeaders(key), 'content-type': 'application/octet-stream', 'x-upsert': 'true' },
    body,
  })
  if (!res.ok) {
    console.error(`part ${i}: upload failed (${res.status}) ${(await res.text()).slice(0, 200)}`)
    process.exit(1)
  }
  console.log(`[stage-embed-model] uploaded ${OBJECT_KEY}.part${i} (${body.length} bytes)`)
}
// A stale extra part from an earlier, finer split would be appended by the
// fetch (it reads until the first 404), so make sure the next one is absent.
const extra = await fetch(objectUrl(`${OBJECT_KEY}.part${parts}`), { method: 'DELETE', headers: supabaseKeyHeaders(key) })
if (extra.ok) console.log(`[stage-embed-model] removed a stale ${OBJECT_KEY}.part${parts}`)

// Read it back exactly as the build will.
let back = Buffer.alloc(0)
for (let i = 0; ; i++) {
  const res = await fetch(objectUrl(`${OBJECT_KEY}.part${i}`), { headers: supabaseKeyHeaders(key) })
  if (res.status === 404 || res.status === 400) break
  if (!res.ok) {
    console.error(`read-back part ${i}: ${res.status}`)
    process.exit(1)
  }
  back = Buffer.concat([back, Buffer.from(await res.arrayBuffer())])
}
const backDigest = createHash('sha256').update(back).digest('hex')
if (backDigest !== MODEL_SHA256) {
  console.error(`read-back sha256 ${backDigest.slice(0, 12)}… does not match ${MODEL_SHA256.slice(0, 12)}…`)
  process.exit(1)
}
console.log(`[stage-embed-model] ${EMBED_MODEL_ID}: ${parts} part(s) staged, read back, sha256 verified`)
