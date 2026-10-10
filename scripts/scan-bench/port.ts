// `CatalogPort` over the local catalogue copy, implementing exactly what
// `apps/api/src/scan/catalogPort.ts` asks Postgres for (see its SQL):
//
//   bySetAndNumber          set tcgdex id + local_id_numeric
//   byNumberAndDenominator  local_id_numeric + card_set.card_count_official
//   byNumber                local_id_numeric
//   byIds                   tcgdex ids
//   byName                  folded-name prefix OR pg_trgm similarity >= 0.3
//
// `card_count_official` is the set page's `printedCount`, the same column. The
// two text-family methods (rung 9) are left out — they are optional in the
// interface, and a port without them is a supported deployment shape — so a
// replay never reaches the family-text rung. That only matters for crops whose
// name AND number both failed, and the report says so.
import { normalizeCardName, type CatalogCard, type CatalogPort, type NameProbe } from '../../apps/api/src/scan/resolve.js'
import { loadCatalog } from './data.js'

const LIMIT = 250

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `
  const out = new Set<string>()
  for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3))
  return out
}
function trigramSimilarity(a: string, b: string): number {
  const A = trigrams(a)
  const B = trigrams(b)
  let shared = 0
  for (const t of A) if (B.has(t)) shared++
  return shared / (A.size + B.size - shared)
}

export function makePort(): CatalogPort & { all: CatalogCard[]; official: Map<string, number | null> } {
  const cat = loadCatalog()
  const official = new Map(cat.sets.map((s) => [s.setId, s.printedCount]))
  const all: CatalogCard[] = cat.cards.map((c) => {
    const set = cat.setById.get(c.setId)!
    return {
      cardId: c.cardId,
      name: c.name,
      number: c.number,
      numberNumeric: /^\d+$/.test(c.number) ? Number.parseInt(c.number, 10) : null,
      setId: c.setId,
      setName: set.name,
      seriesId: set.seriesId ?? '',
      rarity: c.rarity,
    }
  })
  const byId = new Map(all.map((c) => [c.cardId, c]))
  const byNum = new Map<number, CatalogCard[]>()
  for (const c of all) if (c.numberNumeric != null) (byNum.get(c.numberNumeric) ?? byNum.set(c.numberNumeric, []).get(c.numberNumeric)!).push(c)
  const folded = new Map(all.map((c) => [c.cardId, normalizeCardName(c.name)]))
  // The SQL strips a trailing parenthetical before the prefix test.
  const prefixable = new Map(all.map((c) => [c.cardId, folded.get(c.cardId)!.replace(/\s*\([^)]*\)\s*$/, '')]))
  const sortId = (a: CatalogCard, b: CatalogCard) => (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0)
  return {
    all,
    official,
    async bySetAndNumber(setId, numeric) {
      return (byNum.get(numeric) ?? []).filter((c) => c.setId === setId).sort(sortId).slice(0, LIMIT)
    },
    async byNumberAndDenominator(numeric, denominator) {
      return (byNum.get(numeric) ?? []).filter((c) => official.get(c.setId) === denominator).sort(sortId).slice(0, LIMIT)
    },
    async byNumber(numeric) {
      return (byNum.get(numeric) ?? []).slice().sort(sortId).slice(0, LIMIT)
    },
    async byIds(ids) {
      return ids.map((id) => byId.get(id)).filter((c): c is CatalogCard => !!c)
    },
    async officialCounts(setIds) {
      return new Map(setIds.map((s) => [s, official.get(s) ?? null]))
    },
    async byName(probe: NameProbe) {
      const scored: { c: CatalogCard; s: number; f: string }[] = []
      for (const c of all) {
        const f = folded.get(c.cardId)!
        const s = trigramSimilarity(f, probe.normalized)
        if (prefixable.get(c.cardId)!.startsWith(probe.prefix) || s >= 0.3) scored.push({ c, s, f })
      }
      scored.sort((a, b) => b.s - a.s || (a.f < b.f ? -1 : a.f > b.f ? 1 : 0) || sortId(a.c, b.c))
      return scored.slice(0, LIMIT).map((x) => x.c)
    },
  }
}
