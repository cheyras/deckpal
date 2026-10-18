/**
 * Replay of PTCG Live logs: regressions for the harness fixes found replaying real games (2026-10-18). Each log is a
 * small synthetic game in Live's own wording (PlayerA writes the log: their draws are named, PlayerB's are hidden),
 * built around one quirk the replay used to mishandle.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLiveLog } from '../replay/liveLog.js';
import { replayLog, replaySummary, type ReplayResult } from '../replay/replay.js';

const B = '   • ';
const log = (...lines: string[]): string => lines.join('\n') + '\n';
/** PlayerA goes first; `aHand` is their (listed) opening hand; PlayerB's hand is hidden. */
const setup = (aHand: string, aPlay: string[], bPlay: string[]): string[] => [
  'Setup',
  'PlayerA chose heads for the opening coin flip.',
  'PlayerA won the coin toss.',
  'PlayerA decided to go first.',
  'PlayerA drew 7 cards for the opening hand.',
  '- 7 drawn cards.',
  B + aHand,
  'PlayerB drew 7 cards for the opening hand.',
  '- 7 drawn cards.',
  ...aPlay.map((c, i) => `PlayerA played ${c} to the ${i ? 'Bench' : 'Active Spot'}.`),
  ...bPlay.map((c, i) => `PlayerB played ${c} to the ${i ? 'Bench' : 'Active Spot'}.`),
  '',
];
const turn = (who: 'A' | 'B', ...lines: string[]): string[] => [`Player${who}'s Turn`, ...lines, ''];
const FILL = '(sv1_196) Ultra Ball, (sv1_196) Ultra Ball, (sv1_196) Ultra Ball';

/** A clean replay: every action offered, no mismatch. */
function clean(text: string): ReplayResult {
  const r = replayLog(text);
  assert.equal(r.divergence, null, replaySummary(r));
  assert.deepEqual(r.mismatches, [], replaySummary(r));
  assert.ok(r.completed, replaySummary(r));
  return r;
}

test("replay: an Ability's cost from a hidden hand (Lunar Cycle's discarded Energy) is materialised", () => {
  clean(
    log(
      ...setup(`(me1_75) Solrock, (me1_74) Lunatone, ${FILL}, (sv1_196) Ultra Ball, (sv1_196) Ultra Ball`, ['(me1_75) Solrock'], ['(me1_75) Solrock', '(me1_74) Lunatone']),
      ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.', 'PlayerA ended their turn.'),
      ...turn('B', 'PlayerB drew a card.', "PlayerB's (me1_74) Lunatone used Lunar Cycle.", '- PlayerB discarded (mee_6) Basic Fighting Energy.', '- PlayerB drew 3 cards.', 'PlayerB ended their turn.'),
      ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.'),
    ),
  );
});

test("replay: an Ability that attaches from a hidden hand (Teal Dance) is materialised", () => {
  clean(
    log(
      ...setup(`(me1_75) Solrock, ${FILL}, (sv1_196) Ultra Ball, (sv1_196) Ultra Ball, (sv1_196) Ultra Ball`, ['(me1_75) Solrock'], ['(sv6_25) Teal Mask Ogerpon ex']),
      ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.', 'PlayerA ended their turn.'),
      ...turn(
        'B',
        'PlayerB drew a card.',
        "PlayerB's (sv6_25) Teal Mask Ogerpon ex used Teal Dance.",
        '- PlayerB attached (mee_1) Basic Grass Energy to (sv6_25) Teal Mask Ogerpon ex in the Active Spot.',
        '- PlayerB drew a card.',
        'PlayerB ended their turn.',
      ),
      ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.'),
    ),
  );
});

const rareCandy = (aDraw: string): string =>
  log(
    ...setup(`(me1_75) Solrock, ${FILL}, (sv1_196) Ultra Ball, (sv1_196) Ultra Ball, (sv1_196) Ultra Ball`, ['(me1_75) Solrock'], ['(sv6_128) Dreepy']),
    ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.', 'PlayerA ended their turn.'),
    ...turn('B', 'PlayerB drew a card.', 'PlayerB ended their turn.'),
    ...turn('A', `PlayerA drew ${aDraw}.`, 'PlayerA ended their turn.'),
    ...turn('B', 'PlayerB drew a card.', 'PlayerB played (me1_125) Rare Candy.', '- PlayerB evolved (sv6_128) Dreepy to (sv6_130) Dragapult ex in the Active Spot.', 'PlayerB ended their turn.'),
    ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.'),
  );

test("replay: Rare Candy's Stage 2 from a hidden hand (named only on its evolve line) is materialised", () => {
  clean(rareCandy('(sv1_196) Ultra Ball'));
});

test('replay: a printing on an evolve detail line joins the deck of the side that evolved, even when the other side shows it', () => {
  // PlayerA's own top-level draw shows (sv6_130) Dragapult ex: by code it reads as PlayerA's card.
  clean(rareCandy('(sv6_130) Dragapult ex'));
});

test("replay: Judge's two \"- PlayerB drew 4 cards.\" lines are two draws (the hidden one is the opponent's, credited to PlayerB)", () => {
  const hand = '(sv1_196) Ultra Ball, (sv1_196) Ultra Ball, (sv1_194) Switch, (me2_87) Dawn, (sv1_194) Switch, (me2_87) Dawn, (sv1_196) Ultra Ball';
  clean(
    log(
      ...setup(`(me1_75) Solrock, (sv1_196) Ultra Ball, (sv1_196) Ultra Ball, (sv1_194) Switch, (me2_87) Dawn, (sv1_194) Switch, (me2_87) Dawn`, ['(me1_75) Solrock'], ['(me1_75) Solrock']),
      ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.', 'PlayerA ended their turn.'),
      ...turn(
        'B',
        'PlayerB drew a card.',
        'PlayerB played (me3_76) Judge.',
        '- PlayerB shuffled 7 cards into their deck.',
        '- PlayerB shuffled 7 cards into their deck.',
        B + hand,
        '- PlayerB drew 4 cards.',
        '- PlayerB drew 4 cards.',
        // The first card drawn is one PlayerB also shows (Solrock): the line reads as PlayerB's own draw.
        B + '(me1_75) Solrock, (me2_87) Dawn, (sv1_196) Ultra Ball, (sv1_196) Ultra Ball',
        'PlayerB ended their turn.',
      ),
      ...turn('A', 'PlayerA drew (sv1_194) Switch.'),
    ),
  );
});

test('parser: "flipped N coins, and K landed on heads." is N flips; a hidden "put a card on top" names no card; counters moved', () => {
  const p = parseLiveLog(
    log(
      ...setup(`(me1_75) Solrock, ${FILL}, (sv1_196) Ultra Ball, (sv1_196) Ultra Ball, (sv1_196) Ultra Ball`, ['(me1_75) Solrock'], ['(me1_75) Solrock']),
      ...turn(
        'A',
        'PlayerA drew (sv1_196) Ultra Ball.',
        'PlayerA flipped 3 coins, and 2 landed on heads.',
        'PlayerA flipped 4 coins, and 1 landed on tails.',
        '- PlayerA put a card on top of their deck.',
        "- PlayerA moved 2 damage counters from PlayerA's (me1_75) Solrock to PlayerA's Lunatone.",
      ),
    ),
  );
  assert.equal(p.unknown.count, 0, p.unknown.samples.join(' | '));
  const flips = p.events.filter((e) => e.t === 'coin_flip').map((e) => (e as { heads: boolean }).heads);
  assert.deepEqual([flips.length, flips.filter(Boolean).length], [7, 5]);
  const top = p.events.find((e) => e.t === 'move_cards');
  assert.deepEqual(top && { to: (top as { to: string }).to, count: (top as { count?: number }).count, card: (top as { card?: unknown }).card }, { to: 'deck_top', count: 1, card: undefined });
  const mv = p.events.find((e) => e.t === 'move_counters');
  assert.ok(mv && mv.t === 'move_counters');
  assert.deepEqual([mv.from.card.name, mv.to.card.name, mv.count], ['Solrock', 'Lunatone', 2]);
});

/**
 * Slowking's Seek Inspiration copying Kyurem's Trifrost (110 to 3 of the opponent's Pokémon): the attack line names the
 * first target (the Defending Pokémon), the damage lines the other two; the promote line after the Knock Outs answers the
 * promote, not the attack's choice.
 */
const trifrost = (kyuremLine: 'before' | 'after', bBench: string[]): string =>
  log(
    ...setup(
      `(me5_29_ph) Slowpoke, (sve_5) Basic Psychic Energy, (sve_5) Basic Psychic Energy, (sv7_58) Slowking, ${FILL}`,
      ['(me5_29_ph) Slowpoke'],
      ['(sv6_128) Dreepy', '(me1_74) Lunatone', '(me1_75) Solrock', ...bBench, '(sv6_25) Teal Mask Ogerpon ex'],
    ),
    ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.', 'PlayerA attached (sve_5) Basic Psychic Energy to (me5_29_ph) Slowpoke in the Active Spot.', 'PlayerA ended their turn.'),
    ...turn('B', 'PlayerB drew a card.', 'PlayerB ended their turn.'),
    ...turn(
      'A',
      'PlayerA drew (sv1_196) Ultra Ball.',
      'PlayerA evolved (me5_29_ph) Slowpoke to (sv7_58) Slowking in the Active Spot.',
      'PlayerA attached (sve_5) Basic Psychic Energy to (sv7_58) Slowking in the Active Spot.',
      ...(kyuremLine === 'before' ? ['PlayerA discarded (sv6-5_47) Kyurem.'] : []),
      "PlayerA's (sv7_58) Slowking used Seek Inspiration on PlayerB's (sv6_128) Dreepy for 110 damage.",
      ...(kyuremLine === 'after' ? ['- PlayerA discarded (sv6-5_47) Kyurem.'] : []),
      '- PlayerA chose Trifrost',
      "- 2 cards were discarded from PlayerA's (sv7_58) Slowking.",
      B + '(sve_5) Basic Psychic Energy, (sve_5) Basic Psychic Energy',
      "- PlayerB's (me1_74) Lunatone took 110 damage.",
      "- PlayerB's (me1_75) Solrock took 110 damage.",
      "PlayerB's (sv6_128) Dreepy was Knocked Out!",
      "PlayerB's (me1_74) Lunatone was Knocked Out!",
      "PlayerB's (me1_75) Solrock was Knocked Out!",
      'PlayerA took 3 Prize cards.',
      "(sv1_196) Ultra Ball was added to PlayerA's hand.",
      "(sv1_196) Ultra Ball was added to PlayerA's hand.",
      "(sv1_196) Ultra Ball was added to PlayerA's hand.",
      "PlayerB's (sv6_25) Teal Mask Ogerpon ex is now in the Active Spot.",
    ),
    ...turn('B', 'PlayerB drew a card.'),
  );

test("replay: a spread attack's first target is the attack line's own, and a promote line is not one of its targets", () => {
  clean(trifrost('after', []));
});

test('replay: the card an attack discards from the deck top, printed BEFORE the attack line (Seek Inspiration), is put on top first', () => {
  clean(trifrost('before', []));
});

test("replay: \"PlayerA discarded X\" leaves PlayerA's deck even when only PlayerB's lines show that printing", () => {
  clean(trifrost('after', ['(sv6-5_47) Kyurem']));
});

test('replay: "PlayerB chose Rampaging Thunder" under Night Joker picks the Benched Pokémon with that attack, then that attack', () => {
  clean(
    log(
      ...setup(`(me1_104) Mega Kangaskhan ex, ${FILL}, (sv1_196) Ultra Ball, (sv1_196) Ultra Ball, (sv1_196) Ultra Ball`, ['(me1_104) Mega Kangaskhan ex'], ['(sv9_97) N\'s Zorua', '(sv9_97) N\'s Zorua', '(me2-5_155) N\'s Zekrom']),
      ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.', 'PlayerA ended their turn.'),
      ...turn('B', 'PlayerB drew a card.', "PlayerB attached (mee_7) Basic Darkness Energy to (sv9_97) N's Zorua in the Active Spot.", 'PlayerB ended their turn.'),
      ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.', 'PlayerA ended their turn.'),
      ...turn(
        'B',
        'PlayerB drew a card.',
        "PlayerB evolved (sv9_97) N's Zorua to (sv9_98) N's Zoroark ex in the Active Spot.",
        "PlayerB attached (mee_7) Basic Darkness Energy to (sv9_98) N's Zoroark ex in the Active Spot.",
        "PlayerB's (sv9_98) N's Zoroark ex used Night Joker on PlayerA's (me1_104) Mega Kangaskhan ex for 250 damage.",
        '- PlayerB chose Rampaging Thunder',
      ),
      ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.'),
    ),
  );
});

test('replay: counters an Ability stopped ("Effects of Phantom Dive did not affect Shuppet.") go on that Pokémon, not the first offered', () => {
  // Only a counters line (or, failing that, the negation) answers where a counter goes: not the promote after the Knock Out.
  clean(
    log(
      ...setup(`(me5_39) Dhelmise, (me5_39) Dhelmise, (me5_33_ph) Shuppet, ${FILL}, (sv1_196) Ultra Ball`, ['(me5_39) Dhelmise', '(me5_39) Dhelmise', '(me5_33_ph) Shuppet'], ['(sv6_128) Dreepy']),
      ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.', 'PlayerA ended their turn.'),
      ...turn('B', 'PlayerB drew a card.', 'PlayerB attached (mee_10) Basic Fire Energy to (sv6_128) Dreepy in the Active Spot.', 'PlayerB ended their turn.'),
      ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.', 'PlayerA ended their turn.'),
      ...turn(
        'B',
        'PlayerB drew a card.',
        'PlayerB played (me1_125) Rare Candy.',
        '- PlayerB evolved (sv6_128) Dreepy to (sv6_130) Dragapult ex in the Active Spot.',
        'PlayerB attached (sve_5) Basic Psychic Energy to (sv6_130) Dragapult ex in the Active Spot.',
        "PlayerB's (sv6_130) Dragapult ex used Phantom Dive on PlayerA's (me5_39) Dhelmise for 200 damage.",
        "PlayerA's (me5_33_ph) Shuppet used Hide 'n' Sneak.",
        '- Effects of Phantom Dive did not affect (me5_33_ph) Shuppet.',
        "PlayerA's (me5_39) Dhelmise was Knocked Out!",
        'PlayerB took a Prize card.',
        "A card was added to PlayerB's hand.",
        "PlayerA's (me5_39) Dhelmise is now in the Active Spot.",
      ),
      ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.'),
    ),
  );
});

test('replay: counters on one of two same-named Pokémon are a choice the replay backtracks over when a Knock Out disagrees', () => {
  clean(
    log(
      ...setup(`(sv6-5_18) Duskull, (sv6-5_18) Duskull, (sve_5) Basic Psychic Energy, (sve_5) Basic Psychic Energy, ${FILL}`, ['(sv6-5_18) Duskull', '(sv6-5_18) Duskull'], ['(sv6_128) Dreepy', '(sv6_128) Dreepy']),
      ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.', 'PlayerA attached (sve_5) Basic Psychic Energy to (sv6-5_18) Duskull in the Active Spot.', 'PlayerA ended their turn.'),
      ...turn('B', 'PlayerB drew a card.', 'PlayerB ended their turn.'),
      ...turn(
        'A',
        'PlayerA drew (sv6-5_19) Dusclops.',
        'PlayerA evolved (sv6-5_18) Duskull to (sv6-5_19) Dusclops on the Bench.',
        'PlayerA attached (sve_5) Basic Psychic Energy to (sv6-5_18) Duskull in the Active Spot.',
        "PlayerA's (sv6-5_19) Dusclops used Cursed Blast.",
        "- PlayerA put 5 damage counters on PlayerB's (sv6_128) Dreepy.",
        "PlayerA's (sv6-5_19) Dusclops was Knocked Out!",
        "(sv6-5_18) Duskull was discarded from PlayerA's (sv6-5_19) Dusclops.",
        'PlayerB took a Prize card.',
        "A card was added to PlayerB's hand.",
        "PlayerA's (sv6-5_18) Duskull used Mumble on PlayerB's (sv6_128) Dreepy for 30 damage.",
      ),
      ...turn('B', 'PlayerB drew a card.'),
    ),
  );
});

/** PlayerA's Solrock Burned by Dangerous Laser and still Burned at each Checkup (Live prints no Burn flip). */
const burned = (attack: boolean): string => {
  const checkup = ['Pokémon Checkup', "2 damage counters were placed on PlayerA's (me1_75) Solrock for the Special Condition Burned.", ''];
  const end = (who: 'A' | 'B') => [`Player${who} ended their turn.`, '', ...checkup];
  return log(
    ...setup(`(me1_75) Solrock, ${FILL}, (sv1_196) Ultra Ball, (sv1_196) Ultra Ball, (sv1_196) Ultra Ball`, ['(me1_75) Solrock'], ['(sv6_128) Dreepy']),
    ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.', 'PlayerA ended their turn.'),
    "PlayerB's Turn",
    'PlayerB drew a card.',
    'PlayerB attached (sve_5) Basic Psychic Energy to (sv6_128) Dreepy in the Active Spot.',
    'PlayerB played (sv6-5_58) Dangerous Laser.',
    "- PlayerA's (me1_75) Solrock is now Burned.",
    "- PlayerA's (me1_75) Solrock is now Confused.",
    ...end('B'),
    "PlayerA's Turn",
    'PlayerA drew (sv1_196) Ultra Ball.',
    ...end('A'),
    "PlayerB's Turn",
    'PlayerB drew a card.',
    ...(attack ? ["PlayerB's (sv6_128) Dreepy used Petty Grudge on PlayerA's (me1_75) Solrock for 10 damage.", '', ...checkup] : end('B')),
    "PlayerA's Turn",
    'PlayerA drew (sv1_196) Ultra Ball.',
    ...end('A'),
    ...turn('B', 'PlayerB drew a card.'),
  );
};

test('replay: an unprinted Burn flip at Pokémon Checkup lands as the next Checkup shows (Burned again = tails)', () => {
  clean(burned(false));
});

test("replay: a vanilla attack is the engine's (Checkup counters after it are not applied a second time from the log)", () => {
  const r = clean(burned(true));
  assert.deepEqual(r.logDriven, [], replaySummary(r));
});

test('replay: Energy Switch moves the Energy FROM a Pokémon other than the one its attach line names', () => {
  clean(
    log(
      ...setup(`(me1_75) Solrock, ${FILL}, (sv1_196) Ultra Ball, (sv1_196) Ultra Ball, (sv1_196) Ultra Ball`, ['(me1_75) Solrock'], ['(me1_74) Lunatone', '(me1_75) Solrock']),
      ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.', 'PlayerA ended their turn.'),
      ...turn('B', 'PlayerB drew a card.', 'PlayerB attached (mee_6) Basic Fighting Energy to (me1_74) Lunatone in the Active Spot.', 'PlayerB ended their turn.'),
      ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.', 'PlayerA ended their turn.'),
      ...turn(
        'B',
        'PlayerB drew a card.',
        'PlayerB attached (mee_6) Basic Fighting Energy to (me1_75) Solrock on the Bench.',
        'PlayerB played (me1_115) Energy Switch.',
        '- PlayerB attached (mee_6) Basic Fighting Energy to (me1_74) Lunatone in the Active Spot.',
        "PlayerB's (me1_74) Lunatone used Power Gem on PlayerA's (me1_75) Solrock for 50 damage.",
      ),
      ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.'),
    ),
  );
});

test('replay: one "used Excited Turbo." over two attach lines is the Ability used twice', () => {
  clean(
    log(
      ...setup(`(me1_104) Mega Kangaskhan ex, ${FILL}, (sv1_196) Ultra Ball, (sv1_196) Ultra Ball, (sv1_196) Ultra Ball`, ['(me1_104) Mega Kangaskhan ex'], ['(me2_18) Oricorio ex', '(me2_11) Charmander']),
      ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.', 'PlayerA ended their turn.'),
      ...turn('B', 'PlayerB drew a card.', 'PlayerB attached (mee_10) Basic Fire Energy to (me2_18) Oricorio ex in the Active Spot.', 'PlayerB ended their turn.'),
      ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.', 'PlayerA ended their turn.'),
      ...turn(
        'B',
        'PlayerB drew a card.',
        'PlayerB played (me1_125) Rare Candy.',
        '- PlayerB evolved (me2_11) Charmander to (me2_13) Mega Charizard X ex on the Bench.',
        "PlayerB's (me2_18) Oricorio ex used Excited Turbo.",
        '- PlayerB attached (mee_10) Basic Fire Energy to (me2_13) Mega Charizard X ex on the Bench.',
        '- PlayerB attached (mee_10) Basic Fire Energy to (me2_13) Mega Charizard X ex on the Bench.',
        'PlayerB retreated (me2_18) Oricorio ex to the Bench.',
        "- (mee_10) Basic Fire Energy was discarded from PlayerB's (me2_18) Oricorio ex.",
        "PlayerB's (me2_13) Mega Charizard X ex is now in the Active Spot.",
        "PlayerB's (me2_13) Mega Charizard X ex used Inferno X on PlayerA's (me1_104) Mega Kangaskhan ex for 180 damage.",
        '- Damage breakdown:',
        B + '2 selected Energy: 180 damage',
        '',
        "- 2 cards were discarded from PlayerB's (me2_13) Mega Charizard X ex.",
        B + '(mee_10) Basic Fire Energy, (mee_10) Basic Fire Energy',
      ),
      ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.'),
    ),
  );
});

test('replay: a codeless name with several printings is a choice the replay backtracks over (a free retreat is Agile Charmander)', () => {
  const r = clean(
    log(
      ...setup(`(me1_75) Solrock, ${FILL}, (sv1_196) Ultra Ball, (sv1_196) Ultra Ball, (sv1_196) Ultra Ball`, ['(me1_75) Solrock'], ['Charmander', 'Oricorio ex']),
      ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.', 'PlayerA ended their turn.'),
      ...turn('B', 'PlayerB drew a card.', 'PlayerB retreated Charmander to the Bench.', "PlayerB's Oricorio ex is now in the Active Spot.", 'PlayerB ended their turn.'),
      ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.'),
    ),
  );
  assert.ok(r.ambiguousPrintings.includes('Charmander (as me02-011)'), r.ambiguousPrintings.join(', '));
});

test('replay: a hidden "put a card on top of their deck." puts back a card the log showed, keeping the hidden ones in hand', () => {
  clean(
    log(
      ...setup(`(me1_75) Solrock, ${FILL}, (sv1_196) Ultra Ball, (sv1_196) Ultra Ball, (sv1_196) Ultra Ball`, ['(me1_75) Solrock'], ['(me1_75) Solrock']),
      ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.', 'PlayerA ended their turn.'),
      ...turn(
        'B',
        'PlayerB drew a card.',
        'PlayerB played (me3_81) Poké Pad.',
        "- PlayerB drew (sv9_97) N's Zorua.",
        '- PlayerB shuffled their deck.',
        'PlayerB played (sv6-5_54) Academy at Night to the Stadium spot.',
        'PlayerB played (me1_74) Lunatone to the Bench.',
        'PlayerB played (me1_74) Lunatone to the Bench.',
        'PlayerB played (me1_75) Solrock to the Bench.',
        'PlayerB played (me1_75) Solrock to the Bench.',
        'PlayerB played (sv6-5_54) Academy at Night.',
        '- PlayerB put a card on top of their deck.',
        'PlayerB attached (mee_6) Basic Fighting Energy to (me1_75) Solrock in the Active Spot.',
        'PlayerB ended their turn.',
      ),
      ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.'),
    ),
  );
});

test("replay: \"moved 3 damage counters from P's X to P's Y\" (Adrena-Brain, Y the opponent's) answers its choices and its count", () => {
  clean(
    log(
      ...setup(`(me1_75) Solrock, (me1_74) Lunatone, (mee_6) Basic Fighting Energy, ${FILL}, (sv1_196) Ultra Ball`, ['(me1_75) Solrock', '(me1_74) Lunatone'], ['(sv6_95) Munkidori']),
      ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.', 'PlayerA attached (mee_6) Basic Fighting Energy to (me1_75) Solrock in the Active Spot.', 'PlayerA ended their turn.'),
      ...turn('B', 'PlayerB drew a card.', 'PlayerB attached (mee_7) Basic Darkness Energy to (sv6_95) Munkidori in the Active Spot.', 'PlayerB ended their turn.'),
      ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.', "PlayerA's (me1_75) Solrock used Cosmic Beam on PlayerB's (sv6_95) Munkidori for 70 damage."),
      ...turn(
        'B',
        'PlayerB drew a card.',
        "PlayerB's (sv6_95) Munkidori used Adrena-Brain.",
        "- PlayerB moved 3 damage counters from PlayerB's (sv6_95) Munkidori to PlayerB's (me1_74) Lunatone.",
        'PlayerB ended their turn.',
      ),
      ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.'),
    ),
  );
});

test("replay: Live naming the attacker for Phantom Dive's target when both sides have that Pokémon is not a counters mismatch", () => {
  clean(
    log(
      ...setup(`(me1_104) Mega Kangaskhan ex, (sv6-5_38) Fezandipiti ex, ${FILL}, (sv1_196) Ultra Ball, (sv1_196) Ultra Ball`, ['(me1_104) Mega Kangaskhan ex', '(sv6-5_38) Fezandipiti ex'], ['(sv6_128) Dreepy', '(sv6-5_38) Fezandipiti ex']),
      ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.', 'PlayerA ended their turn.'),
      ...turn('B', 'PlayerB drew a card.', 'PlayerB attached (mee_10) Basic Fire Energy to (sv6_128) Dreepy in the Active Spot.', 'PlayerB ended their turn.'),
      ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.', 'PlayerA ended their turn.'),
      ...turn(
        'B',
        'PlayerB drew a card.',
        'PlayerB played (me1_125) Rare Candy.',
        '- PlayerB evolved (sv6_128) Dreepy to (sv6_130) Dragapult ex in the Active Spot.',
        'PlayerB attached (sve_5) Basic Psychic Energy to (sv6_130) Dragapult ex in the Active Spot.',
        "PlayerB's (sv6_130) Dragapult ex used Phantom Dive on PlayerA's (me1_104) Mega Kangaskhan ex for 200 damage.",
        "- PlayerB put 6 damage counters on PlayerB's (sv6-5_38) Fezandipiti ex.",
      ),
      ...turn('A', 'PlayerA drew (sv1_196) Ultra Ball.'),
    ),
  );
});
