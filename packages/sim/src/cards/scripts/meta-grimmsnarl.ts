/**
 * Current-meta card scripts, lane "grimmsnarl": the cards of Grimmsnarl ex / Froslass
 * (src/__tests__/meta/grimmsnarl.ts) that no other lane scripts. Written from the
 * printed text in frames-extra/grimmsnarl.ts; quotes below are that text. One
 * scenario test per card in src/__tests__/cards-meta-grimmsnarl.test.ts.
 *
 * Froslass (sv06-053), Snorunt, Munkidori, Budew and the Trainers are scripted by
 * other lanes and resolve here by text key. Marnie's Morgrem (sv10-135) has no
 * effect text, so it needs no script.
 */
import type { CardScript, Filter } from '../../dsl.js';
import { damageOneOf, searchToHand } from './helpers.js';

const MARNIES: Filter = { cat: 'pokemon', nameIncludes: "Marnie's" };
const BASIC_D: Filter = { energyType: 'Darkness' };

export const META_GRIMMSNARL: CardScript[] = [
  // ---------------------------------------------------------------- Pokémon
  {
    id: 'sv10-134',
    name: "Marnie's Impidimp",
    attacks: {
      // "Draw a card."
      Filch: { program: [{ op: 'draw', n: 1 }] },
    },
  },
  {
    id: 'sv10-136',
    name: "Marnie's Grimmsnarl ex",
    abilities: [
      {
        name: 'Punk Up',
        triggers: [
          {
            // "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may search
            //  your deck for up to 5 Basic {D} Energy cards and attach them to your Marnie's Pokémon in any way you
            //  like. Then, shuffle your deck."
            // The search takes one card at a time (up to 5), each attached to a Marnie's Pokémon the player picks,
            // which is "in any way you like"; choosing none shuffles and stops early.
            on: 'evolveFromHand',
            optional: true,
            program: [
              {
                op: 'repeat',
                n: 5,
                body: [
                  { op: 'chooseCards', from: 'deck', filter: BASIC_D, min: 0, max: 1, as: 'e', prompt: 'Attach a Basic Darkness Energy from your deck? (choose none to stop)' },
                  {
                    op: 'if',
                    cond: { gte: [{ len: 'e' }, 1] },
                    then: [
                      { op: 'chooseSlots', from: 'myPokemon', filter: MARNIES, min: 1, max: 1, as: 't', prompt: "Attach it to which Marnie's Pokémon?" },
                      { op: 'attach', cards: 'e', to: { v: 't' } },
                    ],
                    else: [{ op: 'shuffle' }, { op: 'end' }],
                  },
                ],
              },
              { op: 'shuffle' },
            ],
          },
        ],
      },
    ],
    attacks: {
      // "This attack also does 30 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
      'Shadow Bullet': { post: damageOneOf('oppBench', 30) },
    },
  },
  {
    id: 'sv06-131',
    name: 'Tatsugiri',
    abilities: [
      {
        name: 'Attract Customers',
        activated: {
          // "Once during your turn, if this Pokémon is in the Active Spot, you may look at the top 6 cards of your
          //  deck, reveal a Supporter card you find there, and put it into your hand. Shuffle the other cards back
          //  into your deck."
          program: [{ op: 'custom', fn: 'lookAtTopTake', args: { n: 6, max: 1, filter: { ttype: 'supporter' } } }],
          activeOnly: true,
        },
      },
    ],
  },
  {
    id: 'me01-088',
    name: 'Yveltal',
    attacks: {
      // "During your opponent's next turn, the Defending Pokémon can't retreat."
      Clutch: { post: [{ op: 'effect', static: { k: 'cantRetreat' }, on: 'defender', duration: 'oppNextTurn' }] },
    },
  },

  // ---------------------------------------------------------------- Trainers
  {
    id: 'sv10-169',
    name: 'Spikemuth Gym',
    // "Once during each player's turn, that player may search their deck for a Marnie's Pokémon, reveal it, and put
    //  it into their hand. Then, that player shuffles their deck."
    stadiumAbility: { program: searchToHand(MARNIES, 1, { reveal: true }) },
  },
];
