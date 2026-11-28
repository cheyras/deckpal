// Which sets the set tile draws as a printed-code badge (lib/printedSetCode.ts).
//
// Owner, 2026-11-27: the Mega Evolution Energy row showed a cluster of energy
// symbols where every other modern set shows its code — "it just says M-E-E,
// and that's what we should use." And the MEG badge smudged into "M.EG" at
// 428px, because the upstream symbol for `me01` is a 25×25 raster of that text.
// Both are answered by drawing the printed code as vector text, which only works
// if this table says the right thing for the right sets.
//
// 2026-11-27 (later): every code was re-checked against crops of real cards; that check
// added the four sets in CODES_READ_FROM_CARDS (decisions/2026/2026-11-27-printed-set-code-marks-drawn-as-the-card-prints-them.md).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CODES_READ_FROM_CARDS, printedSetCode, printedSetCodes } from '../printedSetCode.js'
import { canDrawCode } from '../../components/printedMark.js'
import { PRINTED_SETS } from '../../scan/ocr/codes.js'

test('energy sets get their printed code, like every other modern set', () => {
  assert.equal(printedSetCode('mee'), 'MEE')
  assert.equal(printedSetCode('sve'), 'SVE')
})

test('the codes the owner named, from the series page', () => {
  assert.equal(printedSetCode('me01'), 'MEG')
  assert.equal(printedSetCode('me02'), 'PFL')
  assert.equal(printedSetCode('me02.5'), 'ASC')
  assert.equal(printedSetCode('me03'), 'POR')
  assert.equal(printedSetCode('me05'), 'PBL')
  assert.equal(printedSetCode('sv03.5'), 'MEW')
})

test('the MEP promo prints its code; the SVP promo keeps its Black Star', () => {
  assert.equal(printedSetCode('mep'), 'MEP')
  assert.equal(printedSetCode('svp'), null)
})

test('codes read off the cards themselves: McDonald’s and the 30th Celebration', () => {
  // The scanner's table spells the McDonald's sets MCD23 / MCD24; the cards say M23 / M24.
  assert.equal(printedSetCode('2023sv'), 'M23')
  assert.equal(printedSetCode('2024sv'), 'M24')
  assert.equal(printedSetCode('2026me'), 'M26')
  assert.equal(printedSetCode('30th'), '30C')
})

test('sets that print a symbol, no code, or no single code fall through', () => {
  // mfb prints no code at all; 30th-c reprints keep their original print lines.
  for (const id of ['swsh12', 'swsh12tg', 'swsh12.5gg', 'base1', 'mfb', '30th-c', '2022swsh', 'no-such-set']) {
    assert.equal(printedSetCode(id), null, id)
  }
  assert.equal(printedSetCode(null), null)
  assert.equal(printedSetCode(undefined), null)
  assert.equal(printedSetCode(''), null)
})

test('every code is three characters the printed mark can draw', () => {
  assert.ok(printedSetCodes().size >= 30)
  for (const [id, code] of printedSetCodes()) {
    assert.match(code, /^[A-Z0-9]{3}$/, id)
    assert.ok(canDrawCode(code), `${id}: ${code} has a glyph the mark lacks`)
  }
  assert.ok(canDrawCode('EN'))
})

test('a code read off the cards is one the scanner table still lacks or spells differently', () => {
  // When scan/ocr/codes.ts gains (or corrects) one of these rows, this fails:
  // delete the entry from CODES_READ_FROM_CARDS so there is one source again.
  for (const [setId, code] of Object.entries(CODES_READ_FROM_CARDS)) {
    const row = PRINTED_SETS.find((s) => s.setId === setId)
    assert.ok(!row || row.code !== code, `${setId}: codes.ts now says ${row?.code} — drop the override`)
  }
})
