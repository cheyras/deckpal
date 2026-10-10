/**
 * deck_odds' model (`../odds.ts`): seeded, deterministic, and right.
 *
 * "Right" is checked against closed forms computed HERE, independently of the
 * engine's own exact path — through `hypergeometricMulligan` (P(none of k in
 * 7)) and a local C(n, k) — so a shared mistake cannot pass both sides.
 * Tolerances are four binomial standard errors at the trial count used; the
 * seed is fixed, so each assertion is deterministic, and the bound says how
 * far a CORRECT simulator could plausibly land.
 *
 * The realistic fixture is the owner's "Hide 'n' Sneak" list, built from the
 * public card facts at deckpal.app/api/cards/<id> (category, stage, trainer
 * type) — the deck the feature was verified on.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deckOdds, foldCardName, kindMaskOf, margin95, ODDS_MAX_DECK, ODDS_MAX_HANDS, ODDS_MAX_WARNINGS, OddsError, type OddsEntry, type OddsQuery } from '../odds.js'
import { hypergeometricMulligan } from '../testhand.js'
import { deckOddsInput } from '../../routes/deckOdds.js'
import { ApiError } from '../../http.js'
import { mkCard } from './fixtures.js'
import type { CardFacts } from '../types.js'

type Row = [qty: number, id: string, name: string, category: CardFacts['category'], stage: string | null, trainerType: string | null]
const HIDE_N_SNEAK: Row[] = [
  [3, 'me05-034', 'Banette', 'Pokemon', 'Stage1', null],
  [1, 'sv06-141', 'Bloodmoon Ursaluna ex', 'Pokemon', 'Basic', null],
  [4, 'me05-039', 'Dhelmise', 'Pokemon', 'Basic', null],
  [1, 'sv08.5-080', 'Dudunsparce', 'Pokemon', 'Stage1', null],
  [1, 'sv05-129', 'Dudunsparce', 'Pokemon', 'Stage1', null],
  [2, 'sv08.5-079', 'Dunsparce', 'Pokemon', 'Basic', null],
  [1, 'sv06.5-038', 'Fezandipiti ex', 'Pokemon', 'Basic', null],
  [1, 'me02.5-076', "Lillie's Clefairy ex", 'Pokemon', 'Basic', null],
  [1, 'me04-070', 'Patrat', 'Pokemon', 'Basic', null],
  [2, 'me05-005', 'Poltchageist', 'Pokemon', 'Basic', null],
  [4, 'me05-033', 'Shuppet', 'Pokemon', 'Basic', null],
  [1, 'me05-006', 'Sinistcha', 'Pokemon', 'Stage1', null],
  [1, 'sv10.5b-079', 'Air Balloon', 'Trainer', null, 'Tool'],
  [3, 'me01-114', "Boss's Orders", 'Trainer', null, 'Supporter'],
  [2, 'sv08.5-101', 'Buddy-Buddy Poffin', 'Trainer', null, 'Item'],
  [2, 'me02.5-184', 'Buddy-Buddy Poffin', 'Trainer', null, 'Item'],
  [3, 'me05-078', 'Gwynn', 'Trainer', null, 'Supporter'],
  [4, 'me01-119', "Lillie's Determination", 'Trainer', null, 'Supporter'],
  [2, 'sv06.5-061', 'Night Stretcher', 'Trainer', null, 'Item'],
  [3, 'me03-081', 'Poké Pad', 'Trainer', null, 'Item'],
  [3, 'me04-080', 'Prism Tower', 'Trainer', null, 'Stadium'],
  [1, 'sv06-163', 'Secret Box', 'Trainer', null, 'Item'],
  [1, 'me04-082', 'Special Red Card', 'Trainer', null, 'Item'],
  [4, 'me01-131', 'Ultra Ball', 'Trainer', null, 'Item'],
  [5, 'base1-101', 'Psychic Energy', 'Energy', 'Basic', null],
  [4, 'me03-088', 'Telepathic Psychic Energy', 'Energy', null, null],
]

function deck(rows: Row[]): OddsEntry[] {
  return rows.map(([quantity, tcgdexId, name, category, stage, trainerType], i) => ({
    quantity,
    card: mkCard({ id: 1000 + i, tcgdexId, name, category, stage, trainerType, energyType: category === 'Energy' ? 'Normal' : null }),
  }))
}
const HNS = deck(HIDE_N_SNEAK)
const N = 60
const BASICS = 16

/** Four binomial standard errors at n trials. */
const tol = (p: number, n: number) => 4 * Math.sqrt((p * (1 - p)) / n) + 1e-9
function choose(n: number, k: number): number {
  let r = 1
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i
  return r
}
/** P(none of k specific cards among the first 7). */
const none7 = (k: number) => hypergeometricMulligan(N, k)

test('the real deck: 60 cards, 16 Basics, 24 names (two Poffin and two Dudunsparce printings fold)', () => {
  const r = deckOdds(HNS, { trials: 2_000 })
  assert.equal(r.deck.size, N)
  assert.equal(r.deck.basics, BASICS)
  assert.equal(r.deck.distinct_names, 24)
  assert.equal(r.method, 'Monte Carlo, draw-only')
  assert.equal(r.seed, 60, 'the default seed is fixed')
  assert.deepEqual(r.warnings, [])
})

test('determinism: the same seed gives the same result; list order does not matter', () => {
  const queries: OddsQuery[] = [{ all_of: [{ cards: ['Shuppet'] }, { cards: ['Ultra Ball', 'Buddy-Buddy Poffin'] }] }]
  const a = deckOdds(HNS, { trials: 20_000, seed: 7, queries })
  const b = deckOdds(HNS, { trials: 20_000, seed: 7, queries })
  const c = deckOdds([...HNS].reverse(), { trials: 20_000, seed: 7, queries })
  assert.deepEqual(a, b)
  assert.deepEqual(a, c, 'a saved deck and the same list typed in a different order must agree exactly')
  const d = deckOdds(HNS, { trials: 20_000, seed: 8, queries })
  assert.notEqual(a.queries[0]!.successes, d.queries[0]!.successes)
})

test('simulated mulligan rate matches the closed form', () => {
  const n = 100_000
  const r = deckOdds(HNS, { trials: n, seed: 11 })
  const exact = none7(BASICS)
  assert.equal(r.mulligan.exact, exact)
  assert.ok(Math.abs(r.mulligan.simulated - exact) < tol(exact, n), `sim ${r.mulligan.simulated} vs exact ${exact}`)
  // E[redraws] = p / (1 - p), geometric.
  assert.ok(Math.abs(r.mulligan.avg_per_game - exact / (1 - exact)) < 0.01)
  // E[Basics in the KEPT hand] = E[Basics in 7] / P(at least one).
  const kept = ((7 * BASICS) / N) / (1 - exact)
  assert.ok(Math.abs(r.avg_basics_in_hand - kept) < 0.02, `${r.avg_basics_in_hand} vs ${kept}`)
})

test('a single non-Basic card in the opening hand matches inclusion-exclusion over the kept hand', () => {
  // P(≥1 Ultra Ball AND ≥1 Basic) / P(≥1 Basic), Ultra Ball (4) disjoint from the 16 Basics.
  const exact = (1 - none7(4) - none7(BASICS) + none7(4 + BASICS)) / (1 - none7(BASICS))
  const n = 100_000
  const r = deckOdds(HNS, { trials: n, seed: 3, queries: [{ all_of: [{ cards: ['Ultra Ball'] }] }] })
  const q = r.queries[0]!
  assert.equal(q.zone, 'hand')
  assert.ok(Math.abs(q.exact! - exact) < 1e-12, `engine exact ${q.exact} vs independent ${exact}`)
  assert.ok(Math.abs(q.p - exact) < tol(exact, n), `sim ${q.p} vs exact ${exact}`)
  // Wilson score half-width: z·√(p(1−p)/n + z²/4n²) / (1 + z²/n).
  const z = 1.96
  assert.ok(Math.abs(q.margin95 - (z * Math.sqrt((q.p * (1 - q.p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n)) < 1e-12)
})

test('a Basic in the opening hand is P(≥1 of it) / P(≥1 Basic)', () => {
  const exact = (1 - none7(4)) / (1 - none7(BASICS))
  const n = 100_000
  const q = deckOdds(HNS, { trials: n, seed: 5, queries: [{ all_of: [{ cards: ['shuppet'] }] }] }).queries[0]!
  assert.ok(Math.abs(q.exact! - exact) < 1e-12)
  assert.ok(Math.abs(q.p - exact) < tol(exact, n), `sim ${q.p} vs exact ${exact}`)
})

/** 54 Basics + 6 others: every 7-card hand holds a Basic, so nothing is conditioned. */
function neverMulligans(): OddsEntry[] {
  return [
    { quantity: 54, card: mkCard({ id: 1, tcgdexId: 'x-1', name: 'Basic Mon', category: 'Pokemon', stage: 'Basic' }) },
    { quantity: 4, card: mkCard({ id: 2, tcgdexId: 'x-2', name: 'Rare Candy', category: 'Trainer', trainerType: 'Item' }) },
    { quantity: 2, card: mkCard({ id: 3, tcgdexId: 'x-3', name: 'Iono', category: 'Trainer', trainerType: 'Supporter' }) },
  ]
}

test('prizes: with no mulligans possible the textbook unconditional formulas hold exactly', () => {
  const n = 200_000
  const r = deckOdds(neverMulligans(), {
    trials: n, seed: 9,
    queries: [
      { all_of: [{ cards: ['Rare Candy'] }], prized: true },
      { all_of: [{ cards: ['Rare Candy'], count: 4 }], prized: true },
      { all_of: [{ cards: ['Rare Candy'], count: 2 }], prized: true },
    ],
  })
  assert.equal(r.mulligan.exact, 0)
  assert.equal(r.mulligan.simulated, 0)
  const any = 1 - choose(56, 6) / choose(60, 6)            // ≈ 0.3486
  const all = choose(56, 2) / choose(60, 6)                // ≈ 3.1e-5
  const atLeast2 = 1 - (choose(56, 6) + 4 * choose(56, 5)) / choose(60, 6)
  const [q1, q4, q2] = r.queries
  assert.ok(Math.abs(q1!.exact! - any) < 1e-12)
  assert.ok(Math.abs(q4!.exact! - all) < 1e-15)
  assert.ok(Math.abs(q2!.exact! - atLeast2) < 1e-12)
  assert.ok(Math.abs(q1!.p - any) < tol(any, n), `≥1 prized: ${q1!.p} vs ${any}`)
  assert.ok(q4!.p < 0.0005, `all 4 prized is tiny: ${q4!.p}`)
  assert.ok(Math.abs(q2!.p - atLeast2) < tol(atLeast2, n))
  assert.equal(q1!.zone, 'prized')
})

test('seen by turn N is the opening hand plus N draws, prizes never seen', () => {
  const n = 200_000
  const r = deckOdds(neverMulligans(), {
    trials: n, seed: 13,
    queries: [{ all_of: [{ cards: ['Rare Candy'] }], by_turn: 2 }, { all_of: [{ cards: ['Rare Candy'] }], by_turn: 10 }],
  })
  // No conditioning, so the seen cards are a uniform 9 (or 17) of the 60.
  const by2 = 1 - choose(56, 9) / choose(60, 9)
  const by10 = 1 - choose(56, 17) / choose(60, 17)
  assert.ok(Math.abs(r.queries[0]!.exact! - by2) < 1e-12)
  assert.ok(Math.abs(r.queries[1]!.exact! - by10) < 1e-12)
  assert.ok(Math.abs(r.queries[0]!.p - by2) < tol(by2, n))
  assert.ok(Math.abs(r.queries[1]!.p - by10) < tol(by10, n))
  assert.equal(r.queries[0]!.zone, 'seen')
  assert.equal(r.queries[0]!.by_turn, 2)
})

test('the real deck: prized sanity and by-turn monotonicity', () => {
  const n = 100_000
  const r = deckOdds(HNS, {
    trials: n, seed: 17,
    queries: [
      { all_of: [{ cards: ['Ultra Ball'], count: 4 }], prized: true },
      { all_of: [{ cards: ['Ultra Ball'] }], prized: true },
      { all_of: [{ cards: ['Shuppet'] }] },
      { all_of: [{ cards: ['Shuppet'] }], by_turn: 1 },
      { all_of: [{ cards: ['Shuppet'] }], by_turn: 2 },
    ],
  })
  const [all4, any, t0, t1, t2] = r.queries
  assert.ok(all4!.p < 0.001 && all4!.exact! < 0.0001, 'all four Ultra Ball prized is rare')
  for (const q of r.queries) assert.ok(Math.abs(q.p - q.exact!) < tol(q.exact!, n), `${q.label} ${q.zone}: ${q.p} vs ${q.exact}`)
  assert.ok(any!.exact! > 0.3 && any!.exact! < 0.4)
  assert.ok(t0!.exact! < t1!.exact! && t1!.exact! < t2!.exact!)
})

test('kinds match by card type, and a kind matches exactly what the same names match', () => {
  const mask = (row: Row) => kindMaskOf({ category: row[3], stage: row[4], trainerType: row[5] })
  assert.equal(mask(HIDE_N_SNEAK[1]!), 3, 'a Basic Pokémon is basic + pokemon')
  assert.equal(mask(HIDE_N_SNEAK[0]!), 2, 'a Stage 1 is pokemon only')
  assert.equal(mask(HIDE_N_SNEAK[12]!), 16, 'Air Balloon is a Tool')
  assert.equal(mask(HIDE_N_SNEAK[20]!), 32, 'Prism Tower is a Stadium')
  assert.equal(mask(HIDE_N_SNEAK[24]!), 64, 'basic Psychic Energy (stage "Basic" in the catalog) is Energy, not a Basic Pokémon')

  const r = deckOdds(HNS, {
    trials: 30_000, seed: 21,
    queries: [
      { all_of: [{ kinds: ['supporter'] }] },
      { all_of: [{ cards: ["Boss's Orders", 'Gwynn', "Lillie's Determination"] }] },
      { all_of: [{ kinds: ['basic'], count: 2 }] },
      { all_of: [{ kinds: ['pokemon'] }] },
    ],
  })
  const [kind, names, twoBasics, pokemon] = r.queries
  assert.equal(kind!.successes, names!.successes, 'same membership, same RNG stream, same count')
  assert.equal(kind!.exact, names!.exact)
  assert.equal(kind!.label, 'any Supporter')
  assert.equal(pokemon!.p, 1, 'every kept hand holds a Pokémon')
  assert.ok(Math.abs(twoBasics!.p - twoBasics!.exact!) < tol(twoBasics!.exact!, 30_000))
})

test('AND across groups, OR within one, and count', () => {
  const r = deckOdds(HNS, {
    trials: 40_000, seed: 23,
    queries: [
      { all_of: [{ cards: ['Shuppet'] }, { cards: ['Buddy-Buddy Poffin', 'Ultra Ball'] }] },
      { all_of: [{ cards: ['Shuppet'] }] },
      { all_of: [{ cards: ['Buddy-Buddy Poffin', 'Ultra Ball'] }] },
      { all_of: [{ cards: ['Shuppet'], count: 2 }] },
      { label: 'Turn-one Shuppet setup', all_of: [{ cards: ['Shuppet'] }, { kinds: ['supporter'] }] },
    ],
  })
  const [both, shuppet, outs, two, labelled] = r.queries
  assert.equal(both!.label, 'Shuppet + (Buddy-Buddy Poffin or Ultra Ball)')
  assert.equal(both!.exact, null, 'two groups are simulated only')
  assert.ok(both!.successes <= Math.min(shuppet!.successes, outs!.successes))
  assert.ok(both!.p > 0.15 && both!.p < 0.4, `plausible: ${both!.p}`)
  assert.equal(two!.label, '2+ Shuppet')
  assert.ok(two!.successes < shuppet!.successes)
  assert.equal(labelled!.label, 'Turn-one Shuppet setup')
})

test('names fold case, accents, spaces and punctuation', () => {
  assert.equal(foldCardName('Poké Pad'), foldCardName('POKE PAD'))
  assert.equal(foldCardName("Lillie's Determination"), foldCardName('lillie’s determination'))
  assert.equal(foldCardName("Boss's Orders"), foldCardName('Bosss Orders'), 'an apostrophe is dropped, not turned into a space')
  assert.equal(foldCardName("Farfetch'd"), foldCardName('Farfetchd'))
  assert.equal(foldCardName('Buddy-Buddy Poffin'), foldCardName('Buddy Buddy Poffin'))
  const r = deckOdds(HNS, { trials: 2_000, queries: [{ all_of: [{ cards: ['POKE PAD', 'lillie’s determination'] }] }] })
  assert.equal(r.queries[0]!.label, "Poké Pad or Lillie's Determination", 'labels use the deck’s own spelling')
})

test('an unknown card name fails and lists the deck’s real names', () => {
  assert.throws(
    () => deckOdds(HNS, { trials: 2_000, queries: [{ all_of: [{ cards: ['Rare Candy', 'Shuppet'] }] }] }),
    (err: unknown) => err instanceof OddsError && /Not in this deck: 'Rare Candy'\./.test(err.message)
      && /Banette, Bloodmoon Ursaluna ex,/.test(err.message) && !/'Shuppet'/.test(err.message),
  )
})

test('lists no game can start with fail; odd but playable lists compute and say so', () => {
  const noBasics = deck(HIDE_N_SNEAK.filter((r) => r[4] !== 'Basic' || r[3] !== 'Pokemon'))
  assert.throws(() => deckOdds(noBasics, { trials: 1_000 }), (e: unknown) => e instanceof OddsError && /no Basic Pokémon/.test(e.message))
  assert.throws(() => deckOdds(deck([[6, 'a-1', 'Pikachu', 'Pokemon', 'Basic', null]]), { trials: 1_000 }), /at least 7/)
  assert.throws(
    () => deckOdds(HNS, { trials: 1_000, queries: [{ all_of: [{ cards: ['Shuppet'] }], prized: true, by_turn: 2 }] }),
    /by_turn does not apply/,
  )

  const fiftyNine = deck(HIDE_N_SNEAK.map((r) => (r[1] === 'me01-131' ? [3, ...r.slice(1)] as Row : r)))
  const r59 = deckOdds(fiftyNine, { trials: 2_000 })
  assert.equal(r59.deck.size, 59)
  assert.match(r59.warnings.join('\n'), /59 cards, not 60/)

  const overCopied = deck(HIDE_N_SNEAK.map((r) => (r[1] === 'me01-131' ? [5, ...r.slice(1)] as Row : r)))
  const warn = deckOdds(overCopied, { trials: 2_000 }).warnings.join('\n')
  assert.match(warn, /5 copies of Ultra Ball/)
  assert.doesNotMatch(warn, /Psychic Energy:/, 'basic Energy may run past 4')

  const never = deckOdds(HNS, { trials: 2_000, queries: [{ all_of: [{ kinds: ['tool'], count: 2 }] }] })
  assert.match(never.warnings.join('\n'), /only 1 card in the deck match a group that needs 2/)
})

test('a deck too thin to reach turn N says the deck ran out', () => {
  const thin = [
    { quantity: 10, card: mkCard({ id: 1, tcgdexId: 'x-1', name: 'Basic Mon', category: 'Pokemon', stage: 'Basic' }) },
    { quantity: 5, card: mkCard({ id: 2, tcgdexId: 'x-2', name: 'Iono', category: 'Trainer', trainerType: 'Supporter' }) },
  ]
  const r = deckOdds(thin, { trials: 2_000, queries: [{ all_of: [{ cards: ['Iono'] }], by_turn: 5 }] })
  assert.match(r.warnings.join('\n'), /runs out after 2 draws/)
  // 15 cards: 7 + 6 Prizes leaves 2 draws; the exact path agrees with the simulator.
  assert.ok(Math.abs(r.queries[0]!.p - r.queries[0]!.exact!) < tol(r.queries[0]!.exact!, 2_000))
})

test('the default report: one line per name, sorted, and each value agrees with the closed form', () => {
  const n = 50_000
  const r = deckOdds(HNS, { trials: n })
  const lines = r.per_card!
  assert.equal(r.queries.length, 0)
  assert.equal(lines.length, 24)
  assert.deepEqual(lines.slice(0, 2).map((l) => [l.copies, l.name]), [[5, 'Psychic Energy'], [4, 'Buddy-Buddy Poffin']])
  for (let i = 1; i < lines.length; i++) assert.ok(lines[i - 1]!.copies >= lines[i]!.copies)
  const balloon = lines.find((l) => l.name === 'Air Balloon')!
  assert.equal(balloon.prized_all, null, 'one copy: "all prized" is just "prized"')
  const shuppet = lines.find((l) => l.name === 'Shuppet')!
  const exact = deckOdds(HNS, {
    trials: 1_000,
    queries: [
      { all_of: [{ cards: ['Shuppet'] }] },
      { all_of: [{ cards: ['Shuppet'] }], by_turn: 2 },
      { all_of: [{ cards: ['Shuppet'] }], prized: true },
    ],
  }).queries.map((q) => q.exact!)
  assert.ok(Math.abs(shuppet.opening - exact[0]!) < tol(exact[0]!, n))
  assert.ok(Math.abs(shuppet.by_turn - exact[1]!) < tol(exact[1]!, n))
  assert.ok(Math.abs(shuppet.prized_any - exact[2]!) < tol(exact[2]!, n))
  // Every copy prized is the closed form: C(4,4)·C(56,2)/C(60,6) shifted only slightly by the kept-hand condition.
  assert.ok(shuppet.prized_all! > 0 && shuppet.prized_all! < 0.0001, `${shuppet.prized_all}`)
  const fourPrized = deckOdds(HNS, { trials: 1_000, queries: [{ all_of: [{ cards: ['Shuppet'], count: 4 }], prized: true }] }).queries[0]!.exact!
  assert.equal(shuppet.prized_all, fourPrized)
  assert.ok(r.max_margin95 > 0.004 && r.max_margin95 < 0.0045)
})

test('one seed means the same games on every call, whatever was asked', () => {
  const n = 20_000
  const report = deckOdds(HNS, { trials: n })
  const shuppet = report.per_card!.find((l) => l.name === 'Shuppet')!
  const alone = deckOdds(HNS, { trials: n, queries: [{ all_of: [{ cards: ['Shuppet'] }] }] })
  const deeper = deckOdds(HNS, { trials: n, queries: [{ all_of: [{ cards: ['Shuppet'] }], by_turn: 10 }, { all_of: [{ cards: ['Shuppet'] }], prized: true }] })
  assert.equal(alone.queries[0]!.p, shuppet.opening, 'the default report and the question asked alone agree exactly')
  assert.equal(deeper.queries[1]!.p, shuppet.prized_any)
  assert.equal(alone.mulligan.simulated, report.mulligan.simulated)
  assert.equal(deeper.mulligan.simulated, report.mulligan.simulated, 'the mulligan line does not move with the queries')
})

test('performance: 50,000 games of the default report and of a heavy query set stay far under 2 s', () => {
  let t0 = performance.now()
  deckOdds(HNS, { trials: 50_000 })
  const report = performance.now() - t0
  const heavy: OddsQuery[] = Array.from({ length: 12 }, (_, i) => ({
    all_of: [
      { cards: ['Shuppet', 'Dhelmise'] }, { kinds: ['supporter', 'item'] }, { cards: ['Ultra Ball'], kinds: ['basic'] },
      { kinds: ['energy'], count: 2 }, { cards: ['Gwynn', "Boss's Orders"] }, { kinds: ['pokemon'], count: 3 },
    ],
    by_turn: i % 11,
  }))
  t0 = performance.now()
  deckOdds(HNS, { trials: 50_000, queries: heavy })
  const queries = performance.now() - t0
  assert.ok(report < 1_000 && queries < 1_000, `report ${report.toFixed(0)} ms, heavy queries ${queries.toFixed(0)} ms`)
})

// ── POST /decks/odds body validation (no database) ──────────────────────────

const status = (fn: () => unknown) => {
  try { fn() } catch (err) { return err instanceof ApiError ? err.status : -1 }
  return 200
}

test('the route takes exactly one deck form and bounded, well-formed queries', () => {
  const id = '6f1c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f'
  assert.equal(status(() => deckOddsInput({})), 400)
  assert.equal(status(() => deckOddsInput({ deck_id: id, cards: [{ name: 'Pikachu', quantity: 1 }] })), 400)
  assert.equal(status(() => deckOddsInput({ deck_id: 'my dhelmise deck' })), 404, 'names are resolved by the tool, not here')
  const ok = deckOddsInput({ deck_id: id })
  assert.deepEqual(ok, { deckId: id, lines: null, format: 'standard', queries: [], trials: 50_000, seed: 60 })
  assert.equal(deckOddsInput({ cards: [{ name: 'Pikachu', quantity: 4 }], format: 'expanded' }).format, 'expanded', "names resolve under the caller's format")
  assert.equal(deckOddsInput({ cards: [{ name: 'Pikachu', quantity: 4 }] }).lines!.length, 1)
  assert.equal(deckOddsInput({ ptcgl_text: '4 Pikachu SVI 1' }).lines!.length, 1)

  const q = (query: unknown) => status(() => deckOddsInput({ deck_id: id, queries: [query] }))
  assert.equal(q({ all_of: [{ cards: ['Shuppet'] }] }), 200)
  assert.equal(q({ all_of: [] }), 400)
  assert.equal(q({ all_of: [{}] }), 400, 'a group needs a name or a kind')
  assert.equal(q({ all_of: [{ kinds: ['trainer'] }] }), 400)
  assert.equal(q({ all_of: [{ cards: ['Shuppet'], count: 0 }] }), 400)
  assert.equal(q({ all_of: [{ cards: ['Shuppet'] }], by_turn: 11 }), 400)
  assert.equal(q({ all_of: [{ cards: ['Shuppet'] }], prized: true, by_turn: 1 }), 400)
  assert.equal(q({ all_of: Array.from({ length: 7 }, () => ({ cards: ['Shuppet'] })) }), 400)
  assert.equal(status(() => deckOddsInput({ deck_id: id, queries: Array.from({ length: 13 }, () => ({ all_of: [{ kinds: ['basic'] }] })) })), 400)
  assert.equal(status(() => deckOddsInput({ deck_id: id, trials: 999 })), 400)
  assert.equal(status(() => deckOddsInput({ deck_id: id, trials: 200_001 })), 400)
  assert.equal(status(() => deckOddsInput({ deck_id: id, seed: -1 })), 400)
  const parsed = deckOddsInput({ deck_id: id, trials: 1_000, seed: 5, queries: [{ all_of: [{ cards: [' Shuppet '] }], prized: true }] })
  assert.deepEqual(parsed.queries, [{ all_of: [{ cards: ['Shuppet'], count: 1 }], by_turn: 0, prized: true }])
})

// ── The CPU guards (review of #295) ─────────────────────────────────────────

/** `basics` copies of one Basic plus filler, `size` cards in all. */
function lowBasic(size: number, basics: number): OddsEntry[] {
  return [
    { quantity: basics, card: mkCard({ id: 1, tcgdexId: 'g-1', name: 'Lone Basic', category: 'Pokemon', stage: 'Basic' }) },
    { quantity: size - basics, card: mkCard({ id: 2, tcgdexId: 'g-2', name: 'Psychic Energy', category: 'Energy', energyType: 'Normal' }) },
  ]
}

test('a list past ODDS_MAX_DECK is refused before anything is dealt', () => {
  assert.equal(ODDS_MAX_DECK, 120)
  assert.doesNotThrow(() => deckOdds(lowBasic(120, 12), { trials: 1_000 }))
  for (const size of [121, 3_541, 17_941, 60_000]) {
    const t0 = performance.now()
    assert.throws(() => deckOdds(lowBasic(size, 1), { trials: 200_000 }),
      (e: unknown) => e instanceof OddsError && e.message.includes(`${size} cards`) && e.message.includes('stop at 120'))
    assert.ok(performance.now() - t0 < 50, `refusing ${size} cards must be immediate`)
  }
})

test('the hands budget cuts the games for a list that mulligans a lot, and says so', () => {
  // 120 cards, 1 Basic: p = 113/120, so a game deals 120/7 ≈ 17.1 hands.
  const p = hypergeometricMulligan(120, 1) // 113/120
  const t0 = performance.now()
  const r = deckOdds(lowBasic(120, 1), { trials: 200_000, queries: [{ all_of: [{ cards: ['Lone Basic'] }], prized: true }] })
  const ms = performance.now() - t0
  assert.equal(r.trials_requested, 200_000)
  assert.equal(r.trials, Math.floor(ODDS_MAX_HANDS * (1 - p)))
  assert.ok(r.trials < 200_000 && r.trials > 110_000)
  assert.ok(r.warnings.some((w) => w.startsWith(`Ran ${r.trials.toLocaleString('en-US')} of the 200,000 games`)))
  assert.ok(Math.abs(r.mulligan.exact - 113 / 120) < 1e-12)
  assert.ok(Math.abs(r.mulligan.avg_per_game - p / (1 - p)) < 0.3, 'the hands actually dealt match the budget model')
  assert.ok(Math.abs(r.queries[0]!.margin95 - margin95(r.queries[0]!.p, r.trials)) < 1e-15, 'margins are for the games run')
  assert.ok(ms < 2_000, `the worst list a request may send took ${ms.toFixed(0)} ms`)
  // A normal deck is never cut.
  const normal = deckOdds(HNS, { trials: 200_000 })
  assert.equal(normal.trials, 200_000)
  assert.ok(!normal.warnings.some((w) => w.startsWith('Ran ')))
})

test('Prize odds are conditioned on the kept hand holding a Basic', () => {
  // Four Basics are the only Basics, so every kept hand holds at least one of
  // them and fewer are left to be prized than in an unconditioned shuffle.
  const deck4 = lowBasic(60, 4)
  const n = 200_000
  const q = deckOdds(deck4, { trials: n, seed: 31, queries: [{ all_of: [{ cards: ['Lone Basic'] }], prized: true }] }).queries[0]!
  const unconditioned = 1 - choose(56, 6) / choose(60, 6)
  const keep = 1 - choose(56, 7) / choose(60, 7)
  let conditioned = 0
  for (let k = 1; k <= 4; k++) {
    const pk = (choose(4, k) * choose(56, 7 - k)) / choose(60, 7) / keep
    conditioned += pk * (1 - choose(53 - (4 - k), 6) / choose(53, 6))
  }
  assert.ok(Math.abs(q.exact! - conditioned) < 1e-12, `engine ${q.exact} vs independent ${conditioned}`)
  assert.ok(Math.abs(q.p - conditioned) < tol(conditioned, n), `sim ${q.p} vs conditioned ${conditioned}`)
  assert.ok(unconditioned - q.p > 10 * tol(conditioned, n), `clearly below the unconditioned ${unconditioned}`)
})

test('warnings are capped so the answer stays under the chat clamp', () => {
  const impossible: OddsQuery[] = Array.from({ length: 12 }, (_, i) => ({ label: `impossible ${i}`, all_of: [{ kinds: ['stadium'] }] }))
  const r = deckOdds(neverMulligans(), { trials: 1_000, queries: impossible })
  assert.equal(r.warnings.length, ODDS_MAX_WARNINGS)
  // One over-copied name (54 Basic Mon) and twelve impossible queries: seven shown, six summarised.
  assert.equal(r.warnings.at(-1), '…and 6 more notes like these.')
})
