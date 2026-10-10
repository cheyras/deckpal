#!/usr/bin/env node
// The Pokémon TCG Pocket series (`tcgp`) as DISTRACTORS: digital-only cards no
// phone can photograph, which the production dHash index excludes
// (apps/api/src/scan/index.ts) but the production vector gallery does not
// (tools/embed-catalog/embed.mts embeds every catalogue row). Fetched from
// TCGdex into art-pocket/ so `embed.py gallery --with-pocket` can measure what
// they cost the vector rung.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const OUT = path.join(process.env.SCAN_BENCH_DIR ?? path.join(os.homedir(), 'deckpal-data', 'scan-bench'), 'art-pocket')
const series = await (await fetch('https://api.tcgdex.net/v2/en/series/tcgp')).json()
const todo = []
for (const s of series.sets) {
  const set = await (await fetch(`https://api.tcgdex.net/v2/en/sets/${s.id}`)).json()
  for (const c of set.cards) if (c.image) todo.push({ id: c.id, url: `${c.image}/low.webp` })
}
fs.mkdirSync(OUT, { recursive: true })
let n = 0
async function worker() {
  for (;;) {
    const t = todo.shift()
    if (!t) return
    const dest = path.join(OUT, `${t.id}.low.webp`)
    if (fs.existsSync(dest)) continue
    const r = await fetch(t.url).catch(() => null)
    if (r?.ok) fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()))
    n++
  }
}
await Promise.all(Array.from({ length: 12 }, worker))
console.log(`pocket art: ${fs.readdirSync(OUT).length} files (${n} fetched) -> ${OUT}`)
