/**
 * "For some reason he has completely stopped asking me about variance."
 *
 * Measured 2026-08-23, ten trials, "Add five different Squirtle cards to my
 * collection" with no printing named: 100 items, 100 printings chosen by him,
 * zero left open, "Normal" 86 times. Every row therefore arrived at the approval
 * card classified `stated` — "they said which one" — and the picker never
 * rendered.
 *
 * A prompt rule was written first, telling him plainly to leave the field empty
 * unless the reader named a printing. The same ten trials, re-run: 100/100
 * before, 100/100 after. It moved nothing. So the witness to what the reader
 * said is the reader's own sentence, and this is the function that reads it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readerNamedPrinting } from '../printingSaid.js';

test('the sentence that produced the bug names no printing', () => {
  assert.equal(readerNamedPrinting('Add five different Squirtle cards to my collection'), false);
  assert.equal(readerNamedPrinting('add 5 charizards'), false);
  assert.equal(readerNamedPrinting('log the cards I just pulled'), false);
});

test('a reader who names one is believed', () => {
  for (const said of [
    'add a reverse holo Charizard',
    'give me the holo one',
    'I pulled a 1st edition Blastoise',
    'add 2 non-holo Squirtle',
    'the normal printing please',
    'add a Poke Ball pattern Pikachu',
  ]) {
    assert.equal(readerNamedPrinting(said), true, `missed a stated printing in ${JSON.stringify(said)}`);
  }
});

test('a CARD NAME containing a printing word does not count', () => {
  // The one that actually bites. There are 23,000 card names and somebody else
  // chooses them. A naive `includes('holo')` matches "Holon Castform" and every
  // row silently becomes "they stated it" again — the bug, restored, by the fix.
  assert.equal(readerNamedPrinting('add a Holon Castform'), false);
  assert.equal(readerNamedPrinting('add 3 Rapidash'), false);
  assert.equal(readerNamedPrinting('add Promotion Ticket'), false);
});

test('hyphens and spacing do not change the answer', () => {
  // "non-holo", "non holo" and "NON-HOLO" are one word to a person.
  for (const s of ['non-holo', 'non holo', 'NON-HOLO', 'reverse-holo', 'REVERSE HOLO']) {
    assert.equal(readerNamedPrinting(`add a ${s} Squirtle`), true, s);
  }
});

test('nothing, and non-strings, name no printing', () => {
  // It reaches the safe answer for absent input rather than throwing: a turn
  // that dies here would take out the whole write path.
  for (const v of ['', '   ', undefined, null, 42, {}, []]) {
    assert.equal(readerNamedPrinting(v as unknown), false, String(v));
  }
});

test('a rarity is not a printing, and must not be read as one', () => {
  // "Illustration rare" is a RARITY. Two cards of that rarity still have a
  // normal and a reverse printing between them, so hearing it settles nothing —
  // and treating it as settled would write a printing nobody picked.
  assert.equal(readerNamedPrinting('add the illustration rare Squirtle'), false);
  assert.equal(readerNamedPrinting('add a special illustration rare'), false);
  assert.equal(readerNamedPrinting('add the double rare one'), false);
});

test('each printing word carries its own weight, not just the ones "holo" covers', () => {
  // Dropping `reverse` from the vocabulary broke NO test, because every phrase
  // exercised above happened to contain "holo" as well. Bare "reverse" is a
  // thing collectors say on its own, and so are the others here — each of these
  // is the only assertion standing between its word and silent deletion.
  const only = {
    reverse: 'add a reverse Squirtle',
    foil: 'add the foil one',
    unlimited: 'add an unlimited Charizard',
    shadowless: 'add a shadowless Machop',
    promo: 'add the promo Pikachu',
    stamped: 'add a stamped Squirtle',
    cosmos: 'add the cosmos Blastoise',
    normal: 'add a normal Squirtle',
    regular: 'add the regular one',
    masterball: 'add a master ball Pikachu',
  }
  for (const [word, sentence] of Object.entries(only)) {
    assert.equal(readerNamedPrinting(sentence), true, `"${word}" no longer counts: ${sentence}`)
    assert.ok(!/holo/i.test(sentence), `${sentence} leans on "holo" and proves nothing about "${word}"`)
  }
})
