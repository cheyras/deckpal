/**
 * POST /decks/simulate's pure half (deck/simulate.ts): request parsing, deck
 * references resolved against the caller's own decks, default opponents, and
 * the shared time budget. No database: the route's reads are the only DB work.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { META_POOL, metaLabel, type CardFrame, type DeckInput } from '@deckpal/sim';
import { ApiError } from '../../http.js';
import {
  SIM_DECK_MAX, SIM_DECK_MIN, SIM_GAMES_DEFAULT, SIM_NOTES_LIMIT, SIM_OPPONENTS_DEFAULT, SIM_RUN_GATE, SIM_TEXT_LIMIT,
  assertDeckSize, buildDeckInput, busyMessage, cardTotal, clampNotes, createRunGate, deckNotes, deckSizeOk,
  metaCounts, metaFallback, metaNote, playableMeta, parseSimulateBody, pickOpponents, pickOpponentsWithMeta, pilotFactory, resolveDeckRef, runComparison, runMatchups, type OwnedDeck,
} from '../simulate.js';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DECKS: OwnedDeck[] = [
  { id: ID(1), name: "Hide 'n' Sneak (Dhelmise)" },
  { id: ID(2), name: 'Toolbox Slowking' },
  { id: ID(3), name: 'Dragapult ex' },
  { id: ID(4), name: 'Dragapult ex / Dusknoir' },
  { id: ID(5), name: 'Gengar ex' },
  { id: ID(6), name: 'Mega Lucario ex' },
  { id: ID(7), name: 'Genesect ex' },
  { id: ID(8), name: 'Phantom Puppeteer' },
];

function rejects(fn: () => unknown, re: RegExp): void {
  assert.throws(fn, (err: unknown) => err instanceof ApiError && err.status === 400 && re.test(err.message));
}

test('parseSimulateBody: defaults, one subject, bounds', () => {
  const p = parseSimulateBody({ deck_id: 'Toolbox Slowking' });
  assert.deepEqual(p, { deckRef: 'Toolbox Slowking', adHoc: false, name: 'Your list', opponents: null, games: SIM_GAMES_DEFAULT, seed: 1, speed: 'strong', compare: null, continueToken: null });
  assert.equal(parseSimulateBody({ deck_id: 'x', speed: 'fast' }).speed, 'fast');
  assert.throws(() => parseSimulateBody({ deck_id: 'x', speed: 'turbo' }), /speed/);
  assert.equal(parseSimulateBody({ cards: [{ name: 'Pikachu', quantity: 4 }], games: 200, seed: 0 }).adHoc, true);
  rejects(() => parseSimulateBody({}), /exactly one of deck_id, cards or ptcgl_text/);
  rejects(() => parseSimulateBody({ deck_id: 'x', cards: [] }), /exactly one/);
  rejects(() => parseSimulateBody({ deck_id: 'x', games: 201 }), /games must be an integer 2\.\.200/);
  rejects(() => parseSimulateBody({ deck_id: 'x', games: 1.5 }), /games/);
  rejects(() => parseSimulateBody({ deck_id: 'x', seed: -1 }), /seed/);
  rejects(() => parseSimulateBody({ deck_id: 'x', opponents: [] }), /opponents/);
  rejects(() => parseSimulateBody({ deck_id: 'x', opponents: Array(9).fill('a') }), /at most 8 opponents/);
});

test('parseSimulateBody: compare_with / compare_cards / compare_ptcgl_text make a paired comparison', () => {
  assert.deepEqual(parseSimulateBody({ deck_id: 'v4', compare_with: ' v5 ' }).compare, { deckRef: 'v5', adHoc: null, name: 'Version B' });
  const cards = [{ name: 'Gwynn', quantity: 2 }];
  assert.deepEqual(parseSimulateBody({ deck_id: 'v4', compare_cards: cards, compare_name: 'v4 with 2 Gwynn' }).compare, {
    deckRef: null, adHoc: { cards }, name: 'v4 with 2 Gwynn',
  });
  assert.deepEqual(parseSimulateBody({ cards, compare_ptcgl_text: 'Pokémon: 1' }).compare, { deckRef: null, adHoc: { ptcgl_text: 'Pokémon: 1' }, name: 'Version B' });
  rejects(() => parseSimulateBody({ deck_id: 'v4', compare_with: 'v5', compare_cards: cards }), /at most one of compare_with, compare_cards or compare_ptcgl_text/);
  rejects(() => parseSimulateBody({ deck_id: 'v4', compare_with: '' }), /compare_with must be a deck id or name/);
  rejects(() => parseSimulateBody({ deck_id: 'v4', compare_with: 7 }), /compare_with must be a deck id or name/);
  rejects(() => parseSimulateBody({ deck_id: 'v4', compare_name: 'x' }), /compare_name needs/);
  // The compare inputs never count as the subject.
  rejects(() => parseSimulateBody({ compare_cards: cards }), /exactly one of deck_id, cards or ptcgl_text/);
});

test('resolveDeckRef: id, exact name, unique fragment; ambiguity is returned, not guessed', () => {
  assert.equal(resolveDeckRef(ID(2), DECKS).name, 'Toolbox Slowking');
  assert.equal(resolveDeckRef('toolbox slowking', DECKS).id, ID(2));
  assert.equal(resolveDeckRef('hide ’n’ sneak', DECKS).id, ID(1), 'curly apostrophes fold');
  assert.equal(resolveDeckRef('Dragapult ex', DECKS).id, ID(3), 'an exact name wins over a longer one containing it');
  rejects(() => resolveDeckRef('ex', DECKS), new RegExp(`matches \\d+ decks — pass one id: .*${ID(3)}`));
  rejects(() => resolveDeckRef('Charizard', DECKS), /No deck matches 'Charizard'/);
  rejects(() => resolveDeckRef(ID(99), DECKS), /No deck with id/);
});

test('pickOpponents: named ones in order (deduplicated), else the other decks, capped', () => {
  assert.deepEqual(pickOpponents(['Gengar ex', ID(2), 'gengar ex'], DECKS, ID(1)).map((d) => d.id), [ID(5), ID(2)]);
  const def = pickOpponents(null, DECKS, ID(1));
  assert.equal(def.length, SIM_OPPONENTS_DEFAULT);
  assert.ok(!def.some((d) => d.id === ID(1)), 'never plays the subject against itself by default');
  assert.equal(def[0]!.id, ID(2), 'keeps the caller order (favourites, most recent)');
  const cmp = pickOpponents(null, DECKS, [ID(1), ID(2)]);
  assert.ok(!cmp.some((d) => d.id === ID(1) || d.id === ID(2)), 'a comparison plays neither version as a default opponent');
  assert.equal(cmp[0]!.id, ID(3));
});

function mon(id: string, name: string, hp: number, damage: string): CardFrame {
  return {
    cardId: id, name, category: 'Pokemon', hp, stage: 'Basic', suffix: null, evolvesFrom: null, trainerType: null,
    energyType: null, retreat: 1, types: ['Colorless'], effect: null, regulationMark: 'I',
    attacks: [{ name: 'Tackle', cost: 'Colorless', damage, effect: null }], abilities: [], weaknesses: [], resistances: [],
  };
}
const ENERGY: CardFrame = {
  cardId: 'e-1', name: 'Psychic Energy', category: 'Energy', hp: null, stage: null, suffix: null, evolvesFrom: null,
  trainerType: null, energyType: 'Normal', retreat: null, types: [], effect: null, regulationMark: null,
  attacks: [], abilities: [], weaknesses: [], resistances: [],
};
const deck = (name: string, m: CardFrame, n = 60): DeckInput => ({ name, cards: [{ frame: m, count: 20 }, { frame: ENERGY, count: n - 20 }] });

test('runMatchups: one report across opponents, inside the text limit, notes on top', async () => {
  const subject = deck('Pups', mon('t-1', 'Pup', 70, '30'));
  const opponents = [deck('Cats', mon('t-2', 'Cat', 60, '20')), deck('Birds', mon('t-3', 'Bird', 90, '20'), 58)];
  const notes = opponents.flatMap((o) => deckNotes(o, []));
  assert.deepEqual(notes, [
    'Cats is not a legal deck: more than 4 of a card (20 Cat) — simulated as listed.',
    'Birds has 58 cards, not 60 — simulated as listed.',
    'Birds is not a legal deck: more than 4 of a card (20 Bird) — simulated as listed.',
  ]);
  const out = await runMatchups(subject, opponents, { games: 4, seed: 3, notes, budgetMs: 60_000 });
  assert.equal(out.report.matchups.length, 2);
  assert.equal(out.report.gamesPlayed, 8);
  assert.deepEqual(out.report.notes, notes);
  assert.ok(out.text.length <= SIM_TEXT_LIMIT, `${out.text.length} chars`);
  const lines = out.text.split('\n');
  assert.match(lines[0]!, /^SIMULATED BATTLES \(not real games\) — Pups vs 2 opponents/);
  assert.ok(lines.includes('Note: Birds has 58 cards, not 60 — simulated as listed.'));
  assert.match(out.text, /Caveat: These are SIMULATED games/);
  // Same seed, same games.
  const again = await runMatchups(subject, opponents, { games: 4, seed: 3, notes, budgetMs: 60_000 });
  assert.deepEqual(again.report.matchups.map((m) => m.record), out.report.matchups.map((m) => m.record));
});

test('runMatchups: the budget is a hard deadline from the request start — even the first pair stops at it', async () => {
  let t = 0;
  const subject = deck('Pups', mon('t-1', 'Pup', 70, '30'));
  const opponents = [deck('Cats', mon('t-2', 'Cat', 60, '20')), deck('Birds', mon('t-3', 'Bird', 90, '20'))];
  // The DB reads already spent the budget: nothing is played, and the report says so.
  const spent = await runMatchups(subject, opponents, { games: 40, seed: 1, budgetMs: 10, startedAt: 0, now: () => (t += 50) });
  assert.equal(spent.report.gamesPlayed, 0);
  assert.equal(spent.report.stoppedEarly, true);
  assert.match(spent.text, /0 of 80 games played \(time budget reached/);
  assert.match(spent.text, /2\. vs Birds — 0 of 40 played/);

  // The deadline lands inside the first game: it ends as a time-out, and nothing after it starts.
  let c = 0;
  const cut = await runMatchups(subject, opponents, { games: 40, seed: 1, budgetMs: 40, startedAt: 0, now: () => ++c });
  assert.equal(cut.report.gamesPlayed, 1);
  assert.equal(cut.report.matchups[0]!.record.timeouts, 1);
  assert.equal(cut.report.matchups[1]!.played, 0);
  assert.match(cut.text, /time-out/);
});

test('deck size bounds: 40–70 cards, inclusive; the message names the deck and the count', () => {
  assert.equal(SIM_DECK_MIN, 40);
  assert.equal(SIM_DECK_MAX, 70);
  for (const ok of [40, 60, 70]) assert.doesNotThrow(() => assertDeckSize('Pups', ok));
  rejects(() => assertDeckSize('Pups', 39), /Pups has 39 cards; the simulator plays decks of 40–70 cards/);
  rejects(() => assertDeckSize('Huge', 3_600), /Huge has 3600 cards/);
  assert.equal(deckSizeOk(70), true);
  assert.equal(deckSizeOk(71), false);
  assert.equal(cardTotal([{ quantity: 4 }, { quantity: 56 }]), 60);
});

test('buildDeckInput: catalogue order, missing frames left out and noted', () => {
  const frames = new Map<number, CardFrame>([[2, mon('t-2', 'Cat', 60, '20')], [10, ENERGY]]);
  const { deck: d, notes } = buildDeckInput('Cats', [{ card_id: '10', quantity: 40 }, { card_id: '7', quantity: 4 }, { card_id: '2', quantity: 16 }], frames);
  assert.deepEqual(d.cards.map((c) => [c.frame.name, c.count]), [['Cat', 16], ['Psychic Energy', 40]]);
  assert.deepEqual(notes, [
    'Cats has 56 cards, not 60 — simulated as listed.',
    'Cats: no card data for card 7 — left out of the simulated deck.',
    'Cats is not a legal deck: more than 4 of a card (16 Cat) — simulated as listed.',
  ]);
});

test('deckNotes: a pasted list that breaks the deck rules is flagged and still simulated (4 copies, 1 ACE SPEC, a Basic Pokémon)', () => {
  const item = (name: string): CardFrame => ({ ...ENERGY, cardId: name, name, category: 'Trainer', energyType: null, trainerType: 'Item' });
  const legal: DeckInput = { name: 'Legal', cards: [{ frame: mon('t-1', 'Pup', 70, '30'), count: 4 }, { frame: item('Prime Catcher'), count: 1 }, { frame: ENERGY, count: 55 }] };
  assert.deepEqual(deckNotes(legal, []), [], 'basic Energy is exempt from the 4-copy rule');
  const bad: DeckInput = {
    name: 'Bad',
    cards: [{ frame: mon('t-1', 'Pup', 70, '30'), count: 5 }, { frame: item('Prime Catcher'), count: 1 }, { frame: item('Master Ball'), count: 1 }, { frame: ENERGY, count: 53 }],
  };
  assert.deepEqual(deckNotes(bad, []), [
    'Bad is not a legal deck: more than 4 of a card (5 Pup) — simulated as listed.',
    'Bad is not a legal deck: 2 ACE SPEC cards, and a deck may have 1 — simulated as listed.',
  ]);
  const noBasic: DeckInput = { name: 'Empty', cards: [{ frame: ENERGY, count: 60 }] };
  assert.deepEqual(deckNotes(noBasic, []), ['Empty has no Basic Pokémon, so it cannot start a game: every game is a loss.']);
});

test('run gate: one run per account, two per instance, a 429-ready answer when full, release frees the slot', () => {
  let t = 1_000;
  const gate = createRunGate(1, 2, 27_000, () => t);
  const a = gate.tryAcquire('alice');
  assert.ok(a.ok);
  const again = gate.tryAcquire('alice');
  assert.deepEqual(again, { ok: false, scope: 'user', retryAfterSec: 27 });
  t += 10_000;
  const b = gate.tryAcquire('bob');
  assert.ok(b.ok);
  const c = gate.tryAcquire('carol');
  assert.ok(!c.ok && c.scope === 'instance' && c.retryAfterSec === 17, JSON.stringify(c));
  assert.equal(gate.active, 2);
  if (a.ok) {
    a.release();
    a.release(); // idempotent
  }
  assert.equal(gate.active, 1);
  assert.ok(gate.tryAcquire('alice').ok, 'alice may run again once hers is done');
  assert.match(busyMessage('user', 12), /already running .* one run at a time per account\. Try again in about 12s/);
  assert.match(busyMessage('instance', 5), /busy with other runs .* about 5s/);
  assert.equal(SIM_RUN_GATE.active, 0, 'the shared gate starts empty');
  // A run long past its expected end still asks for at least a second.
  t += 1_000_000;
  const d = gate.tryAcquire('bob');
  assert.ok(!d.ok && d.retryAfterSec === 1);
});

test('notes are clamped: the text stays within the limit and keeps the caveat, however many notes', async () => {
  const subject = deck('Pups', mon('t-1', 'Pup', 70, '30'));
  const opponents = [deck('Cats', mon('t-2', 'Cat', 60, '20'))];
  const notes = Array.from({ length: 200 }, (_, i) => `Deck number ${i} has no card data for ${'card 123456, '.repeat(20)}— left out.`);
  const out = await runMatchups(subject, opponents, { games: 2, seed: 1, notes, budgetMs: 60_000, pilot: pilotFactory('fast') });
  assert.ok(out.text.length <= SIM_TEXT_LIMIT, `${out.text.length} chars`);
  assert.match(out.text, /Caveat: These are SIMULATED games/);
  assert.match(out.text, /^SIMULATED BATTLES/);
  assert.match(out.text, /Note: \+\d+ more in the structured report\./);
  assert.equal(out.report.notes.length, 200, 'the structured report keeps every note');
  const clamped = clampNotes(notes, SIM_NOTES_LIMIT);
  assert.ok(clamped.length <= SIM_NOTES_LIMIT);
  assert.equal(clampNotes(['short'], 100), 'Note: short');
  const one = clampNotes(['x'.repeat(500)], 100);
  assert.equal(one.length, 100);
  assert.ok(one.endsWith('…'));
});

test('runComparison: both versions on the same seeds, the verdict first, inside the text limit, notes kept', async () => {
  const weak = deck('Weak pups', mon('t-1', 'Pup', 70, '10'));
  const strong = deck('Strong pups', mon('t-4', 'Big Pup', 70, '70'));
  const opponents = [deck('Cats', mon('t-2', 'Cat', 70, '30'))];
  const notes = ['Strong pups: a note.'];
  const out = await runComparison(weak, strong, opponents, { games: 16, seed: 3, notes, budgetMs: 60_000, pilot: pilotFactory('fast') });
  assert.equal(out.report.kind, 'deckpal.simulation.comparison');
  assert.equal(out.report.gamesPlayed, 16, 'per version');
  assert.equal(out.report.reportB.gamesPlayed, 16);
  assert.ok(out.text.length <= SIM_TEXT_LIMIT, `${out.text.length} chars`);
  const lines = out.text.split('\n');
  assert.match(lines[0]!, /^SIMULATED BATTLES \(not real games\) — COMPARISON/);
  assert.match(lines[1]!, /^VERDICT: B is better/);
  assert.ok(lines.includes('Note: Strong pups: a note.'));
  assert.match(out.text, /Caveat: These are SIMULATED games/);
  const same = await runComparison(weak, weak, opponents, { games: 8, seed: 3, budgetMs: 60_000, pilot: pilotFactory('fast') });
  assert.equal(same.report.overall.diff, 0);
  assert.match(same.text.split('\n')[1]!, /^VERDICT: No clear difference at this n/);
});

test('runComparison: a spent budget gives both versions the same games and says so', async () => {
  let t = 0;
  const pups = deck('Pups', mon('t-1', 'Pup', 70, '30'));
  // The budget is also a hard deadline (as for runMatchups): spent before the first game, nothing is played.
  const out = await runComparison(pups, pups, [deck('Cats', mon('t-2', 'Cat', 60, '20')), deck('Birds', mon('t-3', 'Bird', 90, '20'))], {
    games: 40, seed: 1, budgetMs: 10, startedAt: 0, now: () => (t += 50), pilot: pilotFactory('fast'),
  });
  assert.equal(out.report.reportA.gamesPlayed, out.report.reportB.gamesPlayed);
  assert.equal(out.report.reportA.gamesPlayed, 0);
  assert.equal(out.report.stoppedEarly, true);
  assert.match(out.text, /0 of 80 games per version played \(time budget reached/);
  assert.match(out.text, /No clear difference/);

  // With room for a few games, both versions stop after the same seed pairs.
  let c = 0;
  const some = await runComparison(pups, pups, [deck('Cats', mon('t-2', 'Cat', 60, '20'))], {
    games: 40, seed: 1, budgetMs: 4000, startedAt: 0, now: () => ++c, pilot: pilotFactory('fast'),
  });
  assert.equal(some.report.reportA.gamesPlayed, some.report.reportB.gamesPlayed);
});

test('runComparison: oversized notes are clamped; the verdict and the caveat always fit', async () => {
  const pups = deck('Pups', mon('t-1', 'Pup', 70, '30'));
  const notes = Array.from({ length: 200 }, (_, i) => `Deck ${i} has a card with no catalogue frame: ${'x'.repeat(80)}`);
  const out = await runComparison(pups, pups, [deck('Cats', mon('t-2', 'Cat', 60, '20'))], {
    games: 4, seed: 1, notes, pilot: pilotFactory('fast'),
  });
  assert.ok(out.text.length <= SIM_TEXT_LIMIT, `comparison text is ${out.text.length} chars`);
  assert.match(out.text, /VERDICT:/);
  assert.match(out.text, /Caveat:/);
  assert.equal(out.report.notes.length, 200, 'the structured report keeps every note');
});

test('runComparison: a hard deadline inside version A\'s first game is reported as stopped early', async () => {
  const pups = deck('Pups', mon('t-1', 'Pup', 70, '30'));
  let c = 0;
  const out = await runComparison(pups, pups, [deck('Cats', mon('t-2', 'Cat', 60, '20'))], {
    games: 40, seed: 1, budgetMs: 40, startedAt: 0, now: () => ++c, pilot: pilotFactory('fast'),
  });
  assert.equal(out.report.stoppedEarly, true);
  assert.equal(out.report.reportA.stoppedEarly, true);
});

// ── the built-in meta pool as opponents ─────────────────────────────────────

test('pickOpponentsWithMeta: `meta` is the top six pool archetypes, in share order', () => {
  const got = pickOpponentsWithMeta(['meta'], DECKS, ID(1));
  assert.equal(got.length, SIM_OPPONENTS_DEFAULT);
  assert.ok(got.every((o) => o.kind === 'meta'));
  assert.deepEqual(got.map((o) => o.deck.id), META_POOL.decks.slice(0, SIM_OPPONENTS_DEFAULT).map((d) => d.id));
  // Case does not matter, and a bare `meta:` is the same as `meta`.
  assert.equal(pickOpponentsWithMeta(['META'], [], null).length, SIM_OPPONENTS_DEFAULT);
  assert.equal(pickOpponentsWithMeta(['meta:'], [], null).length, SIM_OPPONENTS_DEFAULT);
});

test('pickOpponentsWithMeta: meta:<name> is one pool deck; an unknown or ambiguous one is a 400 that lists the archetypes', () => {
  const first = META_POOL.decks[0]!;
  const one = pickOpponentsWithMeta([`meta:${first.name}`], [], null);
  assert.deepEqual(one.map((o) => [o.kind, o.deck.id]), [['meta', first.id]]);
  assert.equal(pickOpponentsWithMeta([`Meta : ${first.name.toUpperCase()}`], [], null)[0]!.deck.id, first.id);
  rejects(() => pickOpponentsWithMeta(['meta:Nonexistent Deck'], DECKS, null), new RegExp(`No meta archetype matches 'Nonexistent Deck'.*as of ${META_POOL.asOf}.*${first.name}`));
  rejects(() => pickOpponentsWithMeta(['meta:alakazam'], DECKS, null), /matches 2 meta archetypes — name one: .*Alakazam/);
});

test('pickOpponentsWithMeta: an archetype name that matches no saved deck is the pool deck; a saved deck shadows the pool', () => {
  const first = META_POOL.decks[0]!;
  const withSame: OwnedDeck[] = [...DECKS, { id: ID(20), name: first.name }];
  // A saved deck with the pool deck's own name: the saved deck, never the pool's list.
  const shadowed = pickOpponentsWithMeta([first.name], withSame, null);
  assert.deepEqual(shadowed.map((o) => [o.kind, o.deck.name]), [['saved', first.name]]);
  // …but meta: always means the pool.
  assert.equal(pickOpponentsWithMeta([`meta:${first.name}`], withSame, null)[0]!.kind, 'meta');
  // With no saved deck by that name, the archetype name finds the pool deck.
  const pool = pickOpponentsWithMeta([first.name], [{ id: ID(1), name: 'Toolbox Slowking' }], null);
  assert.deepEqual(pool.map((o) => [o.kind, o.deck.id]), [['meta', first.id]]);
  // A saved id never falls through to the pool, and a name nobody has is the usual error with the caller's decks.
  rejects(() => pickOpponentsWithMeta([ID(99)], DECKS, null), /No deck with id/);
  rejects(() => pickOpponentsWithMeta(['Nothing Like It'], DECKS, null), /No deck matches 'Nothing Like It'. Your decks:/);
});

test('pickOpponentsWithMeta: saved and pool decks mix in order, duplicates drop, and the total is capped', () => {
  const second = META_POOL.decks[1]!;
  const mixed = pickOpponentsWithMeta(['Gengar ex', `meta:${second.name}`, ID(5), `meta:${second.id}`], DECKS, ID(1));
  assert.deepEqual(mixed.map((o) => o.kind), ['saved', 'meta']);
  // `meta` is six; six plus three named is over the cap of 8.
  rejects(() => pickOpponentsWithMeta(['meta', ID(2), ID(3), ID(5)], DECKS, null), /at most 8 opponents per run/);
  assert.equal(pickOpponentsWithMeta(['meta', ID(2), ID(3)], DECKS, null).length, 8);
});

test('pickOpponentsWithMeta: with no opponents named, the caller\'s other decks; with none, the top six pool decks', () => {
  const own = pickOpponentsWithMeta(null, DECKS, ID(1));
  assert.ok(own.every((o) => o.kind === 'saved') && own.length === SIM_OPPONENTS_DEFAULT);
  assert.deepEqual(own.map((o) => o.deck.id), pickOpponents(null, DECKS, ID(1)).map((d) => d.id));
  const none = pickOpponentsWithMeta(null, [], null);
  assert.deepEqual(none.map((o) => o.deck.id), META_POOL.decks.slice(0, SIM_OPPONENTS_DEFAULT).map((d) => d.id));
  // Their only deck is the subject: still nobody to play, so the pool.
  assert.ok(pickOpponentsWithMeta(null, [DECKS[0]!], ID(1)).every((o) => o.kind === 'meta'));
});

test("metaFallback: default opponents that can't be played (a deck still being built) fall back to the pool; named ones never do", () => {
  const top = META_POOL.decks.slice(0, SIM_OPPONENTS_DEFAULT).map((d) => d.id);
  assert.deepEqual(metaFallback(false, 0).map((d) => d.id), top, 'defaults, none playable: the top pool decks');
  assert.deepEqual(metaFallback(false, 2), [], 'defaults with playable decks: no fallback');
  assert.deepEqual(metaFallback(true, 0), [], 'named opponents: the caller asked for those, so no substitute');
});

test('metaCounts: catalogue ids for the pool\'s TCGdex ids; a missing card is noted, a different card refuses the deck', () => {
  const d = META_POOL.decks[0]!;
  const catalog = new Map(d.list.map(([id], i) => [id, { id: 1000 + i, name: d.names[id]! }] as const));
  const full = metaCounts(d, catalog);
  assert.deepEqual([full.missing, full.mismatched], [[], []]);
  assert.equal(cardTotal(full.counts), 60);
  assert.equal(full.counts[0]!.card_id, '1000');
  const gone = d.list[0]![0];
  const lacking = new Map(catalog);
  lacking.delete(gone);
  assert.match(metaCounts(d, lacking).missing[0]!, new RegExp(gone));
  assert.equal(metaCounts(d, lacking).counts.length, d.list.length - 1);
  const wrong = new Map(catalog).set(gone, { id: 1, name: 'Some Other Card' });
  assert.match(metaCounts(d, wrong).mismatched[0]!, /Some Other Card, expected/);
});

test('a pool deck is a labelled opponent in the report, with the pool\'s source, date and record', async () => {
  const label = metaLabel(META_POOL.decks[0]!);
  assert.match(label, /^Meta: .+ \(Limitless online, \d{4}-\d{2}-\d{2}, \d+-\d+(-\d+)?\)$/);
  const out = await runMatchups(deck('Pups', mon('t-1', 'Pup', 70, '30')), [deck(label, mon('t-2', 'Cat', 60, '20'))], {
    games: 2, seed: 1, notes: [metaNote()], pilot: pilotFactory('fast'), budgetMs: 60_000,
  });
  assert.ok(out.text.includes(`vs ${label}`), out.text.slice(0, 200));
  assert.match(out.text, /Note: Meta opponents are one representative list per archetype from Limitless online events \(.* to .*, as of \d{4}-\d{2}-\d{2}\)/);
  assert.ok(out.text.length <= SIM_TEXT_LIMIT);
});

test('every pool deck is within the simulator\'s deck bounds (so a pool opponent is never rejected on size)', () => {
  for (const d of META_POOL.decks) assert.ok(deckSizeOk(d.list.reduce((n, [, c]) => n + c, 0)), d.name);
});

test('playableMeta: a pool list the catalogue leaves under 40 cards is skipped with a specific note; a small gap is kept and noted', () => {
  const d = META_POOL.decks[0]!;
  const full = new Map(d.list.map(([id], i) => [id, { id: 1000 + i, name: d.names[id]! }] as const));
  const ok = playableMeta('Meta: X', d, full);
  assert.ok(ok.ok && ok.notes.length === 0 && cardTotal(ok.counts) === 60);
  // Drop one line: still inside the bound, noted.
  const one = new Map(full);
  one.delete(d.list[0]![0]);
  const small = playableMeta('Meta: X', d, one);
  assert.ok(small.ok && small.notes[0]!.includes('not in the catalogue yet'));
  // A catalogue holding only a handful of the cards: skipped, not simulated.
  const few = new Map([...full].slice(0, 5));
  const bad = playableMeta('Meta: X', d, few);
  assert.ok(!bad.ok);
  assert.match(bad.note, /^Meta: X skipped — only \d+ of its cards are in the catalogue, outside the simulator's 40–70/);
  // An empty catalogue (nothing known) is the same.
  assert.ok(!playableMeta('Meta: X', d, new Map()).ok);
  // A different card under a pool id is still refused.
  const wrong = new Map(full).set(d.list[0]![0], { id: 1, name: 'Some Other Card' });
  const w = playableMeta('Meta: X', d, wrong);
  assert.ok(!w.ok && /disagrees with the pool/.test(w.note));
});
