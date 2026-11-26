/**
 * Score the size sweep (`size-sweep.py`): the device OCR on the same card at
 * every simulated distance.
 *
 *   node --import tsx scripts/scan-bench/size-sweep.ts [--shard i/n]   (reads)
 *   node --import tsx scripts/scan-bench/size-sweep.ts --report          (scores)
 *
 * There is no ground-truth id for these photos, and none is needed: the
 * question is what DISTANCE costs, so each card's own close read (its largest
 * size) is the reference, and only a reference the catalog vouches for counts:
 *   - name: a catalog card has that name;
 *   - key: a catalog card has that number in a set printed to that total.
 * At each size a field is KEPT when it reads the same as the reference, and
 * WRONG when it reads as a DIFFERENT valid catalog value (a misread that names
 * another card, the hazardous kind).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { normalizeCardName } from '../../apps/api/src/scan/resolve.js'
import { loadCatalog } from './data.js'
import { readCard } from './ocr.js'

const D = path.join(os.homedir(), 'deckpal-data', 'size-sweep')
const meta: { sizes: number[]; rows: { id: string; nativeLongSide: number }[] } = JSON.parse(fs.readFileSync(path.join(D, 'rows.json'), 'utf8'))
const sizes = meta.sizes.map((s) => s.toFixed(2))
const arg = (k: string) => {
  const i = process.argv.indexOf(k)
  return i >= 0 ? process.argv[i + 1] : undefined
}
type Read = { name: string | null; number: string | null; denominator: string | null }

if (!process.argv.includes('--report')) {
  const [i, n] = (arg('--shard') ?? '0/1').split('/').map(Number) as [number, number]
  const file = path.join(D, `reads-${i}.json`)
  const out: Record<string, Record<string, Read>> = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  const mine = meta.rows.filter((_, k) => k % n === i)
  let done = 0
  for (const r of mine) {
    out[r.id] ??= {}
    for (const s of sizes) {
      if (out[r.id]![s]) continue
      const read = await readCard(fs.readFileSync(path.join(D, s, `${r.id}.jpg`)))
      out[r.id]![s] = { name: read.name ?? null, number: read.number ?? null, denominator: read.denominator ?? null }
    }
    fs.writeFileSync(file, JSON.stringify(out))
    if (++done % 10 === 0) console.log(`shard ${i}: ${done}/${mine.length}`)
  }
  console.log(`shard ${i}: done ${mine.length}`)
  process.exit(0)
}

// ── report ──────────────────────────────────────────────────────────────────
const reads: Record<string, Record<string, Read>> = {}
for (const f of fs.readdirSync(D).filter((f) => /^reads-\d+\.json$/.test(f))) Object.assign(reads, JSON.parse(fs.readFileSync(path.join(D, f), 'utf8')))
const cat = loadCatalog()
const names = new Set(cat.cards.map((c) => normalizeCardName(c.name)))
const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '')
const keys = new Set<string>()
for (const c of cat.cards) {
  const total = cat.setById.get(c.setId)?.printedCount
  if (total != null) keys.add(`${digits(c.number)}/${total}`)
}
const nameOf = (r: Read) => (r.name && names.has(normalizeCardName(r.name)) ? normalizeCardName(r.name) : null)
const keyOf = (r: Read) => {
  const k = `${digits(r.number)}/${digits(r.denominator)}`
  return r.number && r.denominator && keys.has(k) ? k : null
}

// THE REFERENCE is what the two CLOSEST sizes read, either of them: one read
// alone is noisy (two resamplings of the same card a few percent apart already
// disagree on about one card in ten), so a field counts as the card's own when
// either close read produced it and the catalog vouches for it.
const close = sizes.slice(-2)
const ids = Object.keys(reads).filter((id) => sizes.every((s) => reads[id]![s]))
const refSet = (f: (r: Read) => string | null) =>
  new Map(ids.map((id) => [id, new Set(close.map((s) => f(reads[id]![s]!)).filter((x): x is string => !!x))]))
const refName = refSet(nameOf)
const refKey = refSet(keyOf)
const withName = ids.filter((id) => refName.get(id)!.size)
const withKey = ids.filter((id) => refKey.get(id)!.size)
const withAny = ids.filter((id) => refName.get(id)!.size || refKey.get(id)!.size)
const pc = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : '-').padStart(5)
console.log(`${ids.length} cards read at every size; at ${close.join(' / ')} (the reference) the catalog vouches for: name ${withName.length}, number/total ${withKey.length}, either ${withAny.length}\n`)
console.log('size  card px   name kept   key kept   either kept   wrong name   wrong key')
const table: Record<string, unknown>[] = []
for (const s of sizes) {
  let nk = 0, kk = 0, ek = 0, nw = 0, kw = 0
  for (const id of ids) {
    const r = reads[id]![s]!
    const n = nameOf(r)
    const k = keyOf(r)
    const nOk = !!n && refName.get(id)!.has(n)
    const kOk = !!k && refKey.get(id)!.has(k)
    if (nOk) nk++
    if (kOk) kk++
    if (nOk || kOk) ek++
    if (n && refName.get(id)!.size && !nOk) nw++
    if (k && refKey.get(id)!.size && !kOk) kw++
  }
  const px = Math.round(Number(s) * 960)
  console.log(`${s}  ${String(px).padStart(6)}   ${pc(nk, withName.length)}       ${pc(kk, withKey.length)}      ${pc(ek, withAny.length)}        ${String(nw).padStart(3)}         ${String(kw).padStart(3)}`)
  table.push({ size: Number(s), cardPx: px, nameKept: nk, keyKept: kk, eitherKept: ek, wrongName: nw, wrongKey: kw })
}
fs.writeFileSync(path.join(D, 'report.json'), JSON.stringify({ cards: ids.length, withName: withName.length, withKey: withKey.length, withAny: withAny.length, table }, null, 1))
