// Regenerate `fixtures/parity-golden.json`.
//
//   node --import tsx packages/matching/src/__tests__/gen-golden.ts
//
// Run this ONLY when the spec is deliberately changed — and when you do, bump
// EMBED_SPEC_VERSION in the same commit, because a moved golden means every
// vector already in the database was produced by a different function.
//
// The Python half is not regenerated: it reads the same JSON and must agree
// with it. Generating both from one implementation would test nothing.

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { EMBED_SIZE, EMBED_SPEC_VERSION, embedInput } from '../input-spec.js'
import { PARITY_CASES, syntheticRgba } from './fixtures.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', '..', 'fixtures', 'parity-golden.json')

const cases = PARITY_CASES.map((c) => {
  const data = syntheticRgba(c.seed, c.width, c.height)
  const t = embedInput({ width: c.width, height: c.height, data }, { marginFrac: c.marginFrac })
  const bytes = Buffer.from(t.buffer, t.byteOffset, t.byteLength)
  return {
    ...c,
    length: t.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    // A digest tells you THAT two implementations differ; these tell you where
    // to start looking, which on a 150k-element tensor is the difference
    // between a five-minute fix and an afternoon.
    first8: Array.from(t.slice(0, 8)),
    last8: Array.from(t.slice(-8)),
  }
})

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(
  OUT,
  `${JSON.stringify({ specVersion: EMBED_SPEC_VERSION, size: EMBED_SIZE, cases }, null, 1)}\n`,
)
console.log(`wrote ${OUT}`)
for (const c of cases) console.log(`  ${c.name} ${c.sha256}`)
