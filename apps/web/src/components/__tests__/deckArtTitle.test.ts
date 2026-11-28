// Deck-box art, pass 2: deck style, the art library, and the deck name printed
// on the box (components/deckArt/title.ts). Pure, so plain node.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { deckStyle, pickArt, STUDIO_FOR_STYLE, BOX_ART_VARIANTS, BACKDROP_VARIANTS, ENERGY_TYPES, DECK_STYLES, type ArtCardFacts, type ArtCardRow, type Candidate } from '../deckArt/derive'
import {
  displayText,
  fitTitle,
  graphemes,
  lineWidth,
  pickTreatment,
  TREATMENT_SPECS,
  TREATMENTS,
  TREATMENTS_FOR_STYLE,
  type Measure,
} from '../deckArt/title'

const row = (name: string, quantity: number, section: ArtCardRow['section'], stage: string | null = null, cardId = name): ArtCardRow => ({
  cardId,
  name,
  quantity,
  section,
  stage,
  images: { low: '', high: '' },
})
const cand = (name: string, stage: string | null, cardId = name): Candidate => ({
  cardId,
  name,
  stage,
  images: { low: '', high: '' },
  copies: 3,
  mentions: 0,
  preScore: 1,
})
const facts = (damage: string): ArtCardFacts => ({ types: [], evolvesFrom: null, attacks: [{ cost: 'Fire', damage }] })

// ── deck style ───────────────────────────────────────────────────────────────

test('deck style reads how the list plays', () => {
  const energy = (n: number) => [row('Fire Energy', n, 'energy')]
  const pk = [row('X', 4, 'pokemon')]
  assert.equal(deckStyle([...pk, ...energy(2)], [cand('Snorlax', 'Basic')], new Map()), 'control', '≤ 4 energy is control')
  assert.equal(deckStyle([...pk, ...energy(10)], [cand('Arcanine', 'Stage1')], new Map()), 'swarm', 'no rule box featured is single-prize')
  assert.equal(
    deckStyle([...pk, ...energy(8)], [cand('Charizard ex', 'Stage2')], new Map([['Charizard ex', facts('180+')]])),
    'power',
    'rule box hitting 200+ (180+ scales to 225)',
  )
  assert.equal(deckStyle([...pk, ...energy(8)], [cand('Gardevoir ex', 'Stage2')], new Map([['Gardevoir ex', facts('190')]])), 'engine')
  assert.equal(deckStyle([...pk, ...energy(8)], [cand('Raging Bolt ex', 'Basic')], new Map([['Raging Bolt ex', facts('70')]])), 'balanced')
  assert.equal(deckStyle(energy(10), [], new Map()), 'control', 'no Pokémon at all')
})

test('every style has a studio and every energy type a panel family, all in the shipped library', () => {
  const manifest = JSON.parse(
    fs.readFileSync(fileURLToPath(new URL('../deckArt/art/MANIFEST.json', import.meta.url)), 'utf8'),
  ) as { assets: { id: string; outputs: { file: string; bytes: number }[]; prompt: string }[] }
  const ids = new Set(manifest.assets.map((a) => a.id))
  for (const t of ENERGY_TYPES) for (const v of BOX_ART_VARIANTS) assert.ok(ids.has(`box-${t.toLowerCase()}-${v}`), `missing box-${t}-${v}`)
  for (const s of DECK_STYLES) for (const v of BACKDROP_VARIANTS) assert.ok(ids.has(`backdrop-${STUDIO_FOR_STYLE[s]}-${v}`), `missing studio for ${s}`)
  // Provenance: every shipped file is in the manifest with its prompt, and exists.
  const dir = fileURLToPath(new URL('../deckArt/art/', import.meta.url))
  const shipped = fs.readdirSync(dir).filter((f) => f.endsWith('.webp'))
  const listed = new Set(manifest.assets.flatMap((a) => a.outputs.map((o) => o.file)))
  for (const f of shipped) assert.ok(listed.has(f), `${f} has no manifest entry`)
  for (const a of manifest.assets) {
    assert.match(a.prompt, /no text/i, `${a.id}'s prompt must carry the no-text rule`)
    for (const o of a.outputs) assert.equal(fs.statSync(dir + o.file).size, o.bytes, `${o.file} bytes drifted from the manifest`)
  }
})

test('art picks are deterministic and spread across a family', () => {
  assert.deepEqual(pickArt('deck-1', 'Water', 'swarm'), pickArt('deck-1', 'Water', 'swarm'))
  assert.match(pickArt('deck-1', 'Water', 'swarm').backdrop, /^backdrop-bokeh-/)
  const studios = new Set(Array.from({ length: 60 }, (_, i) => pickArt(`d${i}`, 'Fire', 'power').backdrop))
  assert.equal(studios.size, 4)
})

// ── title treatments ─────────────────────────────────────────────────────────

test('a deck keeps its treatment, and a style mixes its treatments across decks', () => {
  for (const style of DECK_STYLES) {
    const seen = new Set(Array.from({ length: 50 }, (_, i) => pickTreatment(`deck-${i}`, style)))
    assert.deepEqual([...seen].sort(), [...TREATMENTS_FOR_STYLE[style]].sort(), style)
  }
  assert.equal(pickTreatment('abc', 'power'), pickTreatment('abc', 'power'))
  // Every treatment is reachable from some style.
  const reachable = new Set(Object.values(TREATMENTS_FOR_STYLE).flat())
  for (const t of TREATMENTS) assert.ok(reachable.has(t), t)
})

// A fake font: every grapheme is 0.6 em wide, a space 0.3, an emoji or CJK 1.
const measure: Measure = (s) =>
  graphemes(s).reduce((n, g) => n + (g === ' ' ? 0.3 : /[぀-鿿가-힯]|\p{Extended_Pictographic}/u.test(g) ? 1 : 0.6), 0)
const zone = { width: 78, height: 36 }

test('a short name prints on one line at the treatment’s full size', () => {
  const spec = TREATMENT_SPECS.foil
  const f = fitTitle('Zard', spec, zone, measure)
  assert.deepEqual(f.lines, ['ZARD'])
  assert.equal(f.size, spec.maxSize)
  assert.equal(f.clamped, false)
})

test('a longer name wraps instead of shrinking to nothing, keeping its words in order', () => {
  const spec = TREATMENT_SPECS.crest
  const name = 'Charizard Pidgeot Regionals'
  const f = fitTitle(name, spec, zone, measure)
  const oneLine = (zone.width - 2 * spec.padX) / lineWidth(name, 1, spec, measure)
  assert.ok(f.lines.length >= 2 && f.lines.length <= 3, f.lines.join(' / '))
  assert.ok(f.size > oneLine * 1.5, 'wrapping bought real size')
  assert.equal(f.lines.join(' '), name)
  for (const l of f.lines) assert.ok(lineWidth(l, f.size, spec, measure) <= zone.width - 2 * spec.padX + 1e-6, 'every line fits the zone')
})

test('an extra line has to buy real size', () => {
  // Short enough to print big on one line: it stays on one line.
  assert.equal(fitTitle('Mew ex', TREATMENT_SPECS.serif, zone, measure).lines.length, 1)
  // Two lines print "Lugia / Archeops" ~50% larger than one line can, so it wraps.
  const two = fitTitle('Lugia Archeops', TREATMENT_SPECS.serif, zone, measure)
  assert.deepEqual(two.lines, ['Lugia', 'Archeops'])
})

test('every fitted line fits, for every treatment, at every length up to the 120-character maximum', () => {
  const words = 'Lost Box Comfey Sableye Radiant Charizard Cramorant Iron Hands Klefki Mirage Gate Colress Experiment'.split(' ')
  for (const spec of Object.values(TREATMENT_SPECS)) {
    for (let len = 1; len <= 120; len += 7) {
      let name = ''
      for (let i = 0; name.length < len; i++) name += (name ? ' ' : '') + words[i % words.length]
      name = name.slice(0, len).trim() || 'A'
      const f = fitTitle(name, spec, zone, measure)
      assert.ok(f.lines.length >= 1 && f.lines.length <= spec.maxLines, `${spec.id} ${len}`)
      assert.ok(f.size >= spec.minSize - 1e-9, `${spec.id} ${len}: size ${f.size}`)
      for (const l of f.lines) assert.ok(lineWidth(l, f.size, spec, measure) <= zone.width - 2 * spec.padX + 1e-6, `${spec.id} ${len}: "${l}" overflows`)
      assert.ok(f.lines.length * f.size * spec.lineHeight <= zone.height - 2 * spec.padY + f.size, `${spec.id} ${len}: too tall`)
    }
  }
})

test('a name too long for two lines is clamped with an ellipsis, never cut silently', () => {
  const name = 'x'.repeat(30) + ' ' + 'y'.repeat(90)
  const f = fitTitle(name, TREATMENT_SPECS.varsity, zone, measure)
  assert.equal(f.clamped, true)
  assert.ok(f.lines[f.lines.length - 1].endsWith('…'))
})

test('CJK breaks between characters, emoji stay whole, accents survive uppercasing', () => {
  const cjk = fitTitle('リザードンとピジョット', TREATMENT_SPECS.foil, zone, measure)
  assert.equal(cjk.lines.length, 2, 'no spaces, so it breaks between characters')
  assert.equal(cjk.lines.join(''), 'リザードンとピジョット')
  const midCjk = fitTitle('リザードンとピジョットの最強デッキです', TREATMENT_SPECS.foil, zone, measure)
  assert.equal(midCjk.clamped, false, 'nineteen CJK characters still fit, over three lines')
  const longCjk = fitTitle('リザードンとピジョットの最強デッキです'.repeat(3), TREATMENT_SPECS.foil, zone, measure)
  assert.ok(longCjk.clamped && longCjk.lines[longCjk.lines.length - 1].endsWith('…'), 'CJK glyphs are a full em wide, so a long name clamps sooner')
  const emoji = fitTitle('🔥🔥 Fire 👨‍👩‍👧', TREATMENT_SPECS.varsity, zone, measure)
  assert.ok(emoji.lines.join(' ').includes('👨‍👩‍👧'), 'a ZWJ family emoji is one grapheme and is never split')
  assert.equal(displayText('  Ñandú   Évoli ', TREATMENT_SPECS.foil), 'ÑANDÚ ÉVOLI')
  assert.equal(displayText('Ñandú', TREATMENT_SPECS.serif), 'Ñandú', 'mixed-case treatments keep the name as typed')
  assert.deepEqual(fitTitle('   ', TREATMENT_SPECS.foil, zone, measure).lines, [])
})

test('words are never broken while a smaller size keeps them whole', () => {
  for (const spec of Object.values(TREATMENT_SPECS)) {
    for (const name of ['Charizard Pidgeot', 'Raging Bolt Ogerpon', 'Lugia Archeops', 'Gardevoir ex Control']) {
      const f = fitTitle(name, spec, zone, measure)
      const words = displayText(name, spec).split(' ')
      for (const l of f.lines) for (const piece of l.split(' ')) assert.ok(words.includes(piece), `${spec.id}: "${l}" splits a word`)
    }
  }
})

test('a single unbreakable word too long for one line breaks inside the word', () => {
  const f = fitTitle('Supercalifragilisticexpialidociouszard', TREATMENT_SPECS.crest, zone, measure)
  assert.ok(f.lines.length >= 1)
  for (const l of f.lines) assert.ok(lineWidth(l, f.size, TREATMENT_SPECS.crest, measure) <= zone.width - 2 * TREATMENT_SPECS.crest.padX + 1e-6)
})
