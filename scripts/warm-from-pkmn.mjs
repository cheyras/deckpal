// Warm missing card art from pkmn.gg (authoritative EN image source) into the
// pokedex-images cache. TCGdex lacks art for energy sets, promos, e-card, trainer
// kits, special subsets, etc. — those 404 on assets.tcgdex.net. pkmn.gg has them.
//
// For each of OUR sets that has cards missing from the cache, we map it to pkmn's
// setId, fetch GET /v1/card/<pkmnSet> (full per-card variantMap incl. largeImageUrl
// [600x836] + thumbImageUrl [300x418], already format(webp)), match our localId to
// pkmn's card, and download → cache/images/en/<serie>/<set>/<localId>.{high,low}.webp
// (the exact layout pokedex-images serves; see apps/images/src/layout.ts).
//
//   node warm-from-pkmn.mjs <missing.csv> [--report out.json] [--only set1,set2]
// CSV rows: serie,set,localId,lowMissing,highMissing  (from the cache-gap scan)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const SP = '/tmp/claude-1000/-home-cheyras/9d4785a9-85a1-4d4e-8806-8c5c927c16c1/scratchpad'
const CACHE = process.env.IMAGE_CACHE_ROOT || '/home/cheyras/pokedex/cache'
const BASE = 'https://[redacted host]/pkmn'
const csvPath = process.argv[2]
const reportPath = (() => { const i = process.argv.indexOf('--report'); return i > 0 ? process.argv[i + 1] : join(SP, 'warm-pkmn-report.json') })()
const only = (() => { const i = process.argv.indexOf('--only'); return i > 0 ? new Set(process.argv[i + 1].split(',')) : null })()

// ── pkmn session (refresh-on-401) ──
let TOK = JSON.parse(readFileSync(join(SP, 'token-cache.json'), 'utf8'))
const H = () => ({ 'User-Agent': 'Mozilla/5.0', Origin: 'https://www.pkmn.gg', Referer: 'https://www.pkmn.gg/', Accept: 'application/json', Authorization: 'Bearer ' + TOK.access_token })
async function refresh() {
  const r = await fetch(`${BASE}/v1/auth/refresh`, { method: 'POST', headers: { ...H(), 'Content-Type': 'application/json', Cookie: 'refresh_token=' + TOK.refresh_token }, body: '{}' })
  if (!r.ok) throw new Error('refresh failed ' + r.status)
  const j = await r.json(); TOK = { access_token: j.accessToken, refresh_token: j.refreshToken || TOK.refresh_token }
  writeFileSync(join(SP, 'token-cache.json'), JSON.stringify(TOK))
}
async function apiJson(path) {
  for (let i = 0; i < 2; i++) { const r = await fetch(BASE + path, { headers: H() }); if (r.status === 401) { await refresh(); continue } return r.ok ? await r.json() : null }
  return null
}

// ── set crosswalk: our tcgdex set id → pkmn setId ──
const pkmnSets = JSON.parse(readFileSync(join(SP, 'sets-list.json'), 'utf8')).value.filter((s) => s.category === 'EN')
const byIdLc = new Map(pkmnSets.map((s) => [s.id.toLowerCase(), s.id]))
const bySlug = new Map(pkmnSets.map((s) => [s.slug, s.id]))
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const byName = new Map(pkmnSets.map((s) => [norm(s.name), s.id]))
const REV_XWALK = { 'sv08.5': 'sv8pt5', 'sv03.5': 'sv3pt5', 'sv06.5': 'sv6pt5', 'sv06': 'sv6', 'sv08': 'sv8', 'sv09': 'sv9', 'sv10.5b': 'sv10pt5_blk', sve: 'sve23' }
const OVERRIDE = { mep: 'MEP', 'swsh4.5sv': 'swsh45sv', 'sm3.5': 'sm35', 'sm7.5': 'sm75', 'swsh12.5gg': 'swsh12pt5gg', 'swsh4.5': 'swsh45', hgssp: 'hsp' }
function pkmnSetId(ourSet, ourSlug, ourName) {
  if (OVERRIDE[ourSet]) return OVERRIDE[ourSet]
  // Trainer Gallery subsets: our swshN.5tg -> pkmn swshNtg
  let m = /^swsh(\d+)\.5tg$/.exec(ourSet); if (m && byIdLc.has(`swsh${m[1]}tg`)) return byIdLc.get(`swsh${m[1]}tg`)
  // McDonald's year buckets: our 20YY<era> -> pkmn mcdYY
  m = /^20(\d{2})/.exec(ourSet); if (m && byIdLc.has(`mcd${m[1]}`)) return byIdLc.get(`mcd${m[1]}`)
  if (byIdLc.has(ourSet.toLowerCase())) return byIdLc.get(ourSet.toLowerCase())
  if (REV_XWALK[ourSet] && byIdLc.has(REV_XWALK[ourSet].toLowerCase())) return byIdLc.get(REV_XWALK[ourSet].toLowerCase())
  if (ourSlug && bySlug.has(ourSlug)) return bySlug.get(ourSlug)
  if (ourName && byName.has(norm(ourName))) return byName.get(norm(ourName))
  // dot→pt form (sm3.5 -> sm3pt5)
  const pt = ourSet.replace(/\./g, 'pt'); if (byIdLc.has(pt.toLowerCase())) return byIdLc.get(pt.toLowerCase())
  return null
}

// match our localId to a pkmn card in the set's variantMap dump
const keyForms = (v) => {
  const out = new Set()
  const raw = String(v)
  out.add(raw.toUpperCase())
  if (/^\d+$/.test(raw)) out.add(String(parseInt(raw, 10))) // strip leading zeros
  out.add(raw.replace(/^0+/, '').toUpperCase())
  return [...out]
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function download(url, absTmp, abs) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.pkmn.gg/' } })
  if (!r.ok) return false
  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.length < 800) return false // guard against tiny/placeholder responses
  mkdirSync(dirname(abs), { recursive: true })
  await writeFile(absTmp, buf); await rename(absTmp, abs)
  return true
}

// ── main ──
const rows = readFileSync(csvPath, 'utf8').trim().split('\n').map((l) => l.split(','))
const bySet = new Map()
for (const [serie, set, localId] of rows) {
  if (!serie || !set || !localId) continue
  if (only && !only.has(set)) continue
  if (!bySet.has(set)) bySet.set(set, { serie, cards: [] })
  bySet.get(set).cards.push(localId)
}

// need our set slug/name for name-fallback matching — pass via env-less DB? We embed a small map from CSV only;
// slug/name unknown here, so rely on id/override/xwalk. (Good enough; residue reported.)
const report = { warmedHigh: 0, warmedLow: 0, cardsWarmed: 0, gapsUpstream: 0, unmappedSets: [], perSet: {}, ts: process.env.TS || 'n/a' }
let n = 0
for (const [set, { serie, cards }] of bySet) {
  const pk = pkmnSetId(set, null, null)
  if (!pk) { report.unmappedSets.push(set); continue }
  const data = await apiJson(`/v1/card/${encodeURIComponent(pk)}`)
  if (!data || !data.value) { report.unmappedSets.push(`${set}(fetch-fail:${pk})`); continue }
  // index pkmn cards by every localId/number form
  const idx = new Map()
  for (const e of data.value) {
    const c = e.card || e
    const num = c.number ?? c.numberKey ?? (c.id || '').split('-').slice(1).join('-')
    const urls = { large: c.largeImageUrl, thumb: c.thumbImageUrl }
    for (const k of keyForms(num)) if (!idx.has(k)) idx.set(k, urls)
    // also index by id suffix
    for (const k of keyForms((c.id || '').split('-').slice(1).join('-'))) if (!idx.has(k)) idx.set(k, urls)
  }
  let warmed = 0, gap = 0, nomatch = 0
  for (const localId of cards) {
    let urls = null
    for (const k of keyForms(localId)) if (idx.has(k)) { urls = idx.get(k); break }
    if (!urls || !urls.large) { nomatch++; continue }
    const absHigh = join(CACHE, 'images', 'en', serie, set, `${localId}.high.webp`)
    const absLow = join(CACHE, 'images', 'en', serie, set, `${localId}.low.webp`)
    let did = false
    if (!existsSync(absHigh) && (await download(urls.large, absHigh + '.tmp', absHigh))) { report.warmedHigh++; did = true }
    if (urls.thumb && !existsSync(absLow) && (await download(urls.thumb, absLow + '.tmp', absLow))) { report.warmedLow++; did = true }
    if (did) warmed++; else gap++
    n++
    if (n % 100 === 0) { console.log(`  ${n} processed · warmedHigh=${report.warmedHigh} · cur set ${set}`); }
    await sleep(120) // ~8 rps
  }
  report.cardsWarmed += warmed
  report.perSet[set] = { pkmn: pk, cards: cards.length, warmed, gap, nomatch }
  console.log(`${set} -> pkmn ${pk}: ${warmed}/${cards.length} warmed (${nomatch} no-match, ${gap} gap)`)
}
writeFileSync(reportPath, JSON.stringify(report, null, 2))
console.log(`\nDONE. cardsWarmed=${report.cardsWarmed} highs=${report.warmedHigh} lows=${report.warmedLow} unmappedSets=${report.unmappedSets.length}`)
console.log('unmapped:', report.unmappedSets.join(', '))
