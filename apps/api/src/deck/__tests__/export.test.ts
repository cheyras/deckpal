import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPtcglExport, ptcglName, basicEnergyBrace, ptcglCodeForSet, type ExportRow } from '../export.js';
import { parsePtcgl } from '../ptcgl.js';

const noReprint = async () => null;

function row(over: Partial<ExportRow>): ExportRow {
  return {
    cardId: 1,
    tcgdexId: 'sv01-001',
    quantity: 1,
    name: 'Card',
    localId: '1',
    category: 'Trainer',
    energyType: null,
    setTcgdexId: 'sv01',
    setName: 'Scarlet & Violet',
    ...over,
  };
}

test('ME-era sets map to verified PTCGL codes (not uppercased tcgdex ids)', () => {
  assert.deepEqual(ptcglCodeForSet('me01'), { code: 'MEG', live: true });
  assert.deepEqual(ptcglCodeForSet('me02'), { code: 'PFL', live: true });
  assert.deepEqual(ptcglCodeForSet('me02.5'), { code: 'ASC', live: true });
  assert.deepEqual(ptcglCodeForSet('me03'), { code: 'POR', live: true });
  assert.deepEqual(ptcglCodeForSet('me04'), { code: 'CRI', live: true });
  assert.deepEqual(ptcglCodeForSet('me05'), { code: 'PBL', live: true });
  assert.equal(ptcglCodeForSet('base1'), null);           // no PTCGL code exists
  assert.equal(ptcglCodeForSet('xy1')!.live, false);      // code exists, set not in Live
});

test('normal card: PTCGL code + leading zeros stripped (PTCGL rejects "PBL 039")', async () => {
  const { text, warnings } = await buildPtcglExport(
    [row({ name: 'Dhelmise', localId: '039', category: 'Pokemon', setTcgdexId: 'me05', setName: 'Pitch Black', quantity: 4 })],
    noReprint,
  );
  assert.match(text, /^4 Dhelmise PBL 39$/m);
  assert.equal(warnings.length, 0);
});

test('secret rare: number above set count emitted as plain digits', async () => {
  const { text, warnings } = await buildPtcglExport(
    [row({ name: 'Umbreon ex', localId: '161', category: 'Pokemon', setTcgdexId: 'sv08.5', setName: 'Prismatic Evolutions' })],
    noReprint,
  );
  assert.match(text, /^1 Umbreon ex PRE 161$/m);
  assert.equal(warnings.length, 0);
});

test('basic Energy canonicalises to Basic {X} Energy SVE n whatever the paper print', async () => {
  const { text, warnings } = await buildPtcglExport(
    [row({ name: 'Psychic Energy', localId: '101', category: 'Energy', energyType: 'Normal', setTcgdexId: 'base1', setName: 'Base Set', quantity: 5 })],
    noReprint,
  );
  assert.match(text, /^5 Basic \{P\} Energy SVE 5$/m);
  assert.equal(warnings.length, 0, 'basic energy is always resolvable — no warning');
});

test('special Energy with a type word in the name gets the brace form, not the basic rewrite', async () => {
  const r = row({ name: 'Telepathic Psychic Energy', localId: '088', category: 'Energy', energyType: 'Normal', setTcgdexId: 'me03', setName: 'Perfect Order', quantity: 4 });
  assert.equal(basicEnergyBrace(r), null, 'not a plain "<Type> Energy" name');
  const { text, warnings } = await buildPtcglExport([r], noReprint);
  assert.match(text, /^4 Telepathic \{P\} Energy POR 88$/m);
  assert.equal(warnings.length, 0);
});

test('name rendering: curly apostrophes folded, accents kept, parenthetical disambiguator stripped', async () => {
  assert.equal(ptcglName('Boss’s Orders (Giovanni)', 'Trainer'), "Boss's Orders");
  assert.equal(ptcglName('Poké Pad', 'Trainer'), 'Poké Pad');
  assert.equal(ptcglName('Legacy Energy', 'Energy'), 'Legacy Energy'); // no type word -> untouched
  const { text } = await buildPtcglExport(
    [row({ name: 'Boss’s Orders (Giovanni)', localId: '114', setTcgdexId: 'me01', setName: 'Mega Evolution', quantity: 2 })],
    noReprint,
  );
  assert.match(text, /^2 Boss's Orders MEG 114$/m);
});

test('set with no PTCGL existence: bare name + structured warning, never a garbage code', async () => {
  const { text, warnings } = await buildPtcglExport(
    [
      row({ cardId: 7, tcgdexId: 'basep-24', name: 'Computer Error', localId: '16', category: 'Trainer', setTcgdexId: 'basep', setName: 'Wizards Black Star Promos', quantity: 2 }),
      row({ cardId: 8, tcgdexId: 'base1-4', name: 'Charizard', localId: '4', category: 'Pokemon', setTcgdexId: 'base1', setName: 'Base Set' }),
    ],
    noReprint,
  );
  assert.match(text, /^2 Computer Error$/m, 'trainer: bare name line');
  assert.match(text, /^1 Charizard$/m, 'pokemon: bare name line');
  assert.ok(!/BASEP|BASE1/.test(text), 'no uppercased tcgdex ids leak out');
  assert.equal(warnings.length, 2);
  assert.equal(warnings[0]!.code, 'NOT_ON_PTCGL');
  assert.equal(warnings[0]!.cardId, 'basep-24');
  assert.match(warnings[1]!.message, /will not import/);
});

test('out-of-pool print with a fingerprint-identical Live reprint is substituted + flagged', async () => {
  const { text, warnings } = await buildPtcglExport(
    [row({ cardId: 9, tcgdexId: 'xy12-88', name: 'Switch', localId: '88', category: 'Trainer', setTcgdexId: 'xy12', setName: 'Evolutions', quantity: 2 })],
    async () => ({ setCode: 'MEG', number: '130' }),
  );
  assert.match(text, /^2 Switch MEG 130$/m);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]!.code, 'SUBSTITUTED_PRINT');
  assert.match(warnings[0]!.message, /MEG 130/);
});

test('emitted text round-trips through our own parser with sections and totals intact', async () => {
  const { text } = await buildPtcglExport(
    [
      row({ name: 'Dhelmise', localId: '039', category: 'Pokemon', setTcgdexId: 'me05', setName: 'Pitch Black', quantity: 4 }),
      row({ name: 'Gwynn', localId: '078', category: 'Trainer', setTcgdexId: 'me05', setName: 'Pitch Black', quantity: 4 }),
      row({ name: 'Psychic Energy', localId: '101', category: 'Energy', energyType: 'Normal', setTcgdexId: 'base1', setName: 'Base Set', quantity: 5 }),
    ],
    noReprint,
  );
  assert.match(text, /^Pokémon: 1$/m);
  assert.match(text, /^Trainer: 1$/m);
  assert.match(text, /^Energy: 1$/m);
  assert.match(text, /^Total Cards: 13$/m);
  const back = parsePtcgl(text);
  assert.equal(back.lines.length, 3);
  assert.equal(back.trailerCount, 13);
  assert.equal(back.lines[2]!.name, 'Basic {P} Energy');
  assert.equal(back.lines[2]!.setCode, 'SVE');
});
