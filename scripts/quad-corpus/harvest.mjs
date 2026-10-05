#!/usr/bin/env node
/**
 * Harvest the quad-labeler corpus from production and audit it.
 *
 *   node scripts/quad-corpus/harvest.mjs            # download (resumable) + audit
 *   node scripts/quad-corpus/harvest.mjs --audit    # audit what is already on disk
 *
 * What it does, in the order apps/web/src/scan/labeler/HARVEST.md lays down:
 *   1. Signs in as the QA account (`.qa-account`, AGENTS.md B12) — the labeler
 *      set on production is owner + QA, and the endpoint is the only way in
 *      (the objects live in the private `dev-captures` bucket).
 *   2. Lists every flag (`/dev/scan-flags?limit=5000`), fetches each row's JSON,
 *      keeps only `type === 'quad-label'` (the bucket also holds the harness's
 *      live-camera flags and the scanner's per-capture telemetry), and downloads
 *      those rows' PNGs.
 *   3. Validates every row against HARVEST.md §4 and writes:
 *        <out>/raw/<id>.json, <out>/raw/<id>.png   the corpus, byte for byte
 *        <out>/manifest.jsonl                       one line per VALID row
 *        <out>/report.json, <out>/report.md         the audit
 *
 * Nothing secret is printed or written: the password stays in memory, the
 * access token is never logged, and the output directory holds only what the
 * labeler saved. The corpus is photos from the owner's house and the web, so it
 * lives OUTSIDE the repo by default (QUAD_CORPUS_DIR overrides).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const ORIGIN = process.env.DECKPAL_ORIGIN ?? 'https://deckpal.app'
const OUT = process.env.QUAD_CORPUS_DIR ?? path.join(os.homedir(), 'deckpal-data', 'quad-corpus')
const RAW = path.join(OUT, 'raw')
const AUDIT_ONLY = process.argv.includes('--audit')
const LIMIT = 5000
const CONCURRENCY = 4

// ── v1 → v2 reason map (types.ts LEGACY_REASON_MAP) ──────────────────────────
const LEGACY_REASON_MAP = { no_card: 'no_card', multiple_cards: 'multiple_no_clear_foreground', too_blurry: 'too_blurry' }
// The schema-2 additions that start at the named date and have no older population (HARVEST.md §3, §6).
const PROVENANCE_FROM = Date.parse('2026-09-07T00:00:00Z')

// ── credentials ──────────────────────────────────────────────────────────────
function readQaAccount() {
  const file = path.join(REPO, '.qa-account')
  const alt = path.resolve(REPO, '..', '..', 'deckpal', '.qa-account') // a worktree's parent checkout
  const src = fs.existsSync(file) ? file : fs.existsSync(alt) ? alt : null
  if (!src) throw new Error('No .qa-account found (AGENTS.md B12). It is gitignored; copy it from the main checkout.')
  const kv = {}
  for (const line of fs.readFileSync(src, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*[:=]\s*(.*?)\s*$/.exec(line)
    if (m && !line.trimStart().startsWith('#')) kv[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  if (!kv.QA_EMAIL || !kv.QA_PASSWORD) throw new Error('.qa-account has no QA_EMAIL / QA_PASSWORD')
  return { email: kv.QA_EMAIL, password: kv.QA_PASSWORD }
}

async function signIn() {
  const cfg = await (await fetch(`${ORIGIN}/api/public-config`)).json()
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error('public-config did not return Supabase settings')
  const { email, password } = readQaAccount()
  const res = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: cfg.supabaseAnonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error(`QA sign-in failed: HTTP ${res.status}`)
  const body = await res.json()
  if (!body.access_token) throw new Error('QA sign-in returned no access token')
  return body.access_token
}

// ── fetching ─────────────────────────────────────────────────────────────────
// The API's pre-auth flood guard allows 600 requests a minute per IP, so the
// harvest paces itself under it and backs off properly when it is hit anyway.
const MIN_GAP_MS = 125 // ~480/min across all workers
let nextSlot = 0
async function paced() {
  const now = Date.now()
  const wait = Math.max(0, nextSlot - now)
  nextSlot = Math.max(now, nextSlot) + MIN_GAP_MS
  if (wait) await new Promise((r) => setTimeout(r, wait))
}

async function get(token, url, kind) {
  for (let attempt = 1; ; attempt++) {
    await paced()
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
    if (res.ok) return kind === 'json' ? res.json() : Buffer.from(await res.arrayBuffer())
    if (res.status === 404) return null
    if (attempt >= 8 || (res.status < 500 && res.status !== 429)) throw new Error(`GET ${new URL(url).pathname} -> HTTP ${res.status}`)
    const retryAfter = Number(res.headers.get('retry-after'))
    await new Promise((r) => setTimeout(r, res.status === 429 ? (retryAfter > 0 ? retryAfter * 1000 : 15000 * attempt) : 500 * attempt ** 2))
  }
}

async function pool(items, n, fn) {
  let next = 0
  let done = 0
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      await fn(items[i], i)
      if (++done % 100 === 0) process.stdout.write(`  ${done}/${items.length}\n`)
    }
  })
  await Promise.all(workers)
}

async function download() {
  fs.mkdirSync(RAW, { recursive: true })
  const token = await signIn()
  console.log('signed in as the QA account')
  const listing = await get(token, `${ORIGIN}/api/dev/scan-flags?limit=${LIMIT}`, 'json')
  const rows = listing.flags ?? []
  console.log(`listing: ${rows.length} flagged frames${rows.length >= LIMIT ? '  ** AT THE 5000 CAP: older rows are missing **' : ''}`)
  const types = {}
  const labelIds = []
  const withJson = rows.filter((r) => r.files.includes('json'))
  await pool(withJson, CONCURRENCY, async (r) => {
    const jsonPath = path.join(RAW, `${r.id}.json`)
    let meta
    if (fs.existsSync(jsonPath)) meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
    else {
      meta = await get(token, `${ORIGIN}/api/dev/scan-flags/${r.id}.json`, 'json')
      if (!meta) return
      // Only labels are kept on disk; other producers are counted, not stored.
      if (meta.type === 'quad-label') fs.writeFileSync(jsonPath, JSON.stringify(meta))
    }
    types[meta.type ?? '(untyped)'] = (types[meta.type ?? '(untyped)'] ?? 0) + 1
    if (meta.type === 'quad-label' && r.files.includes('png')) labelIds.push(r.id)
  })
  console.log(`row types: ${JSON.stringify(types)}`)
  let fetched = 0
  await pool(labelIds, CONCURRENCY, async (id) => {
    const pngPath = path.join(RAW, `${id}.png`)
    if (fs.existsSync(pngPath)) return
    const png = await get(token, `${ORIGIN}/api/dev/scan-flags/${id}.png`, 'png')
    if (png) {
      fs.writeFileSync(pngPath, png)
      fetched++
    }
  })
  console.log(`labels: ${labelIds.length} (downloaded ${fetched} new PNGs)`)
  return { listed: rows.length, types, atCap: rows.length >= LIMIT }
}

// ── audit ────────────────────────────────────────────────────────────────────
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

function polyArea(q) {
  let a = 0
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = q[i]
    const [x2, y2] = q[(i + 1) % 4]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a) / 2
}

function isConvex(q) {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i]
    const [bx, by] = q[(i + 1) % 4]
    const [cx, cy] = q[(i + 2) % 4]
    const z = (bx - ax) * (cy - by) - (by - ay) * (cx - bx)
    if (z !== 0) {
      if (sign && Math.sign(z) !== sign) return false
      sign = Math.sign(z)
    }
  }
  return true
}

function bucket(v, edges, labels) {
  for (let i = 0; i < edges.length; i++) if (v < edges[i]) return labels[i]
  return labels[labels.length - 1]
}

/** A 64-bit difference hash of the canonical frame, for near-duplicate grouping. Needs sharp. */
async function makeHasher() {
  try {
    const require = createRequire(path.join(REPO, 'package.json'))
    let sharp
    try {
      sharp = require('sharp')
    } catch {
      sharp = createRequire(path.resolve(REPO, '..', '..', 'deckpal', 'package.json'))('sharp')
    }
    return async (file) => {
      const px = await sharp(file).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer()
      let h = 0n
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) h = (h << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n)
      return h
    }
  } catch {
    return null
  }
}

function hamming(a, b) {
  let x = a ^ b
  let n = 0
  while (x) {
    n += Number(x & 1n)
    x >>= 1n
  }
  return n
}

async function audit(fetchInfo) {
  const files = fs.existsSync(RAW) ? fs.readdirSync(RAW).filter((f) => f.endsWith('.json')) : []
  const tally = (o, k) => (o[k] = (o[k] ?? 0) + 1)
  const r = {
    generatedAt: new Date().toISOString(),
    origin: ORIGIN,
    listing: fetchInfo ?? null,
    labels: files.length,
    valid: 0,
    invalid: {},
    verdict: {},
    negativeByReason: {},
    schema: {},
    pipelineVersion: {},
    source: {},
    seed: {},
    detectorMisses: 0,
    reoriented: 0,
    fillOfFrame: {},
    sourceMegapixels: {},
    mirrorPadded: 0,
    cornersOutsideFrame: 0,
    byDay: {},
    nearDuplicateGroups: null,
    rowsInNearDuplicateGroups: null,
  }
  const manifest = []
  const hashes = []
  const hasher = await makeHasher()

  for (const f of files) {
    const id = Number(f.slice(0, -5))
    const row = JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'))
    const png = path.join(RAW, `${id}.png`)
    const problems = []
    const schema = row.labelSchema ?? 1 // branch, never default forward (HARVEST.md §2)
    tally(r.schema, `v${schema}`)
    const pv = row.pipeline?.pipelineVersion
    tally(r.pipelineVersion, String(pv ?? 'missing'))
    if (pv !== 3) problems.push(`pipelineVersion ${pv ?? 'missing'} (corners mean something else)`)
    const cs = row.pipeline?.canonicalSize
    if (!(cs && row.dims && cs === row.dims.width && cs === row.dims.height)) problems.push('canonicalSize != dims')
    if (!fs.existsSync(png)) problems.push('png missing')
    else {
      const size = pngSize(fs.readFileSync(png))
      if (!size || size.width !== row.dims?.width || size.height !== row.dims?.height) problems.push('png is not dims square')
    }
    const positive = Array.isArray(row.corners)
    if (positive) {
      if (row.corners.length !== 4 || row.corners.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)))
        problems.push('corners are not four finite points')
      else if (row.corners.some(([x, y]) => x < -0.15 || x > 1.15 || y < -0.15 || y > 1.15)) problems.push('corner outside the editor clamp')
      if (schema >= 2 && (row.topLeftIndex == null || row.seededTopLeftIndex == null || !row.face)) problems.push('v2 positive missing anchor/face')
    } else if (row.corners === null) {
      if (!row.invalidReason) problems.push('negative without invalidReason')
    } else problems.push('corners neither null nor a quad')

    const day = new Date(id).toISOString().slice(0, 10)
    tally(r.byDay, day)
    tally(r.source, row.source ?? 'missing')
    const fb = row.pipeline?.seedFallback
    const seedKey =
      row.seededFrom === 'detector' ? 'detector' : fb ? `default:${fb}` : id < PROVENANCE_FROM ? 'default:unknown(pre-09-07, detector never ran)' : 'default:unknown'
    tally(r.seed, seedKey)

    if (problems.length) {
      for (const p of problems) tally(r.invalid, p)
      continue
    }
    r.valid++
    let verdict
    let reason = null
    let fill = null
    if (positive) {
      verdict = row.face === 'back' ? 'back' : row.face === 'front' ? 'front' : 'face-unknown(v1)'
      fill = polyArea(row.corners)
      tally(r.fillOfFrame, bucket(fill, [0.1, 0.25, 0.5, 0.75, 0.9], ['<10%', '10-25%', '25-50%', '50-75%', '75-90%', '>=90%']))
      if (row.corners.some(([x, y]) => x < 0 || x > 1 || y < 0 || y > 1)) r.cornersOutsideFrame++
      if (!isConvex(row.corners)) tally(r.invalid, 'note: non-convex quad (kept)')
      if (row.topLeftIndex != null && row.seededTopLeftIndex != null && row.topLeftIndex !== row.seededTopLeftIndex && row.seededFrom === 'detector')
        r.reoriented++
      if (fb === 'no_object') r.detectorMisses++ // the most valuable row in the set (HARVEST.md §3)
    } else {
      verdict = 'negative'
      reason = schema === 1 ? LEGACY_REASON_MAP[row.invalidReason] ?? row.invalidReason : row.invalidReason
      if (schema === 1 && row.invalidReason === 'no_card') reason = 'no_card(v1: mixed with not_a_card)'
      tally(r.negativeByReason, reason)
    }
    tally(r.verdict, verdict)
    if (row.stream) tally(r.sourceMegapixels, bucket((row.stream.width * row.stream.height) / 1e6, [0.5, 1, 3, 8, 16], ['<0.5MP', '0.5-1MP', '1-3MP', '3-8MP', '8-16MP', '>=16MP']))
    else tally(r.sourceMegapixels, 'unknown (pre-09-07)')
    const pad = row.pipeline?.pad
    if (pad && (pad.left || pad.top || pad.right || pad.bottom)) r.mirrorPadded++
    let hash = null
    if (hasher) {
      hash = await hasher(png)
      hashes.push({ id, hash })
    }
    manifest.push({
      id,
      png: `raw/${id}.png`,
      day,
      schema,
      source: row.source,
      verdict,
      reason,
      corners: positive ? row.corners : null,
      topLeftIndex: row.topLeftIndex ?? null,
      fill,
      seededFrom: row.seededFrom,
      seedFallback: fb ?? null,
      hasObj: row.pipeline?.hasObj ?? null,
      stream: row.stream ?? null,
      mirrorPadded: !!(pad && (pad.left || pad.top || pad.right || pad.bottom)),
    })
  }

  // Near-duplicate groups: frames whose 64-bit dHash differs in <= 4 bits.
  if (hasher) {
    const parent = new Map(hashes.map((h) => [h.id, h.id]))
    const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)))
    for (let i = 0; i < hashes.length; i++)
      for (let j = i + 1; j < hashes.length; j++) if (hamming(hashes[i].hash, hashes[j].hash) <= 4) parent.set(find(hashes[i].id), find(hashes[j].id))
    const groups = {}
    for (const h of hashes) (groups[find(h.id)] ??= []).push(h.id)
    const multi = Object.values(groups).filter((g) => g.length > 1)
    r.nearDuplicateGroups = multi.length
    r.rowsInNearDuplicateGroups = multi.reduce((n, g) => n + g.length, 0)
    const groupOf = new Map()
    for (const g of Object.values(groups)) for (const id of g) groupOf.set(id, Math.min(...g))
    for (const m of manifest) m.dupGroup = groupOf.get(m.id) ?? m.id
  }

  fs.writeFileSync(path.join(OUT, 'manifest.jsonl'), manifest.map((m) => JSON.stringify(m)).join('\n') + '\n')
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(r, null, 2))
  fs.writeFileSync(path.join(OUT, 'report.md'), toMarkdown(r))
  console.log('\n' + toMarkdown(r))
  console.log(`written to ${OUT}`)
}

function table(o) {
  const rows = Object.entries(o).sort((a, b) => b[1] - a[1])
  return rows.length ? rows.map(([k, v]) => `| ${k} | ${v} |`).join('\n') : '| (none) | 0 |'
}

function toMarkdown(r) {
  const pos = (r.verdict.front ?? 0) + (r.verdict.back ?? 0) + (r.verdict['face-unknown(v1)'] ?? 0)
  return [
    `# Quad corpus audit (${r.generatedAt.slice(0, 10)})`,
    '',
    r.listing ? `Listing: ${r.listing.listed} flagged frames${r.listing.atCap ? ' (AT THE 5000 CAP, older rows missing)' : ''}. Row types: ${JSON.stringify(r.listing.types)}.` : 'Audit of the copy on disk only.',
    '',
    `**Labels: ${r.labels}. Valid: ${r.valid}. Positives: ${pos} (front ${r.verdict.front ?? 0}, back ${r.verdict.back ?? 0}, face unknown ${r.verdict['face-unknown(v1)'] ?? 0}). Negatives: ${r.verdict.negative ?? 0}.**`,
    '',
    `Detector misses (no_object + human quad): ${r.detectorMisses}. Orientation corrections on detector-seeded rows: ${r.reoriented}. Mirror-padded uploads: ${r.mirrorPadded}. Positives with a corner outside the frame: ${r.cornersOutsideFrame}.`,
    r.nearDuplicateGroups == null ? 'Near-duplicates: not computed (sharp unavailable).' : `Near-duplicates: ${r.rowsInNearDuplicateGroups} rows in ${r.nearDuplicateGroups} groups (dHash <= 4 bits).`,
    '',
    '## Negatives by reason', '| reason | rows |', '|---|---|', table(r.negativeByReason), '',
    '## Card size in frame (positives)', '| fill | rows |', '|---|---|', table(r.fillOfFrame), '',
    '## Source', '| source | rows |', '|---|---|', table(r.source), '',
    '## Source resolution', '| resolution | rows |', '|---|---|', table(r.sourceMegapixels), '',
    '## Seed provenance', '| seed | rows |', '|---|---|', table(r.seed), '',
    '## Schema / pipeline', '| key | rows |', '|---|---|', table(Object.fromEntries([...Object.entries(r.schema), ...Object.entries(r.pipelineVersion).map(([k, v]) => [`pipelineVersion ${k}`, v])])), '',
    '## Rejected rows', '| problem | rows |', '|---|---|', table(r.invalid), '',
    '## Labels per day', '| day | rows |', '|---|---|', Object.entries(r.byDay).sort().map(([k, v]) => `| ${k} | ${v} |`).join('\n'), '',
  ].join('\n')
}

const info = AUDIT_ONLY ? null : await download()
await audit(info)
