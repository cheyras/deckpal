// The deployed scan endpoints, called the way `apps/web/src/lib/api.ts` calls
// them, as the QA account (AGENTS.md B12). Every response is cached on disk by
// (endpoint, query, body sha256), so a benchmark rerun replays production's
// answers instead of re-asking production — the cache is the record of what
// the deployed matcher said, and `--fresh` is how you ask again.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
export const ORIGIN = process.env.DECKPAL_ORIGIN ?? 'https://deckpal.app'
export const CACHE = process.env.SCAN_BENCH_CACHE ?? path.join(os.homedir(), 'deckpal-data', 'scan-bench', 'cache')
const FRESH = process.argv.includes('--fresh')

function qaAccount() {
  const tries = [path.join(REPO, '.qa-account'), path.resolve(REPO, '..', '..', 'deckpal', '.qa-account')]
  const src = tries.find((p) => fs.existsSync(p))
  if (!src) throw new Error('No .qa-account found (AGENTS.md B12). It is gitignored; copy it from the main checkout.')
  const kv = Object.fromEntries(
    fs
      .readFileSync(src, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2].replace(/^['"]|['"]$/g, '')]),
  )
  if (!kv.QA_EMAIL || !kv.QA_PASSWORD) throw new Error('.qa-account has no QA_EMAIL / QA_PASSWORD')
  return kv
}

let tokenPromise = null
export const qaToken = () => token()
async function token() {
  tokenPromise ??= (async () => {
    const { QA_EMAIL, QA_PASSWORD } = qaAccount()
    const cfg = await (await fetch(`${ORIGIN}/api/public-config`)).json()
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error('public-config did not return Supabase settings')
    const res = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: cfg.supabaseAnonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email: QA_EMAIL, password: QA_PASSWORD }),
    })
    const body = await res.json()
    if (!body.access_token) throw new Error(`QA sign-in failed (${res.status})`)
    return body.access_token
  })()
  return tokenPromise
}

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')

let last = 0
async function pace() {
  // Well under the API's per-IP limits; the cache makes reruns free anyway.
  const wait = last + 150 - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  last = Date.now()
}

async function call(route, query, body, contentType) {
  const key = sha(`${route}?${query}\n${contentType}\n`) + '-' + sha(body)
  const file = path.join(CACHE, route.replace(/\W+/g, '_'), `${key}.json`)
  if (!FRESH && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'))
  for (let attempt = 1; ; attempt++) {
    await pace()
    const t0 = Date.now()
    const res = await fetch(`${ORIGIN}/api${route}${query ? `?${query}` : ''}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await token()}`, 'content-type': contentType },
      body,
    })
    const ms = Date.now() - t0
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 5000 * attempt))
      continue
    }
    const text = await res.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {}
    const out = { status: res.status, ms, at: new Date().toISOString(), body: json ?? text.slice(0, 500) }
    if (res.ok) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, JSON.stringify(out))
    }
    return out
  }
}

/** `POST /api/scan?k=5&quality=low` — the phash priors (api.ts `identifyCard`). */
export const scan = (jpeg, k = 5) => call('/scan', `k=${k}&quality=low`, jpeg, 'image/jpeg')
/** `POST /api/scan/embed?k=5` — the vector candidates (api.ts `embedCard`). */
export const embed = (jpeg, k = 5) => call('/scan/embed', `k=${k}`, jpeg, 'image/jpeg')
/** `POST /api/scan/resolve` — the ladder (api.ts `resolveCard`). */
export const resolve = (req) => call('/scan/resolve', '', JSON.stringify(req), 'application/json')
