/**
 * DeckPal's core-rules reference: the game's rules in our own words, for `rules_lookup`.
 *
 * WHY IT EXISTS. Card text comes from the catalog (`get_card`), but the GAME's rules came from model memory, and memory
 * was wrong in measurable ways: Haiku 5.5 got the first-turn evolution rule wrong 16 times in 18 (decision 2026-10-11),
 * and in the owner's claude.ai tests (2026-10-13) models invented "a Pokémon can't attack the turn it evolves" and said
 * cutting Rare Candy slowed a Stage 1. Each entry here is checked against the battle simulator, which encodes the
 * rulebook and the official rulings with tests (packages/sim/src/__tests__/rules*.test.ts, rulings*.test.ts); the
 * `checked` field names the test that pins it. An entry no test pins says so.
 *
 * KEEP IT SHORT AND TRUE. Every word here is read by models as fact. Prefer one more entry over a longer one, and never
 * add a rule from memory: add the simulator test first, or cite the rulebook page.
 */

export interface CoreRule {
  id: string;
  title: string;
  /** Lower-case words and phrases a question about this rule is likely to contain. */
  keywords: readonly string[];
  text: string;
  /** Where the rule is pinned: a simulator test file, or the rulebook page. */
  checked: string;
}

export const CORE_RULES: readonly CoreRule[] = [
  {
    id: 'first-turn',
    title: 'The first turns',
    keywords: ['first turn', 'turn 1', 'going first', 'going second', 'supporter', 'attack', 'draw'],
    text:
      'The player who goes first cannot attack and cannot play a Supporter on their first turn. The player who goes ' +
      'second draws at the start of their first turn and may attack and play a Supporter.',
    checked: 'sim rules.test.ts (rulebook p.11-13)',
  },
  {
    id: 'evolution',
    title: 'Evolving',
    keywords: ['evolve', 'evolution', 'stage 1', 'stage 2', 'first turn', 'put into play', 'attack after evolving'],
    text:
      'Neither player can evolve a Pokémon on their own first turn, and a Pokémon cannot evolve on the turn it was put ' +
      'into play. There is NO rule against attacking with a Pokémon the turn it evolved: an evolved Pokémon can attack ' +
      'that turn. Evolving keeps damage counters, attached Energy and Tools; it removes Special Conditions and the ' +
      'effects of attacks, but not effects from Trainers or Abilities. The evolved Pokémon counts as a new Pokémon, so ' +
      'its own Ability can be used even if the Basic used one that turn; an Ability already used stays used if the ' +
      'evolution has an Ability with the same name.',
    checked: 'sim rules.test.ts (rulebook p.11-13), rules-audit.test.ts',
  },
  {
    id: 'rare-candy',
    title: 'Rare Candy',
    keywords: ['rare candy', 'skip stage 1', 'stage 2', 'candy'],
    text:
      'Rare Candy evolves a Basic Pokémon in play straight into a Stage 2 card from your hand that evolves from it, ' +
      'skipping the Stage 1. It cannot be used on your first turn or on a Basic put into play this turn. It does ' +
      'nothing for a Stage 1 line: a Basic → Stage 1 evolution never involves Rare Candy.',
    checked: 'Rare Candy card text (get_card me01-125); sim evolve.ts',
  },
  {
    id: 'turn-actions',
    title: 'What you can do each turn',
    keywords: ['energy', 'attach', 'item', 'supporter', 'stadium', 'tool', 'once per turn', 'end turn', 'ends your turn'],
    text:
      'Draw a card at the start of your turn (if you cannot, you lose). Then, in any order: attach one Energy from ' +
      'your hand (cards and Abilities can attach more); play any number of Items; play one Supporter; play one ' +
      'Stadium; attach Pokémon Tools (one per Pokémon unless a card says otherwise); retreat once; use Abilities. ' +
      'Playing a Supporter does NOT end your turn. Attacking ends your turn.',
    checked: 'sim rules.test.ts (rulebook p.9-12)',
  },
  {
    id: 'stadium',
    title: 'Stadiums',
    keywords: ['stadium', 'replace stadium', 'discard stadium', 'same name stadium'],
    text:
      'Only one Stadium is in play, shared by both players. Playing a different Stadium discards the one in play. ' +
      'You cannot play a Stadium with the same name as the one in play, whoever played it. A Stadium affects both ' +
      'players unless its text says otherwise.',
    checked: 'sim rules.test.ts',
  },
  {
    id: 'retreat',
    title: 'Retreating',
    keywords: ['retreat', 'retreat cost', 'switch', 'asleep', 'paralyzed', 'confused', 'free retreat'],
    text:
      'Once per turn you may retreat your Active Pokémon by discarding Energy from it equal to its Retreat Cost ' +
      '(counted in Energy units, so one card providing more than one Energy can pay more than one). You cannot ' +
      'retreat while it is Asleep or Paralyzed; you can while it is Confused. Switching effects from cards are not ' +
      'retreating.',
    checked: 'sim rules.test.ts, rules-gaps.test.ts (rulebook p.12)',
  },
  {
    id: 'attack-cost',
    title: 'Attack costs',
    keywords: ['attack cost', 'energy cost', 'cost more', 'cost less', 'colorless', 'can\'t attack', 'cannot attack'],
    text:
      'An attack needs Energy that covers its cost in type and amount; {C} (Colorless) is paid by any type. Effects ' +
      'can raise or lower a cost (for example a Stadium that makes the attacks of certain Pokémon cost {C} more), so ' +
      'a Pokémon can be unable to use an attack it could use before. When an attack "could not be used", check the ' +
      'Stadium, Tools and Abilities in play for a cost change before assuming a misplay.',
    checked: 'sim rulings (Compendium #2288), cards-std-c06.test.ts (Nighttime Mine)',
  },
  {
    id: 'weakness-resistance',
    title: 'Weakness and Resistance',
    keywords: ['weakness', 'resistance', 'double damage', 'x2', '×2', '-30', 'bench'],
    text:
      'Weakness (×2 in current cards) and Resistance (−30) apply only to damage done to the Active Pokémon by an ' +
      'attack, never to Benched Pokémon, and never to damage counters that are PLACED. A Pokémon\'s Weakness is not ' +
      'always the printed one: an Ability or attack can give or change it (Lillie\'s Clefairy ex\'s Fairy Zone makes ' +
      'the opponent\'s Dragon Pokémon weak to Psychic). If a game log shows Weakness the card does not print, look ' +
      'for that effect in play.',
    checked: 'sim rules.test.ts (rulebook p.14, 20); Fairy Zone card text',
  },
  {
    id: 'damage-vs-counters',
    title: 'Damage versus damage counters, and "effects"',
    keywords: ['damage counters', 'place damage', 'put damage counters', 'effect', 'effects of attacks', 'prevent damage', 'hide n sneak', 'damage is not an effect'],
    text:
      'Doing damage and placing damage counters are different. Effects that prevent or reduce "damage" do not stop ' +
      'damage counters from being placed unless their text says so. Effects that prevent "effects of attacks" stop ' +
      'damage counters placed by attacks, but not the attack\'s damage — "Damage is not an effect." So a Pokémon ' +
      'protected from effects (Hide \'n\' Sneak) still takes an attack\'s damage, but counters an attack or Ability ' +
      'would place on it (Phantom Dive\'s spread, Cursed Blast, Powerful Hand) are not placed.',
    checked: 'sim rulings-r03.test.ts (Compendium #2425, #2264); Banette card text',
  },
  {
    id: 'tera',
    title: 'Tera Pokémon',
    keywords: ['tera', 'tera pokemon', 'tera pokémon', 'bench damage', 'benched tera'],
    text:
      'A Tera Pokémon (shown as a tag by get_card and search_cards) takes no damage from attacks while it is on the ' +
      'Bench, from either player; damage counters placed by attacks still land on it. Cards that name "Tera Pokémon" ' +
      'apply to it — check the tag rather than guessing from the name.',
    checked: 'sim rules-gaps.test.ts (Tera rule)',
  },
  {
    id: 'prizes',
    title: 'Knock Outs and Prize cards',
    keywords: ['prize', 'prizes', 'knock out', 'ko', 'pokemon ex', 'mega', 'two prizes', 'three prizes'],
    text:
      'When a Pokémon is Knocked Out its opponent takes Prize cards: 1, or 2 for a Pokémon ex, or 3 for a Mega ' +
      'Evolution Pokémon ex. With fewer Prizes left than a Knock Out is worth, take what is left. The Knocked Out ' +
      'Pokémon goes to the discard pile with everything attached.',
    checked: 'sim rules.test.ts (rulebook p.14, 23, 26)',
  },
  {
    id: 'self-ko',
    title: 'Knocking out your own Pokémon',
    keywords: ['self ko', 'self-ko', 'knocks itself out', 'cursed blast', 'recoil', 'gives a prize', 'own pokemon knocked out'],
    text:
      'If your own Pokémon is Knocked Out — by its own Ability (Cursed Blast), recoil or any other effect — your ' +
      'OPPONENT takes the Prize cards for it, exactly as if they had Knocked it Out — so with the opponent on their ' +
      'last Prizes it usually hands them the game. Not always: when one effect Knocks Out Pokémon on both sides (a ' +
      'Cursed Blast that also KOs its target), every Knock Out is resolved before anyone wins. Both players take ' +
      'Prizes, the player whose turn is next first; if both take their last Prize, the player who can still promote ' +
      'a new Active Pokémon wins, and both or neither is a draw (tiebreaker game).',
    checked: 'sim rulings-r03.test.ts (Compendium #2425, #2239, #2240)',
  },
  {
    id: 'winning',
    title: 'Winning',
    keywords: ['win', 'winning', 'last prize', 'no pokemon', 'deck out', 'cannot draw', 'concede', 'sudden death'],
    text:
      'You win when you take your last Prize card, when your opponent has no Pokémon in play, or when your opponent ' +
      'cannot draw at the start of their turn. Running out of cards during a draw EFFECT does not lose; only the ' +
      'start-of-turn draw does. If both Active Pokémon are Knocked Out at once, both players take Prizes, then promote.',
    checked: 'sim rules.test.ts (rulebook p.8, 21)',
  },
  {
    id: 'special-conditions',
    title: 'Special Conditions and the Checkup',
    keywords: ['asleep', 'burned', 'confused', 'paralyzed', 'poisoned', 'special condition', 'checkup', 'between turns'],
    text:
      'Special Conditions affect only the Active Pokémon and end when it evolves or moves to the Bench. Asleep, ' +
      'Confused and Paralyzed replace each other; Poisoned and Burned stack with them. Between turns (the Pokémon ' +
      'Checkup, for both players\' Active Pokémon): Poisoned takes 1 damage counter; Burned takes 2, then flip — heads ' +
      'it recovers; Asleep flips — heads it wakes up; Paralyzed recovers after its owner\'s next turn. A Confused ' +
      'Pokémon flips when it attacks: tails puts 3 damage counters on it and the attack does nothing.',
    checked: 'sim rules.test.ts (rulebook p.15-16, 20)',
  },
  {
    id: 'setup-deck',
    title: 'Deck building and setup',
    keywords: ['60 cards', 'four copies', '4 copies', 'ace spec', 'mulligan', 'bench size', 'basic energy', 'deck rules'],
    text:
      'A deck is exactly 60 cards, with at most 4 copies of any card name (basic Energy excepted) and at most one ACE ' +
      'SPEC card. Each player draws 7 and must have a Basic Pokémon. Mulligans are compared after setup: the player ' +
      'who mulliganed fewer times may draw up to the DIFFERENCE (if both mulliganed equally, nobody draws extra). ' +
      'Each player has 6 Prize cards and a Bench of up to 5 Pokémon unless a card says otherwise.',
    checked: 'sim rules.test.ts (rulebook p.8, 18); check_deck',
  },
  {
    id: 'abilities',
    title: 'Abilities',
    keywords: ['ability', 'abilities', 'once during your turn', 'passive', 'blocked ability'],
    text:
      'An Ability works as its text says: "once during your turn" Abilities are used by choice, once per Pokémon per ' +
      'turn; others apply on their own while the Pokémon is in play. Effects can stop Abilities (some Stadiums and ' +
      'Abilities do). An Ability is not an attack, so "effects of attacks" protection does not stop it, but ' +
      'protection from "Abilities" does.',
    checked: 'sim rules-audit.test.ts; Hide \'n\' Sneak text',
  },
  {
    id: 'standard-format',
    title: 'Standard format',
    keywords: ['standard', 'legal', 'rotation', 'regulation mark', 'format'],
    text:
      'Standard uses cards with regulation marks H, I and J since the 2026-04-10 rotation. Rotation lands around ' +
      'April each year; get_card shows each printing\'s legality, which is the answer to "is this legal".',
    checked: 'catalog legality (get_card); decision 2026-04 rotation',
  },
];
