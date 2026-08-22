/**
 * Does a SIGNED approval actually commit, end to end, against a live deployment?
 *
 * ── WHY THIS EXISTS WHEN GATE 9 COVERS THE SAME GROUND ───────────────────────
 *
 * `decke-gates.mjs --gate 9` drives the whole round trip through a real browser
 * and is the authority. This is the wire underneath it, and it earns its place
 * three ways:
 *
 *  1. **It falsifies.** `DROP=1` strips the signature from the replay, exactly
 *     as the shipped client used to, and the run must FAIL. Without that, a
 *     passing signed run proves only that nothing objected — the check could be
 *     switched off and look identical. Measured: with the signature, leg 2
 *     returns 19 chunks and the approved tool's `execute` genuinely runs; with
 *     it stripped, 2 chunks, `start` then `error`, and the turn is dead. That
 *     second result IS the bug this file was written to catch, on demand.
 *  2. **It imports the shipped functions.** `pendingApprovalFromChunk` and
 *     `approvalReplayPart` come from `apps/web/src/character/host/approval.ts`,
 *     not from a local reconstruction of the shape. A probe that builds its own
 *     approval part proves that the probe works.
 *  3. **It is seconds, not minutes**, and needs no browser — so it is the right
 *     tool for asking "did he reach for the tool at all?" across many trials.
 *     Use gate 9 for the verdict; use this to iterate toward it.
 *
 * Reads `.qa-account` and `.vercel-bypass` (both gitignored). Signs in as the
 * QA account, never the owner's — see AGENTS.md B12. The writes it makes are
 * REAL writes to that account.
 *
 *   node --import tsx scripts/decke-signed-probe.mjs <base-url> ["<prompt>"]
 *   DROP=1 node --import tsx scripts/decke-signed-probe.mjs <base-url>
 */
import { readFileSync } from 'node:fs'
import { approvalReplayPart, pendingApprovalFromChunk } from '../apps/web/src/character/host/approval.ts'

const R = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const BASE = process.argv[2]
const ASK = process.argv[3] ?? 'Add one swsh4-162 (Aromatic Grass Energy) to my collection. Normal variant. Go ahead and do it.'
const bypass = readFileSync(`${R}/.vercel-bypass`, 'utf8').trim().split('\n').pop().split('=').pop().trim()
const qa = readFileSync(`${R}/.qa-account`, 'utf8')
const get = (k) => qa.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim()
const H = { 'x-vercel-protection-bypass': bypass }

const cfg = await (await fetch(`${BASE}/api/public-config`, { headers: H })).json()
const auth = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: cfg.supabaseAnonKey, 'content-type': 'application/json' },
  body: JSON.stringify({ email: get('QA_EMAIL'), password: get('QA_PASSWORD') }),
})
const { access_token: jwt } = await auth.json()
if (!jwt) throw new Error('no jwt — check .qa-account')
const AH = { ...H, authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }
const apiGet = async (p) => (await fetch(`${BASE}${p}`, { headers: AH })).json()
const ledger = async () => Number((await apiGet('/api/mutations?pageSize=1')).total ?? 0)

/** POST one leg and return every chunk the server sent, plus the raw body. */
async function leg(messages) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: AH,
    body: JSON.stringify({ id: `signed-${Date.now()}`, route: '/collection', landmarks: [], messages }),
  })
  const raw = await res.text()
  const chunks = []
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const body = line.slice(6).trim()
    if (!body || body === '[DONE]') continue
    try { chunks.push(JSON.parse(body)) } catch { /* keep going */ }
  }
  return { status: res.status, raw, chunks }
}

const say = (chunks) => chunks.filter((c) => c.type === 'text-delta').map((c) => c.delta).join('')

const before = await ledger()
console.log(`ledger before: ${before}`)
console.log(`asking: ${ASK}\n`)

const one = await leg([{ id: 'u1', role: 'user', parts: [{ type: 'text', text: ASK }] }])
console.log(`leg 1: status ${one.status}, ${one.chunks.length} chunks`)

const names = new Map(), titles = new Map(), inputs = new Map()
for (const c of one.chunks) {
  if (c.type === 'tool-input-available') {
    names.set(String(c.toolCallId), String(c.toolName))
    inputs.set(String(c.toolCallId), c.input ?? {})
    titles.set(String(c.toolCallId), String(c.toolName))
  }
}
console.log(`tools called: ${[...names.values()].join(', ') || '(none)'}`)

const reqs = one.chunks.filter((c) => c.type === 'tool-approval-request')
console.log(`approval requests: ${reqs.length}`)
if (!reqs.length) {
  console.log(`\nNO APPROVAL WAS REQUESTED — the signed round trip cannot be exercised.`)
  console.log(`he said: ${say(one.chunks).replace(/\s+/g, ' ').slice(0, 400)}`)
  process.exit(2)
}

for (const r of reqs) {
  console.log(`  approvalId=${r.approvalId} toolCallId=${r.toolCallId} signature=${r.signature ? 'PRESENT' : 'ABSENT'}`)
}
const signedCount = reqs.filter((r) => typeof r.signature === 'string').length
if (!signedCount) {
  console.log(`\nThe deployment is NOT signing approvals — DECKE_APPROVAL_SECRET is unset here.`)
  console.log(`That makes this run prove nothing about the signature path.`)
  process.exit(3)
}

// Build leg 2 exactly as the browser does, through the shipped functions.
const parts = []
const text = say(one.chunks)
if (text.trim()) parts.push({ type: 'text', text })
for (const r of reqs) {
  let pending = pendingApprovalFromChunk(r, names, titles, inputs)
  // FALSIFICATION: with DROP=1 the signature is stripped, exactly as the
  // shipped client used to. If the live deployment still accepts it, the
  // check is not actually running and the passing run above proved nothing.
  if (process.env.DROP === '1') {
    const { signature, ...rest } = pending
    pending = rest
  }
  console.log(`  replaying ${pending.name}: signature ${pending.signature ? 'carried' : 'DROPPED'}`)
  parts.push(approvalReplayPart(pending, true))
}

const two = await leg([
  { id: 'u1', role: 'user', parts: [{ type: 'text', text: ASK }] },
  { id: 'a1', role: 'assistant', parts },
])
console.log(`\nleg 2: status ${two.status}, ${two.chunks.length} chunks`)
const errs = two.chunks.filter((c) => c.type === 'error')
if (errs.length) console.log(`ERROR CHUNKS: ${JSON.stringify(errs).slice(0, 500)}`)
if (/InvalidToolApprovalSignature|missing signature/i.test(two.raw)) {
  console.log(`\nSIGNATURE REJECTED — the fix does NOT work against this deployment.`)
  process.exit(1)
}
console.log(`he said: ${say(two.chunks).replace(/\s+/g, ' ').slice(0, 300)}`)
console.log(`leg 2 chunk types: ${two.chunks.map((c) => c.type).join(', ')}`)
for (const c of two.chunks) {
  if (c.type === 'tool-output-available' || c.type === 'tool-input-available' || c.type === 'error') {
    console.log(`  ${c.type}: ${JSON.stringify(c).slice(0, 400)}`)
  }
}

const after = await ledger()
console.log(`\nledger after: ${after} (was ${before})`)
console.log(after > before
  ? `PASS — a signed approval was accepted and the write COMMITTED.`
  : `FAIL — no signature error, but nothing was written.`)
process.exit(after > before ? 0 : 1)
