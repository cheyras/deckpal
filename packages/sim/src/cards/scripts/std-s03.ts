/**
 * The last two Standard cards, skipped by earlier batches until the engine could say them (sweep batch s03).
 * Written from the printed text in frames-extra/standard.ts; quotes below are that text.
 * Tests: src/__tests__/cards-std-s03.test.ts.
 */
import type { CardScript, Expr, Program } from '../../dsl.js';
import './std-seed1-customs.js'; // std.discardStadium

/** 1 when the Stadium was discarded for the bonus, else 0. */
const DISCARDED: Expr = { v: 'stadiumDiscarded' };

/** "You may discard a Stadium in play." (only offered when there is one) */
const MAY_DISCARD: Program = [
  { op: 'set', v: 'stadiumDiscarded', value: 0 },
  {
    op: 'if',
    cond: { stadium: true },
    then: [{ op: 'may', prompt: 'Discard the Stadium in play for 140 more damage?', body: [{ op: 'custom', fn: 'std.discardStadium' }, { op: 'set', v: 'stadiumDiscarded', value: 1 }] }],
  },
];

export const STD_S03: CardScript[] = [
  {
    id: 'sv08.5-111',
    name: 'Haban Berry',
    // "If the Pokémon this card is attached to is damaged by an attack from your opponent's {N} Pokémon, it takes 60 less damage (after applying Weakness and Resistance), and discard this card."
    // The same shape as the five Berries in std-engine4.ts: a `damageIn` filtered on the attacker's type, and the Tool is discarded whenever it reduced the damage.
    statics: [{ effect: { k: 'damageIn', amount: -60, fromOpp: true, attacker: { type: 'Dragon' } }, scope: 'self' }],
    triggers: [{ on: 'damageReduced', program: [{ op: 'custom', fn: 'discardThisCard' }] }],
  },
  {
    id: 'sv10-065',
    name: 'Cetitan ex',
    abilities: [
      {
        // "Whenever your opponent plays an Item or Supporter card from their hand, prevent all effects of that card done to this Pokémon."
        // Ruling (TPCi Rules Team 2025-05-29, https://compendium.pokegym.net/ruling/2154/): "If your opponent's chosen Benched Pokemon is Cetitan ex, then Team Rocket's Giovanni's effect will be blocked. But choosing a Benched Pokemon without "Snow Camouflage" will cause it to switch with the Active Cetitan ex because the Benched Pokemon is the target of Team Rocket's Giovanni. You will still switch your Team Rocket Pokemon either way."
        name: 'Snow Camouflage',
        statics: [{ effect: { k: 'preventTrainerEffects', from: ['item', 'supporter'] }, scope: 'self' }],
      },
    ],
    notes:
      'Ruling 2154, second half: with Cetitan ex ACTIVE and the chooser picking a Benched Pokémon without Snow Camouflage, the switch should happen (the Benched ' +
      'Pokémon is the target). The engine\'s switch step (interp.ts switchStep) blocks any Supporter switch whose Active Pokémon is protected, so it does not; ' +
      'that needs an engine change (check only the incoming Pokémon for a Supporter that picks it), and is not pinned.',
    attacks: {
      // "You may discard a Stadium in play. If you do, this attack does 140 more damage."
      'Crushing Press': {
        pre: MAY_DISCARD,
        damage: { add: [140, { mul: [140, DISCARDED] }] },
      },
    },
  },
];
