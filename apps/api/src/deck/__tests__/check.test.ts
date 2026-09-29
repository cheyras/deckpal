import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildDeckCheckResult, type ResolvedCheckLine } from '../check.js'
import { mkCard } from './fixtures.js'

const basic = mkCard({ id: 1, tcgdexId: 'sv-test-1', name: 'Cleffa', category: 'Pokemon', stage: 'Basic', regulationMark: 'I' })
const energy = mkCard({ id: 2, tcgdexId: 'sve-2', name: 'Fire Energy', category: 'Energy', energyType: 'Normal', setTcgdexId: 'sve' })
const trainer = mkCard({ id: 3, tcgdexId: 'sv-test-3', name: 'Nest Ball', category: 'Trainer', trainerType: 'Item', regulationMark: 'I' })
const stage2 = mkCard({ id: 4, tcgdexId: 'sv-test-4', name: 'Charizard', category: 'Pokemon', stage: 'Stage2', evolveFrom: 'Charmeleon', regulationMark: 'I' })
const candy = mkCard({ id: 5, tcgdexId: 'sv-test-5', name: 'Rare Candy', category: 'Trainer', trainerType: 'Item', regulationMark: 'I' })
const classicUltraBall = mkCard({ id: 6, tcgdexId: 'tcgc-92', name: 'Ultra Ball', category: 'Trainer', trainerType: 'Item', setTcgdexId: 'tcgc', localId: '92', localIdNumeric: null })

const row = (card: ReturnType<typeof mkCard> | null, quantity: number, over: Partial<ResolvedCheckLine> = {}): ResolvedCheckLine => ({
  card, requestedName: card?.name ?? 'Mystery Card', quantity, owned: 0, unitPriceUsd: 1, ...over,
})

test('a 60-card Standard list with a Basic is legal', () => {
  const result = buildDeckCheckResult('standard', [row(basic, 4), row(energy, 56)])
  assert.equal(result.total, 60)
  assert.equal(result.legal, true, result.issues.join('\n'))
  assert.deepEqual(result.issues, [])
})

test('65 cards reports the size issue', () => {
  const result = buildDeckCheckResult('standard', [row(basic, 4), row(energy, 61)])
  assert.equal(result.legal, false)
  assert.ok(result.issues.some((issue) => /65 \/ 60 cards.*Remove 5/.test(issue)))
})

test('five copies of a non-basic-Energy card reports the copy limit', () => {
  const result = buildDeckCheckResult('standard', [row(basic, 1), row(trainer, 5), row(energy, 54)])
  assert.ok(result.issues.some((issue) => /5 copies of "Nest Ball"/.test(issue)))
})

test('Stage 2 without Stage 1 or Rare Candy reports an evolution gap', () => {
  const result = buildDeckCheckResult('standard', [row(basic, 1), row(stage2, 2), row(energy, 57)])
  assert.deepEqual(result.evolution_gaps, ['Charizard (Stage 2) has no Charmeleon and no Rare Candy'])
})

test('Rare Candy covers a missing Stage 1 and annotates the Stage 2 line', () => {
  const result = buildDeckCheckResult('standard', [row(basic, 1), row(stage2, 2), row(candy, 4), row(energy, 53)])
  assert.deepEqual(result.evolution_gaps, [])
  assert.match(result.lines.find((line) => line.name === 'Charizard')?.note ?? '', /Rare Candy covers/)
})

test('an unresolved name remains visible, adds an issue, and makes legality unknown', () => {
  const result = buildDeckCheckResult('standard', [row(basic, 1), row(null, 1), row(energy, 58)])
  assert.equal(result.legal, null)
  assert.equal(result.lines[1]?.resolved, false)
  assert.equal(result.lines[1]?.card_id, null)
  assert.ok(result.issues.some((issue) => /Could not resolve "Mystery Card"/.test(issue)))
})

test('owned and missing-cost arithmetic caps owned copies and propagates missing prices', () => {
  const priced = buildDeckCheckResult('standard', [
    row(basic, 4, { owned: 9, unitPriceUsd: 2 }),
    row(trainer, 4, { owned: 1, unitPriceUsd: 1.25 }),
    row(energy, 52, { owned: 50, unitPriceUsd: .1 }),
  ])
  assert.equal(priced.owned, 55)
  assert.equal(priced.missing_cost_usd, 3.95)
  const unknown = buildDeckCheckResult('standard', [row(basic, 1), row(energy, 59, { unitPriceUsd: null })])
  assert.equal(unknown.missing_cost_usd, null)
})

test('GLC validation receives the reprint oracle for a Pokémon TCG Classic reprint', () => {
  let calls = 0
  const result = buildDeckCheckResult('glc', [
    row(basic, 1), row(classicUltraBall, 1), row(energy, 58),
  ], {
    isInFormatByReprint: (card) => {
      calls++
      return card.tcgdexId === classicUltraBall.tcgdexId
    },
  })
  assert.ok(calls > 0, 'validation must ask the supplied reprint oracle about Classic cards')
  assert.equal(result.legal, true, result.issues.join('\n'))
})
