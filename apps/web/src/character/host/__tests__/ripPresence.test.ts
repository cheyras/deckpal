/**
 * The rarity heuristic, kept alive across the removal of the thing it drove.
 *
 * Nothing reacts to a pull any more: the rip-presence feature was gutted on
 * purpose (see `ripPresence.ts` for the ruling and the reason). This heuristic
 * survived it, because it is the one part that was ever right and because the
 * overhaul will want it.
 *
 * The bar is deliberately set at the CHASE tiers rather than at "rare". Every
 * booster pack contains a guaranteed rare, so a character who reacts to that
 * reacts to literally every pack, every time — which is not a reaction, it is a
 * tic. These tests pin that judgement so it is changed on purpose rather than by
 * someone widening the pattern to be helpful.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { isRarityHit } from '../ripPresence'

test('the guaranteed slots are not worth a reaction', () => {
  for (const r of ['Common', 'Uncommon', 'Rare', 'Rare Holo', 'Promo', 'One Diamond', 'None']) {
    assert.equal(isRarityHit(r), false, `${r} should not fire`)
  }
})

test('the chase tiers are', () => {
  for (const r of [
    'Double rare',
    'Illustration rare',
    'Special illustration rare',
    'Ultra Rare',
    'Hyper rare',
    'Secret Rare',
    'Shiny Ultra Rare',
    'Radiant Rare',
    'Amazing Rare',
    'Rare PRIME',
  ]) {
    assert.equal(isRarityHit(r), true, `${r} should fire`)
  }
})

test('an absent rarity is not a hit', () => {
  assert.equal(isRarityHit(null), false)
  assert.equal(isRarityHit(undefined), false)
  assert.equal(isRarityHit(''), false)
})

test('it degrades honestly on a rarity that does not exist yet', () => {
  // The point of matching substrings rather than copying the ladder: a set that
  // ships a new chase name still reads as one, and the cost of a miss is a nod
  // instead of a gasp — never a wrong card in the collection.
  assert.equal(isRarityHit('Mega Illustration Rare'), true)
  assert.equal(isRarityHit('Triple rare'), false, 'a miss is acceptable, a crash is not')
})
