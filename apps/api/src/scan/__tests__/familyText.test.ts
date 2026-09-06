/**
 * Pure (no DB) tests for rung 9 — the card's own body text.
 *
 * The catalogue is ten cards in seven families, and every word of printed text
 * in it is REAL, pulled from the live TCGdex resource on 2026-09-06 and pasted
 * verbatim. That matters more here than it does for the other rungs: the whole
 * question this rung answers is "do these words separate this card from every
 * other card", and a fixture of invented text would answer it about invented
 * cards. Two of the seven families are real single-print cards, two are real
 * multi-print reprint families, and two are a real pair of DIFFERENT cards
 * whose printed text is 91% the same.
 *
 * What is being defended is the refusal. A rung that answers when it can is
 * easy; this one has to stay quiet when the evidence is a near-tie, when the
 * read is thin, when the text belongs to a card with six printings, and when
 * the table it reads has not been populated yet — and it has to stay quiet
 * WITHOUT changing what any other rung would have said.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodyTokens } from '@deckpal/db/cardText';
import { playableFingerprint, type FingerprintInput } from '../../deck/fingerprint.js';
import {
  MIN_MARGIN,
  MIN_PROBE_OVERLAP,
  MIN_SCORE,
  MIN_SHARED_TOKENS,
  WIDENED_OVERLAP_FRACTION,
  diceScore,
  planProbe,
  readTokens,
  scoreFamilies,
  type FamilyTextCard,
} from '../familyText.js';
import {
  resolveCard,
  type CatalogCard,
  type CatalogPort,
  type OcrFields,
  type PriorMatch,
} from '../resolve.js';

// ── Fixture catalogue ───────────────────────────────────────────────────────
//
// One entry per CARD (the playable thing), each listing its printings. That
// shape is the concept under test: a family is a card, a printing is a row, and
// body text can only ever reach the first of those.

interface FixtureCard {
  /** Everything `playableFingerprint` hashes. The family key is derived, never written down. */
  facts: FingerprintInput;
  /** The card's printed BODY text, verbatim, in reading order — what `cardTextLines` builds. */
  text: string[];
  /** [setId, localId, rarity] per printing. */
  printings: [setId: string, localId: string, rarity: string][];
}

const SET_OFFICIAL: Record<string, number> = {
  sv01: 198, 'sv04.5': 91, sv04: 182, sv10: 182, me01: 91,
};
const SERIES_OF: Record<string, string> = {
  sv01: 'sv', 'sv04.5': 'sv', sv04: 'sv', sv10: 'sv', me01: 'me',
};
const SET_NAME: Record<string, string> = {
  sv01: 'Scarlet & Violet', 'sv04.5': 'Paldean Fates', sv04: 'Paradox Rift',
  sv10: 'Destined Rivals', me01: 'Mega Evolution',
};

const FIXTURE: FixtureCard[] = [
  // ── one printing, and plenty to say. The confident case. ──────────────────
  {
    facts: {
      name: "Team Rocket's Nidoqueen", category: 'Pokemon', hp: 170, types: ['Darkness'],
      stage: 'Stage2', evolveFrom: "Team Rocket's Nidorina", retreat: 3,
      attacks: [
        { name: 'Love Impact', cost: 'Darkness', damage: '60+', effect: 'If a Pokémon that has "Nidoking" in its name is on your Bench, this attack does 120 more damage.' },
        { name: 'Mega Kick', cost: 'Darkness,Darkness', damage: '130' },
      ],
      weaknesses: [{ type: 'Fighting', value: '×2' }],
    },
    text: [
      "Evolves from Team Rocket's Nidorina",
      'Love Impact',
      'If a Pokémon that has "Nidoking" in its name is on your Bench, this attack does 120 more damage.',
      'Mega Kick',
    ],
    printings: [['sv10', '116', 'Double rare']],
  },
  // ── one printing, a Special Energy, and the `{C}` placeholder in the wild ─
  {
    facts: {
      name: 'Medical Energy', category: 'Energy', energyType: 'Special',
      effect: 'As long as this card is attached to a Pokémon, it provides {C} Energy.\n\nWhen you attach this card from your hand to 1 of your Pokémon, heal 30 damage from that Pokémon.',
    },
    text: [
      'As long as this card is attached to a Pokémon, it provides {C} Energy.',
      'When you attach this card from your hand to 1 of your Pokémon, heal 30 damage from that Pokémon.',
    ],
    printings: [['sv04', '182', 'Uncommon']],
  },
  // ── three printings of one card. The multi-print case. ────────────────────
  {
    facts: {
      name: 'Nest Ball', category: 'Trainer', trainerType: 'Item',
      effect: 'Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck.',
    },
    text: ['Item', 'Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck.'],
    printings: [['sv01', '181', 'Uncommon'], ['sv04.5', '084', 'Uncommon'], ['sv01', '255', 'Hyper rare']],
  },
  // ── two printings, an era apart, and the nearest rival to Nest Ball ───────
  {
    facts: {
      name: 'Ultra Ball', category: 'Trainer', trainerType: 'Item',
      effect: 'You can use this card only if you discard 2 other cards from your hand.\n\nSearch your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.',
    },
    text: [
      'Item',
      'You can use this card only if you discard 2 other cards from your hand.',
      'Search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.',
    ],
    printings: [['sv01', '196', 'Uncommon'], ['me01', '131', 'Common']],
  },
  // ── the near-twins. Two DIFFERENT cards, 10 of 11 tokens in common. ───────
  {
    facts: {
      name: 'Vitality Band', category: 'Trainer', trainerType: 'Tool',
      effect: "The attacks of the Pokémon this card is attached to do 10 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
    },
    text: [
      'Tool',
      "The attacks of the Pokémon this card is attached to do 10 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
    ],
    printings: [['sv01', '197', 'Uncommon']],
  },
  {
    facts: {
      name: 'Rock Chestplate', category: 'Trainer', trainerType: 'Tool',
      effect: "The {F} Pokémon this card is attached to takes 30 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance).",
    },
    text: [
      'Tool',
      "The {F} Pokémon this card is attached to takes 30 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance).",
    ],
    printings: [['sv01', '192', 'Uncommon']],
  },
  // ── one printing, a rule-box Pokémon with an ability ─────────────────────
  {
    facts: {
      name: 'Gardevoir ex', category: 'Pokemon', hp: 310, types: ['Psychic'], stage: 'Stage2',
      suffix: 'ex', evolveFrom: 'Kirlia', retreat: 2,
      abilities: [{ kind: 'Ability', name: 'Psychic Embrace', effect: "As often as you like during your turn, you may attach a Basic {P} Energy card from your discard pile to 1 of your {P} Pokémon. If you attached Energy to a Pokémon in this way, put 2 damage counters on that Pokémon. You can't use this Ability on a Pokémon that would be Knocked Out." }],
      attacks: [{ name: 'Miracle Force', cost: 'Psychic,Psychic,Colorless', damage: '190', effect: 'This Pokémon recovers from all Special Conditions.' }],
      weaknesses: [{ type: 'Darkness', value: '×2' }],
      resistances: [{ type: 'Fighting', value: '-30' }],
    },
    text: [
      'Evolves from Kirlia',
      'Ability',
      'Psychic Embrace',
      "As often as you like during your turn, you may attach a Basic {P} Energy card from your discard pile to 1 of your {P} Pokémon. If you attached Energy to a Pokémon in this way, put 2 damage counters on that Pokémon. You can't use this Ability on a Pokémon that would be Knocked Out.",
      'Miracle Force',
      'This Pokémon recovers from all Special Conditions.',
    ],
    printings: [['sv01', '245', 'Special illustration rare']],
  },
];

/** The catalogue, flattened — and the family key computed, never asserted by hand. */
const CARDS: FamilyTextCard[] = FIXTURE.flatMap((f) => {
  // 🔴 The real function, not a stand-in. The family definition this rung uses
  // is `card.playable_fingerprint` (migration 047), and a fixture that assigned
  // its own keys would be testing a definition nothing ships.
  const familyKey = playableFingerprint(f.facts);
  assert.ok(familyKey, `${f.facts.name} must be fingerprintable`);
  const tokens = bodyTokens(f.text);
  return f.printings.map(([setId, localId, rarity]) => ({
    cardId: `${setId}-${localId}`,
    name: f.facts.name,
    number: localId,
    numberNumeric: /^\d+$/.test(localId) ? Number.parseInt(localId, 10) : null,
    setId,
    setName: SET_NAME[setId]!,
    seriesId: SERIES_OF[setId]!,
    rarity,
    familyKey,
    tokens,
  }));
});

const textOf = (name: string): string[] => FIXTURE.find((f) => f.facts.name === name)!.text;
const bare = (c: FamilyTextCard): CatalogCard => {
  const { familyKey: _k, tokens: _t, ...rest } = c;
  return rest;
};

/** Counts what the ladder actually asked for, so "never consulted" is testable. */
interface Spy { text: number; family: number }

function makePort(opts: { text?: boolean; emptyText?: boolean } = {}): CatalogPort & { spy: Spy } {
  const spy: Spy = { text: 0, family: 0 };
  const port: CatalogPort & { spy: Spy } = {
    spy,
    async bySetAndNumber(setId, numeric) {
      return CARDS.filter((c) => c.setId === setId && c.numberNumeric === numeric).map(bare);
    },
    async byNumberAndDenominator(numeric, denominator) {
      return CARDS.filter((c) => c.numberNumeric === numeric && SET_OFFICIAL[c.setId] === denominator).map(bare);
    },
    async byNumber(numeric) {
      return CARDS.filter((c) => c.numberNumeric === numeric).map(bare);
    },
    async byIds(cardIds) {
      return CARDS.filter((c) => cardIds.includes(c.cardId)).map(bare);
    },
  };
  if (opts.text !== false) {
    port.byTextTokens = async (probe, minOverlap) => {
      spy.text++;
      if (opts.emptyText) return [];
      const want = new Set(probe);
      return CARDS.filter((c) => c.tokens.filter((t) => want.has(t)).length >= minOverlap);
    };
    port.byFamilyKey = async (key) => {
      spy.family++;
      if (opts.emptyText) return [];
      return CARDS.filter((c) => c.familyKey === key);
    };
  }
  return port;
}

const run = (fields: OcrFields, priorMatches: PriorMatch[] = [], port = makePort()) =>
  resolveCard(fields, priorMatches, port, { phashConfidentMax: 9 }).then((r) => ({ ...r, spy: port.spy }));

const ids = (matches: { cardId: string }[]): string[] => matches.map((m) => m.cardId);

// ── The folding, on real printed text ───────────────────────────────────────

test('an energy-symbol placeholder leaves no token behind', () => {
  // "it provides {C} Energy" — the card prints a coloured circle there and OCR
  // makes a bracket, a letter or nothing of it. Three readings of one glyph
  // must not become three tokens.
  const toks = bodyTokens(textOf('Medical Energy'));
  assert.ok(!toks.includes('c'));
  assert.ok(!toks.includes('f'));
  assert.ok(toks.includes('provides'));
  assert.ok(!bodyTokens(textOf('Rock Chestplate')).includes('f'));
});

test('numbers are dropped, which is what makes the near-twins near', () => {
  // Vitality Band does 10 MORE damage; Rock Chestplate takes 30 LESS. The
  // digits are the discriminator and they are the least trustworthy glyphs on
  // the card, so they go — and the two cards become nearly one bag. That cost
  // is paid deliberately here and refunded by the margin rule below.
  const toks = bodyTokens(textOf('Vitality Band'));
  assert.ok(!toks.includes('10'));
  assert.ok(!toks.includes('30'));
  assert.deepEqual(bodyTokens(['deals 90 damage']), ['damage', 'deals']);
});

test("the card's name field is never seeded into its own bag", () => {
  // The device escalates to body text only when the title could not be read, so
  // a name token seeded from the title could only ever be matched by accident.
  // (Flavour text that happens to say the name is a different thing and stays —
  // that is ink on the card.)
  assert.ok(!bodyTokens(textOf('Vitality Band')).includes('vitality'));
  assert.ok(!bodyTokens(textOf('Nest Ball')).includes('nest'));
});

test('accents and apostrophes fold the same way they do for names', () => {
  assert.ok(bodyTokens(['Pokémon Center']).includes('pokemon'));
  assert.deepEqual(bodyTokens(["the opponent’s bench"]), ['bench', 'opponents']);
});

// ── Scoring ────────────────────────────────────────────────────────────────

test('a family scores as its BEST printing, never as the union of them', () => {
  // Printings of one card share every gameplay word but may carry different
  // flavour lines. Pooling them would credit a family for text that appears on
  // no single card.
  const read = ['alpha', 'beta'];
  const pool: FamilyTextCard[] = [
    { ...CARDS[0]!, cardId: 'x-1', familyKey: 'fam', tokens: ['alpha'] },
    { ...CARDS[0]!, cardId: 'x-2', familyKey: 'fam', tokens: ['beta'] },
  ];
  const [fam] = scoreFamilies(read, pool);
  assert.equal(fam!.cards.length, 2);
  assert.equal(fam!.shared, 1);
  assert.equal(fam!.score, diceScore(read, new Set(['alpha'])).score);
});

test('two families tied on score come back in a stable order', () => {
  // Which one is "top" and which is "the rival" decides whether we answer at
  // all, so it must not depend on the row order Postgres happened to return.
  const pool: FamilyTextCard[] = [
    { ...CARDS[0]!, cardId: 'x-1', familyKey: 'bbb', tokens: ['alpha'] },
    { ...CARDS[0]!, cardId: 'x-2', familyKey: 'aaa', tokens: ['alpha'] },
  ];
  assert.deepEqual(scoreFamilies(['alpha'], pool).map((f) => f.familyKey), ['aaa', 'bbb']);
  assert.deepEqual(scoreFamilies(['alpha'], [...pool].reverse()).map((f) => f.familyKey), ['aaa', 'bbb']);
});

// ── What the index is asked for ────────────────────────────────────────────

test('a card with rare words to offer is probed on those alone', () => {
  const plan = planProbe(bodyTokens(textOf("Team Rocket's Nidoqueen")));
  assert.equal(plan.widened, false);
  assert.equal(plan.minOverlap, MIN_PROBE_OVERLAP);
  assert.ok(plan.tokens.includes('nidoking'));
  assert.ok(!plan.tokens.includes('pokemon'), 'a word on every card is not worth an index probe');
});

test('a card with none is probed on everything, and asked for proportionally more of it', () => {
  // Nest Ball's entire printed body is "Item / Search your deck for a Basic
  // Pokémon and put it onto your Bench. Then, shuffle your deck." — of which
  // exactly one word, "item", is not on half the cards in the game. Probing on
  // rare tokens alone would hand the index a one-element array and this rung
  // would be useless for the cards whose text is shortest. So the probe widens
  // — and then has to ask for more of itself, or `tokens && {pokemon, deck,
  // search, …}` at an overlap of 2 is a catalogue scan wearing an index's
  // clothing, reachable from the wire by anyone posting 24 lines of boilerplate.
  const plan = planProbe(bodyTokens(textOf('Nest Ball')));
  assert.equal(plan.widened, true);
  assert.deepEqual(
    plan.tokens.sort(),
    ['basic', 'bench', 'deck', 'item', 'pokemon', 'put', 'search', 'shuffle'],
  );
  assert.equal(plan.minOverlap, Math.ceil(WIDENED_OVERLAP_FRACTION * 8));
  assert.ok(plan.minOverlap > MIN_PROBE_OVERLAP);
});

test('the widened floor stays under what the score gate already demands', () => {
  // If the prefilter asked for more than the Dice floor implies, it would be
  // the thing deciding — and it decides with no view of the rival, which is the
  // half that makes this rung safe.
  assert.ok(WIDENED_OVERLAP_FRACTION < MIN_SCORE);
});

// ── The rung, end to end ───────────────────────────────────────────────────

test('a one-printing family read cleanly is confident, and says which rung said so', async () => {
  const r = await run({ bodyLines: textOf("Team Rocket's Nidoqueen") });
  assert.equal(r.resolvedBy, 'family-text');
  assert.equal(r.matched, true);
  assert.equal(r.confident, true);
  assert.deepEqual(ids(r.matches), ['sv10-116']);
  // Two queries, not one: the pool, then the family's complete printing list.
  assert.deepEqual(r.spy, { text: 1, family: 1 });
});

test('a family-text match carries an identity and nothing from the matcher', async () => {
  // Same shape every other rung returns. `rank()` spreads whatever it is handed
  // into the response, so a printing that arrived carrying its token bag would
  // put a card's normalised comparison text into the wire payload — a leak of
  // the one thing this layer is supposed to own.
  const r = await run({ bodyLines: textOf("Team Rocket's Nidoqueen") });
  assert.deepEqual(
    Object.keys(r.matches[0]!).sort(),
    ['cardId', 'distance', 'name', 'number', 'numberNumeric', 'rarity', 'seriesId', 'setId', 'setName'],
  );
});

test('a rule-box Pokémon resolves from its ability text alone', async () => {
  const r = await run({ bodyLines: textOf('Gardevoir ex') });
  assert.equal(r.resolvedBy, 'family-text');
  assert.equal(r.confident, true);
  assert.deepEqual(ids(r.matches), ['sv01-245']);
});

test('a multi-print family is NOT matched, and hands back every printing', async () => {
  // The house ruling. Body text says WHICH CARD and cannot say WHICH ONE OF
  // THESE, so `matched` is false while `matches` is full — that pair is what
  // the client's needs-you picker consumes, and what stops an auto-add path
  // banking a printing nobody chose.
  const r = await run({ bodyLines: textOf('Nest Ball') });
  assert.equal(r.resolvedBy, 'family-text');
  assert.equal(r.matched, false);
  assert.equal(r.confident, false);
  assert.deepEqual(ids(r.matches).sort(), ['sv01-181', 'sv01-255', 'sv04.5-084']);
});

test('the printing count comes from the family lookup, not from the pool', async () => {
  // A pool is capped and a prefilter is coarse. If "exactly one printing" were
  // answered from the pool, a family whose other printings fell outside it
  // would be reported as a certainty.
  const port = makePort();
  const truncated = port.byTextTokens!;
  port.byTextTokens = async (p, m) => (await truncated(p, m)).filter((c) => c.cardId !== 'sv01-255' && c.cardId !== 'sv04.5-084');
  const r = await resolveCard({ bodyLines: textOf('Nest Ball') }, [], port, { phashConfidentMax: 9 });
  assert.equal(r.matched, false);
  assert.deepEqual(ids(r.matches).sort(), ['sv01-181', 'sv01-255', 'sv04.5-084']);
});

test('two cards whose printed text is nearly the same are refused, not guessed at', async () => {
  // Vitality Band and Rock Chestplate: 10 shared tokens of 11, Dice 0.909, and
  // the only things separating them on the card are a number and a name — one
  // of which we dropped on purpose and the other of which is why we are down
  // here at all. The margin rule is the whole defence, and this is the case it
  // was sized against.
  const r = await run({ bodyLines: textOf('Vitality Band') });
  assert.notEqual(r.resolvedBy, 'family-text');
  assert.deepEqual(r.matches, []);
});

test('the near-twins are close enough to matter and would otherwise have won', async () => {
  // Guard on the fixture itself: if upstream ever re-words one of these two the
  // test above would start passing for the wrong reason.
  const read = bodyTokens(textOf('Vitality Band'));
  const ranked = scoreFamilies(read, CARDS);
  assert.equal(ranked[0]!.cards[0]!.name, 'Vitality Band');
  assert.equal(ranked[1]!.cards[0]!.name, 'Rock Chestplate');
  assert.ok(ranked[0]!.shared >= MIN_SHARED_TOKENS, 'the right family clears the evidence floor');
  assert.ok(ranked[0]!.score >= MIN_SCORE, 'and the score floor');
  assert.ok(ranked[0]!.score - ranked[1]!.score < MIN_MARGIN, 'and is still not decisive');
});

test('a rival family that is merely similar does not stop a decisive read', async () => {
  // Nest Ball and Ultra Ball share "item search deck pokemon put shuffle" and
  // are still 0.4 apart. The margin rule refuses ties, not neighbours.
  const read = bodyTokens(textOf('Nest Ball'));
  const ranked = scoreFamilies(read, CARDS);
  assert.equal(ranked[0]!.cards[0]!.name, 'Nest Ball');
  assert.equal(ranked[1]!.cards[0]!.name, 'Ultra Ball');
  assert.ok(ranked[0]!.score - ranked[1]!.score >= MIN_MARGIN);
});

test('lines that are not a card at all resolve to nothing', async () => {
  const r = await run({
    bodyLines: [
      'SUBTOTAL 12.99', 'VISA DEBIT ****4412', 'THANK YOU FOR SHOPPING WITH US', 'STORE 0421 LANE 3',
    ],
  });
  assert.notEqual(r.resolvedBy, 'family-text');
  assert.deepEqual(r.matches, []);
});

test('text from a different card game resolves to nothing', async () => {
  // The corpus the thresholds were sized on could not contain this case, and it
  // is the one the score floor exists for: the nearest Pokémon family to a
  // Magic card's rules text scored 0.308 against a floor of 0.40.
  const r = await run({
    bodyLines: [
      'Legendary Creature - Dragon', 'Flying, trample',
      'Whenever this creature attacks, draw a card and discard a card.',
    ],
  });
  assert.notEqual(r.resolvedBy, 'family-text');
});

test('a read too thin to clear the evidence floor never reaches the database', async () => {
  // "Discard your hand and draw 7 cards" is a real card and three tokens. It
  // cannot be identified by its text and the query is skipped rather than run
  // and thrown away.
  const r = await run({ bodyLines: ['Discard your hand and draw 7 cards.'] });
  assert.equal(r.spy.text, 0);
  assert.notEqual(r.resolvedBy, 'family-text');
});

// ── Order: body text can never override a rung above it ────────────────────

test('a name and number that resolve mean the family rung is never consulted', async () => {
  // The ordering IS the ruling: body text is the weakest identity evidence a
  // card carries, because it is the evidence every reprint shares. Here the
  // bodyLines are Nest Ball's — a three-printing family that would have come
  // back unmatched — and rung 3 answers with one printing instead.
  const r = await run({ number: '181', denominator: '198', name: 'Nest Ball', bodyLines: textOf('Nest Ball') });
  assert.equal(r.resolvedBy, 'number+denominator');
  assert.equal(r.confident, true);
  assert.deepEqual(ids(r.matches), ['sv01-181']);
  assert.equal(r.spy.text, 0, 'the text lookup must not even be attempted');
});

test('a badge and number that resolve mean the family rung is never consulted', async () => {
  const r = await run({ setCode: 'SVI', number: '197', denominator: '198', bodyLines: textOf('Vitality Band') });
  assert.equal(r.resolvedBy, 'badge+number');
  assert.equal(r.confident, true);
  assert.equal(r.spy.text, 0);
});

test('body text runs only after every rung that could name a card has declined', async () => {
  // A number that matches nothing takes rungs 1, 3, 4 and 5 out; the text rung
  // is what is left, and it answers.
  const r = await run({ number: '999', bodyLines: textOf("Team Rocket's Nidoqueen") });
  assert.equal(r.resolvedBy, 'family-text');
  assert.equal(r.confident, true);
});

test('body text still yields to the phash priors when they are confidently elsewhere', async () => {
  // Same contradiction test rungs 3-5 use: phash sure of a different card at a
  // distance inside the threshold, and never nominating ours at all. The card
  // is still returned; the certainty is not.
  const r = await run({ bodyLines: textOf("Team Rocket's Nidoqueen") }, [{ cardId: 'sv01-245', distance: 2 }]);
  assert.equal(r.resolvedBy, 'family-text');
  assert.equal(r.matched, true);
  assert.equal(r.confident, false);
});

// ── Graceful skip: production before the migration and before the sync ─────

test('a port with no text lookups behaves exactly as the ladder did before rung 9', async () => {
  // This is what a deployment that has not run migration 049 looks like from
  // here, and it must be indistinguishable from the old behaviour rather than
  // an error on an endpoint whose other eight rungs work.
  const port = makePort({ text: false });
  const priors: PriorMatch[] = [{ cardId: 'sv10-116', distance: 4 }];
  const withText = await resolveCard({ bodyLines: textOf('Nest Ball') }, priors, port, { phashConfidentMax: 9 });
  const without = await resolveCard({}, priors, port, { phashConfidentMax: 9 });
  assert.equal(withText.resolvedBy, 'prior-only');
  assert.deepEqual(withText.matches, without.matches);
  assert.equal(withText.confident, without.confident);
  assert.equal(withText.matched, without.matched);
});

test('an empty card_text table is a skip, not an empty answer', async () => {
  // The state production is in between the migration landing and the first
  // catalog sync finishing.
  const port = makePort({ emptyText: true });
  const priors: PriorMatch[] = [{ cardId: 'sv10-116', distance: 4 }];
  const r = await resolveCard({ bodyLines: textOf("Team Rocket's Nidoqueen") }, priors, port, { phashConfidentMax: 9 });
  assert.equal(port.spy.text, 1, 'it asked');
  assert.equal(port.spy.family, 0, 'and stopped when the answer was empty');
  assert.equal(r.resolvedBy, 'prior-only');
  assert.deepEqual(ids(r.matches), ['sv10-116']);
});

test('body lines with no priors and no text table is an honest empty answer', async () => {
  const r = await resolveCard({ bodyLines: textOf('Nest Ball') }, [], makePort({ emptyText: true }), {
    phashConfidentMax: 9,
  });
  assert.equal(r.matched, false);
  assert.equal(r.confident, false);
  assert.deepEqual(r.matches, []);
});

// ── Caps on user-influenced input ──────────────────────────────────────────

test('only the first 24 lines are read, and each only to 200 characters', () => {
  // The wire is capped in router.ts with a 400; these are the ladder's own
  // clamps, so the same guarantees hold however this function is called.
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i} zzzunique${i}`);
  const toks = readTokens(lines);
  assert.ok(toks.includes('zzzunique0'));
  assert.ok(toks.includes('zzzunique23'));
  assert.ok(!toks.includes('zzzunique24'), 'the 25th line is not read');

  const long = `${'padding '.repeat(40)}zzztail`;
  assert.ok(long.length > 200);
  assert.ok(!readTokens([long]).includes('zzztail'));
});

test('empty and absent bodyLines are the same non-event', async () => {
  const empty = await run({ bodyLines: [] });
  assert.equal(empty.spy.text, 0);
  assert.equal(empty.resolvedBy, 'prior-only');
  const absent = await run({});
  assert.equal(absent.spy.text, 0);
  assert.deepEqual(empty.matches, absent.matches);
});

// ── The thresholds, and where they came from ───────────────────────────────

test('the decision thresholds are the measured ones', () => {
  // Sized 2026-09-06 by sweeping an 80-cell grid over 376 real cards (all of
  // sv01 and me05) read back at four OCR degradations — 1,504 simulated reads,
  // each ranked against all 283 families in that corpus. This cell is the
  // loosest one with ZERO wrong families accepted at any noise level; the
  // neighbouring margin of 0.10 admits two, and dropping the shared-token floor
  // from 6 to 3 admits a wrong family at a margin of 0.42, which is why the
  // floor and not the margin is the load-bearing gate.
  assert.equal(MIN_SHARED_TOKENS, 6);
  assert.equal(MIN_SCORE, 0.4);
  assert.equal(MIN_MARGIN, 0.15);
});

test('dice is symmetric, and a partial read of a long card does not score 1.0', () => {
  // Containment (|A∩B|/|A|) was rejected for exactly this: it scores a perfect
  // 1.0 for a read that caught four words of a forty-word card.
  const long = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  assert.equal(diceScore(['a', 'b'], long).score, (2 * 2) / (2 + 8));
  assert.equal(diceScore([], long).score, 0);
  assert.equal(diceScore(['a'], new Set<string>()).score, 0);
});
