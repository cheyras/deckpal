import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePtcgl, serializePtcgl, toSerializable, parseMassEntry, serializeMassEntry } from '../ptcgl.js';
import { EXAMPLE_A, EXAMPLE_B, EXAMPLE_C } from './fixtures.js';

const norm = (l: ReturnType<typeof parsePtcgl>['lines'][number]) =>
  ({ quantity: l.quantity, name: l.name, setCode: l.setCode, number: l.number, print: l.print, section: l.section });

for (const [label, text, expectLines] of [
  ['Example A (Charizard ex, PH + SVALT)', EXAMPLE_A, 29],
  ['Example B (ALT + CRZ-GG sub-set)', EXAMPLE_B, 23],
  ['Example C (promo prefixes, no trailer)', EXAMPLE_C, 44],
] as const) {
  test(`round-trip stable: ${label}`, () => {
    const first = parsePtcgl(text);
    assert.equal(first.lines.length, expectLines, 'card-line count');
    const serialized = serializePtcgl(toSerializable(first));
    const second = parsePtcgl(serialized);
    assert.deepEqual(second.lines.map(norm), first.lines.map(norm), 'lines stable across parse->serialize->parse');
  });
}

test('right-to-left parse handles names with colons/hyphens/apostrophes/braces', () => {
  const { lines } = parsePtcgl([
    'Pokémon: 2',
    '1 Xurkitree-GX PR-SM 68',       // hyphen in name, hyphen in set code
    '1 Origin Forme Palkia VSTAR ASR 40',
    '',
    'Trainer: 3',
    "1 Boss's Orders PAL 172",       // apostrophe
    '1 Technical Machine: Devolution PAR 177', // colon in name (§1.5 case 8)
    '2 Air Balloon',                 // bare Trainer line (§1.5 case 4)
    '',
    'Energy: 1',
    '4 Basic {R} Energy SVE 10',     // braces
  ].join('\n'));
  assert.equal(lines[0]!.name, 'Xurkitree-GX');
  assert.equal(lines[0]!.setCode, 'PR-SM');
  assert.equal(lines[3]!.name, 'Technical Machine: Devolution');
  assert.equal(lines[3]!.number, '177');
  assert.equal(lines[4]!.name, 'Air Balloon');   // not mis-split
  assert.equal(lines[4]!.setCode, null);
  assert.equal(lines[5]!.name, 'Basic {R} Energy');
});

test('header counts are advisory; PH preserved; trailer mismatch warns not fails', () => {
  const { lines, warnings, trailerCount } = parsePtcgl([
    'Pokémon: 99',            // wrong on purpose (§1.3)
    '1 Mimikyu PAL 97 PH',
    'Total Cards: 5',         // wrong on purpose
  ].join('\n'));
  assert.equal(lines[0]!.print, 'PH');
  assert.equal(trailerCount, 5);
  assert.ok(warnings.some((w) => w.code === 'TOTAL_MISMATCH'));
});

test('Mass Entry is a different grammar: 1 Goldeen [ME05] 13', () => {
  const { lines } = parseMassEntry('1 Goldeen [ME05] 13\n4 Rare Candy [SVI]\n2 Professor’s Research');
  assert.deepEqual(lines[0], { quantity: 1, name: 'Goldeen', setCode: 'ME05', number: '13', raw: '1 Goldeen [ME05] 13' });
  assert.equal(lines[1]!.setCode, 'SVI');
  assert.equal(lines[1]!.number, null);
  assert.equal(lines[2]!.setCode, null);
  // round-trip
  assert.equal(serializeMassEntry(lines).trim().split('\n')[0], '1 Goldeen [ME05] 13');
});
