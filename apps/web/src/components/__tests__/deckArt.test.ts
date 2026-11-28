// The deck-box art's rulebook (components/deckArt/derive.ts) and its colour
// maths. Pure functions, so these run in the plain node suite.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DERIVE_VERSION,
  costSymbols,
  damageValue,
  deriveDeckArt,
  derivePalette,
  energyTypeFromName,
  hashString,
  mentionCount,
  provisionalDeckArt,
  quantizeSwatch,
  rankCandidates,
  TYPE_COLORS,
  type ArtCardFacts,
  type ArtCardRow,
} from '../deckArt/derive'
import { contrastRatio, hexToOklch, hexToRgb, hueDelta, oklchToHex, oklchToRgb, rgbToOklch } from '../deckArt/color'
import { dominantColor } from '../deckArt/swatch'
import { artKey, clearSpecs, pruneSpecs, readSpec, resetSpecCacheForTests, writeSpec } from '../deckArt/store'

// ── fixtures ─────────────────────────────────────────────────────────────────

let n = 0
function row(name: string, quantity: number, section: ArtCardRow['section'], stage: string | null = null, cardId?: string): ArtCardRow {
  const id = cardId ?? `t-${++n}`
  return { cardId: id, name, quantity, section, stage, images: { low: `/deckpal/images/en/x/y/${id}/low.webp`, high: `/deckpal/images/en/x/y/${id}/high.webp` } }
}
const facts = (types: string[], attacks: [string | null, string | null][], evolvesFrom: string | null = null, abilities = 0): ArtCardFacts => ({
  types,
  evolvesFrom,
  attacks: attacks.map(([cost, damage]) => ({ cost, damage })),
  abilities: Array.from({ length: abilities }, () => ({})),
})

/** Charizard ex / Pidgeot ex, the archetype every rule below has to get right. */
function charizardDeck() {
  const rows = [
    row('Charmander', 3, 'pokemon', 'Basic', 'charmander'),
    row('Charmeleon', 1, 'pokemon', 'Stage1', 'charmeleon'),
    row('Charizard ex', 2, 'pokemon', 'Stage2', 'charizard-a'),
    row('Charizard ex', 1, 'pokemon', 'Stage2', 'charizard-b'),
    row('Pidgey', 2, 'pokemon', 'Basic', 'pidgey'),
    row('Pidgeot ex', 2, 'pokemon', 'Stage2', 'pidgeot'),
    row('Fezandipiti ex', 1, 'pokemon', 'Basic', 'fez'),
    row("Professor's Research", 4, 'trainer'),
    row('Rare Candy', 4, 'trainer'),
    row('Fire Energy', 6, 'energy'),
    row('Jet Energy', 2, 'energy'),
  ]
  const f = new Map<string, ArtCardFacts>([
    ['charizard-a', facts(['Darkness'], [['Fire,Fire', '180+']], 'Charmeleon', 1)],
    ['pidgeot', facts(['Colorless'], [['Colorless,Colorless', '120']], 'Pidgeotto', 1)],
    ['charmander', facts(['Fire'], [['Fire', '30']])],
    ['charmeleon', facts(['Fire'], [['Fire,Colorless', '50']], 'Charmander')],
  ])
  return { rows, facts: f }
}

// ── reading the deck ─────────────────────────────────────────────────────────

test('energy cards name their type in words; untyped special energy says nothing', () => {
  assert.equal(energyTypeFromName('Fire Energy'), 'Fire')
  assert.equal(energyTypeFromName('Basic Darkness Energy'), 'Darkness')
  assert.equal(energyTypeFromName('Hiding Darkness Energy'), 'Darkness')
  assert.equal(energyTypeFromName('Jet Energy'), null)
  assert.equal(energyTypeFromName('Luminous Energy'), null)
  assert.equal(energyTypeFromName('Double Turbo Energy'), null)
})

test('attack costs parse from the API string and from an array', () => {
  assert.deepEqual(costSymbols('Fire,Fire'), ['Fire', 'Fire'])
  assert.deepEqual(costSymbols(['Lightning', 'Fighting', 'Colorless']), ['Lightning', 'Fighting', 'Colorless'])
  assert.deepEqual(costSymbols(null), [])
  assert.deepEqual(costSymbols(''), [])
})

test('printed damage becomes comparable: + and × modifiers scale up, blanks are 0', () => {
  assert.equal(damageValue('30'), 30)
  assert.equal(damageValue('180+'), 225)
  assert.equal(damageValue('70×'), 175)
  assert.equal(damageValue(''), 0)
  assert.equal(damageValue(null), 0)
})

test('printings of one Pokémon fold into one candidate, represented by the most-played print', () => {
  const c = rankCandidates(charizardDeck().rows)
  const zard = c.find((x) => x.name === 'Charizard ex')!
  assert.equal(zard.copies, 3)
  assert.equal(zard.cardId, 'charizard-a')
  assert.equal(c.filter((x) => x.name === 'Charizard ex').length, 1)
  assert.ok(!c.some((x) => x.name === 'Rare Candy'), 'trainers are never candidates')
})

test('a strategy guide that keeps naming a card raises it', () => {
  assert.equal(mentionCount('Charizard ex', 'Set up Charizard ex early. charizard ex hits hard; Charizard exists.'), 2)
  const md = 'Pidgeot ex finds pieces. Pidgeot ex. Pidgeot ex. Pidgeot ex. Pidgeot ex.'
  const plain = rankCandidates(charizardDeck().rows)
  const guided = rankCandidates(charizardDeck().rows, md)
  const score = (cs: typeof plain, name: string) => cs.find((x) => x.name === name)!.preScore
  assert.ok(score(guided, 'Pidgeot ex') > score(plain, 'Pidgeot ex'))
})

// ── featured Pokémon ─────────────────────────────────────────────────────────

test('Charizard ex / Pidgeot ex: the attacker is featured, not the engine that searches for it, nor the basics', () => {
  const { rows, facts: f } = charizardDeck()
  const spec = deriveDeckArt({ deckId: 'd1', rows, facts: f })
  // Pidgeot ex has as many copies and a 120 attack, but pays Colorless for it;
  // Charizard ex's 180+ is paid in the Fire the deck actually plays.
  assert.deepEqual(spec.featured.map((c) => c.name), ['Charizard ex'])
  assert.deepEqual(spec.types, ['Fire'], 'Tera Charizard is Darkness-typed but the deck plays and pays Fire')
  assert.equal(spec.motif.kind, 'rays')
})

test('two real attackers share the box', () => {
  const rows = [row('Miraidon ex', 3, 'pokemon', 'Basic', 'mir'), row('Iron Hands ex', 2, 'pokemon', 'Basic', 'ih'), row('Squawkabilly ex', 1, 'pokemon', 'Basic', 'sq'), row('Lightning Energy', 10, 'energy')]
  const f = new Map([
    ['mir', facts(['Lightning'], [['Lightning,Lightning,Colorless', '220']], null, 1)],
    ['ih', facts(['Lightning'], [['Lightning,Lightning,Colorless', '160'], ['Lightning,Lightning,Colorless,Colorless', '120']])],
    ['sq', facts(['Colorless'], [['Colorless', '20']], null, 1)],
  ])
  const spec = deriveDeckArt({ deckId: 'm', rows, facts: f })
  assert.deepEqual(spec.featured.map((c) => c.name), ['Miraidon ex', 'Iron Hands ex'])
  assert.deepEqual(spec.types, ['Lightning'])
})

test('a 3-3 line whose attack prints no damage still leads a one-copy 200-damage tech', () => {
  const rows = [
    row('Regidrago V', 3, 'pokemon', 'Basic', 'rv'),
    row('Regidrago VSTAR', 3, 'pokemon', 'VSTAR', 'rvs'),
    row('Dragapult ex', 1, 'pokemon', 'Stage2', 'dp'),
    row('Grass Energy', 6, 'energy'),
    row('Fire Energy', 3, 'energy'),
  ]
  const f = new Map([
    ['rvs', facts(['Dragon'], [['Grass,Grass,Fire', null]], 'Regidrago V')],
    ['dp', facts(['Dragon'], [['Colorless', '70'], ['Fire,Psychic', '200']], 'Drakloak')],
  ])
  assert.equal(deriveDeckArt({ deckId: 'rd', rows, facts: f }).featured[0].name, 'Regidrago VSTAR')
})

test('a pre-evolution is never featured over its own evolved line, however many copies', () => {
  const rows = [row('Ralts', 4, 'pokemon', 'Basic', 'ralts'), row('Kirlia', 3, 'pokemon', 'Stage1', 'kirlia'), row('Gardevoir ex', 2, 'pokemon', 'Stage2', 'garde'), row('Psychic Energy', 7, 'energy')]
  const f = new Map([
    ['garde', facts(['Psychic'], [['Psychic,Psychic,Colorless', '190']], 'Kirlia', 1)],
    ['kirlia', facts(['Psychic'], [['Colorless,Colorless', '20']], 'Ralts', 1)],
    ['ralts', facts(['Psychic'], [['Psychic', '10']])],
  ])
  const spec = deriveDeckArt({ deckId: 'g', rows, facts: f })
  assert.deepEqual(spec.featured.map((c) => c.name), ['Gardevoir ex'])
  assert.deepEqual(spec.types, ['Psychic'])
})

test('an Ability engine with no real attack loses to the attacker even with more copies', () => {
  const rows = [
    row('Bidoof', 4, 'pokemon', 'Basic', 'bidoof'),
    row('Bibarel', 4, 'pokemon', 'Stage1', 'bibarel'),
    row('Raging Bolt ex', 3, 'pokemon', 'Basic', 'bolt'),
    row('Lightning Energy', 4, 'energy'),
    row('Fighting Energy', 4, 'energy'),
    row('Grass Energy', 5, 'energy'),
  ]
  const f = new Map([
    ['bibarel', facts(['Colorless'], [['Colorless,Colorless,Colorless', '60']], 'Bidoof', 1)],
    ['bolt', facts(['Dragon'], [['Colorless', null], ['Lightning,Fighting', '70×']])],
    ['bidoof', facts(['Colorless'], [['Colorless', '20']])],
  ])
  const spec = deriveDeckArt({ deckId: 'rb', rows, facts: f })
  assert.equal(spec.featured[0].name, 'Raging Bolt ex')
  assert.ok(!spec.featured.some((c) => c.name === 'Bidoof'))
  // Grass leads on card count, but Lightning and Fighting are what the attacker pays.
  assert.deepEqual(spec.types, ['Lightning', 'Fighting', 'Grass'])
})

test("a one-copy tech's attack cost does not add a type to the box", () => {
  const rows = [row('Lugia V', 3, 'pokemon', 'Basic', 'lv'), row('Lugia VSTAR', 3, 'pokemon', 'VSTAR', 'lvs'), row('Lumineon V', 1, 'pokemon', 'Basic', 'lum'), row('Jet Energy', 4, 'energy')]
  const f = new Map([
    ['lvs', facts(['Colorless'], [['Colorless,Colorless,Colorless,Colorless', '220']], 'Lugia V')],
    ['lum', facts(['Water'], [['Water,Colorless,Colorless', '120']], null, 1)],
  ])
  assert.deepEqual(deriveDeckArt({ deckId: 'l2', rows, facts: f }).types, ['Colorless'])
})

test('a deck that pays only Colorless shows Colorless', () => {
  const rows = [row('Lugia V', 3, 'pokemon', 'Basic', 'lv'), row('Lugia VSTAR', 3, 'pokemon', 'VSTAR', 'lvs'), row('Double Turbo Energy', 4, 'energy')]
  const f = new Map([['lvs', facts(['Colorless'], [['Colorless,Colorless,Colorless,Colorless', '220']], 'Lugia V')]])
  const spec = deriveDeckArt({ deckId: 'l', rows, facts: f })
  assert.deepEqual(spec.featured.map((c) => c.name), ['Lugia VSTAR'])
  assert.deepEqual(spec.types, ['Colorless'])
})

test("a GLC deck's declared type always leads its energy types", () => {
  const rows = [row('Charmander', 1, 'pokemon', 'Basic', 'c1'), row('Fire Energy', 1, 'energy'), row('Water Energy', 9, 'energy')]
  const spec = deriveDeckArt({ deckId: 'glc', glcType: 'Fire', rows, facts: new Map() })
  assert.equal(spec.types[0], 'Fire')
})

test('missing catalog facts degrade to the row-only order, never to nothing', () => {
  const { rows } = charizardDeck()
  const spec = deriveDeckArt({ deckId: 'nofacts', rows, facts: new Map() })
  assert.ok(spec.featured.length >= 1)
  assert.ok(spec.featured.every((c) => !/^(Charmander|Pidgey)$/.test(c.name)) || spec.featured[0].name === 'Charizard ex')
  assert.deepEqual(spec.types, ['Fire'])
})

test('a deck with no Pokémon features nothing and still has a palette', () => {
  const spec = deriveDeckArt({ deckId: 'trainers', rows: [row('Nest Ball', 4, 'trainer')], facts: new Map() })
  assert.deepEqual(spec.featured, [])
  assert.deepEqual(spec.types, [])
  for (const v of Object.values(spec.palette)) assert.match(v, /^#[0-9a-f]{6}$/)
})

// ── determinism ──────────────────────────────────────────────────────────────

test('the same deck always derives the same art; another deck id only moves the motif', () => {
  const { rows, facts: f } = charizardDeck()
  const swatch = { l: 0.55, c: 0.14, h: 40 }
  const a = deriveDeckArt({ deckId: 'same', rows, facts: f, artSwatch: swatch })
  const b = deriveDeckArt({ deckId: 'same', rows: [...rows].reverse(), facts: new Map([...f].reverse()), artSwatch: swatch })
  assert.deepEqual(a, b, 'row order and fact order must not matter')
  const c = deriveDeckArt({ deckId: 'other', rows, facts: f, artSwatch: swatch })
  assert.deepEqual(c.featured, a.featured)
  assert.deepEqual(c.palette, a.palette)
  assert.notEqual(c.motif.seed, a.motif.seed)
  assert.equal(a.v, DERIVE_VERSION)
  assert.equal(hashString('abc'), hashString('abc'))
})

test('art swatches snap to a coarse grid, so two decoders agree on the colour', () => {
  const a = quantizeSwatch({ l: 0.612, c: 0.124, h: 41 })
  const b = quantizeSwatch({ l: 0.605, c: 0.118, h: 44 })
  assert.deepEqual(a, b)
})

test('the provisional box: neutral for a plain deck, typed for a GLC deck, never featured', () => {
  const plain = provisionalDeckArt('p')
  assert.equal(plain.provisional, true)
  assert.deepEqual(plain.featured, [])
  const glc = provisionalDeckArt('p', 'Water')
  assert.deepEqual(glc.types, ['Water'])
  assert.equal(glc.motif.kind, 'waves')
})

// ── palette ──────────────────────────────────────────────────────────────────

test('the box takes the leading type; the studio takes the art', () => {
  const fire = hexToOklch(TYPE_COLORS.Fire)
  const p = derivePalette(['Fire', 'Psychic'], { l: 0.6, c: 0.12, h: 300 })
  assert.ok(Math.abs(hueDelta(hexToOklch(p.box).h, fire.h)) < 8, 'box hue follows Fire')
  assert.ok(Math.abs(hueDelta(hexToOklch(p.wall).h, 300)) < 12, 'wall hue follows the art')
  // The studio stays dark so the page stays calm.
  assert.ok(hexToOklch(p.wall).l < 0.4 && hexToOklch(p.floorLow).l < 0.22)
})

test('a near-neutral type borrows a little of the art hue so grey boxes differ', () => {
  const a = derivePalette(['Colorless'], { l: 0.6, c: 0.12, h: 240 })
  const b = derivePalette(['Colorless'], { l: 0.6, c: 0.12, h: 30 })
  assert.notEqual(a.box, b.box)
})

test('energy icons sit on a band dark enough to read every type colour against', () => {
  for (const t of ['Fire', 'Water', 'Lightning', 'Darkness', 'Colorless', 'Metal'] as const) {
    const p = derivePalette([t], null)
    assert.ok(contrastRatio(hexToRgb(p.band), hexToRgb('#ffffff')) > 10, `${t} band too light`)
  }
})

// ── colour maths ─────────────────────────────────────────────────────────────

test('OKLCH round-trips sRGB and gamut-maps by chroma only', () => {
  for (const hex of ['#e2622f', '#3d8fd8', '#efc11a', '#1c1917', '#ffffff']) {
    assert.equal(oklchToHex(hexToOklch(hex)), hex)
  }
  const wild = oklchToRgb({ l: 0.7, c: 0.4, h: 140 })
  for (const ch of [wild.r, wild.g, wild.b]) assert.ok(ch >= 0 && ch <= 255)
  const back = rgbToOklch(wild)
  assert.ok(Math.abs(back.l - 0.7) < 0.02, 'lightness kept')
  assert.ok(Math.abs(hueDelta(back.h, 140)) < 6, 'hue kept')
})

test('the art sampler finds the dominant vivid colour and ignores greys', () => {
  const px: number[] = []
  for (let i = 0; i < 200; i++) px.push(220, 90, 40, 255) // orange
  for (let i = 0; i < 120; i++) px.push(128, 128, 128, 255) // grey
  for (let i = 0; i < 40; i++) px.push(40, 90, 220, 255) // a little blue
  const c = dominantColor(px)!
  assert.ok(c && Math.abs(hueDelta(c.h, rgbToOklch({ r: 220, g: 90, b: 40 }).h)) < 10)
  assert.equal(dominantColor(Array.from({ length: 400 }, (_, i) => (i % 4 === 3 ? 255 : 120))), null)
})

// ── cache ────────────────────────────────────────────────────────────────────

test('cached specs are keyed by deck state and pruned with the deck list', () => {
  resetSpecCacheForTests()
  const deck = { version: 3, updatedAt: '2026-11-27T00:00:00Z', totalCount: 60 }
  const k = artKey(deck)
  assert.notEqual(artKey({ ...deck, version: 4 }), k)
  assert.notEqual(artKey({ ...deck, totalCount: 59 }), k)
  const spec = provisionalDeckArt('a')
  writeSpec('a', k, spec)
  assert.deepEqual(readSpec('a', k), spec)
  assert.equal(readSpec('a', artKey({ ...deck, version: 4 })), null, 'an edited deck re-derives')
  pruneSpecs(new Set(['b']))
  assert.equal(readSpec('a', k), null)
  writeSpec('b', k, spec)
  clearSpecs()
  assert.equal(readSpec('b', k), null, 'sign-out forgets every deck')
})
