/** Every deck in the owner's account (two of theirs + the 11-deck gauntlet) is fully scripted. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createContext } from '../context.js';
import { HIDE_N_SNEAK, TOOLBOX_SLOWKING } from './decks.js';
import { GAUNTLET_LISTS, gauntletDeck } from './gauntlet.js';

test('no approximated or unplayable card in any account deck', () => {
  const decks = [HIDE_N_SNEAK, TOOLBOX_SLOWKING, ...Object.keys(GAUNTLET_LISTS).map(gauntletDeck)];
  const bad: string[] = [];
  for (const d of decks) {
    const total = d.cards.reduce((a, e) => a + e.count, 0);
    assert.equal(total, 60, `${d.name} has ${total} cards`);
    const ctx = createContext(d, d);
    for (const x of ctx.defs) if (x.coverage === 'approx' || x.coverage === 'none') bad.push(`${d.name}: ${x.id} ${x.name} (${x.coverage})`);
  }
  assert.deepEqual(bad, []);
});
