// Energy tokens (owner review 2026-11-27, B1): the token and the glyph are two
// halves, so that new glyph artwork can replace energyGlyphs.tsx without
// touching the token. These pin the seams that make that a one-file swap.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel: string) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const GLYPHS = read('../energyGlyphs.tsx')
const ICON = read('../EnergyIcon.tsx')
const THEME = read('../../theme.css')

const TYPES = ['grass', 'fire', 'water', 'lightning', 'psychic', 'fighting', 'darkness', 'metal', 'fairy', 'dragon', 'colorless']

test('glyphs never hard-code an ink colour', () => {
  // The token picks the ink (dark on light discs, light on dark ones). A glyph
  // that paints #fff or a hex of its own would ignore that and vanish on half
  // the discs. Allowed paints: currentColor, the disc colour, or none.
  const paints = [...GLYPHS.matchAll(/\b(?:fill|stroke)=(?:"([^"]*)"|\{([^}]*)\})/g)].map((m) => m[1] ?? m[2])
  assert.ok(paints.length > 0, 'expected the glyphs to declare their paints')
  for (const p of paints) {
    assert.ok(['currentColor', 'none', 'CUT'].includes(p!), `glyph paint "${p}" must be currentColor, none or the disc colour (CUT)`)
  }
})

test('the token file carries no glyph artwork', () => {
  // If path data creeps back into EnergyIcon.tsx, swapping glyphs stops being
  // a one-file change.
  assert.doesNotMatch(ICON, /<path\b/, 'EnergyIcon.tsx must render ENERGY_GLYPHS, not its own <path> artwork')
  assert.match(ICON, /ENERGY_GLYPHS\[/, 'EnergyIcon.tsx must draw its glyph from ENERGY_GLYPHS')
})

test('every energy type has a glyph, a token colour and a theme colour', () => {
  for (const t of TYPES) {
    assert.match(GLYPHS, new RegExp(`\\n  ${t}:`), `energyGlyphs.tsx is missing ${t}`)
    assert.match(ICON, new RegExp(`${t}: \\{ color: 'var\\(--color-energy-${t}\\)'`), `EnergyIcon.tsx is missing the ${t} token`)
    assert.match(THEME, new RegExp(`--color-energy-${t}: #[0-9a-f]{6};`), `theme.css is missing --color-energy-${t}`)
  }
  assert.match(THEME, /--color-energy-ink: #[0-9a-f]{6};/)
  assert.match(THEME, /--color-energy-ink-light: #[0-9a-f]{6};/)
  assert.match(THEME, /\.energy-token \{/, 'theme.css must define the .energy-token treatment')
})
