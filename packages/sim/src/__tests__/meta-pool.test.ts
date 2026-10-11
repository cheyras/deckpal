/**
 * The built-in meta pool: the generated data is well formed and plays in the
 * engine, and the refresh script's mapping and selection logic (meta/select.ts)
 * does what its header says, on a small recorded fixture (no network).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { FRAMES } from '../cards/frames-all.js';
import { simulate } from '../runner.js';
import { makePilot } from '../pilot/index.js';
import { META_POOL, metaDeck, metaDeckSize, metaDecksMatching, metaLabel, topMetaDecks } from '../meta/index.js';
import {
  buildPool, fold, legalityProblem, mapCard, mapList, orderCandidates, rankArchetypes, windowEvents,
  type EventStandings, type LimitlessCard, type LimitlessList, type LimitlessStanding, type SetAliasEntry,
} from '../meta/select.js';

const DATA = new URL('../../../../apps/api/src/deck/data/', import.meta.url);
const ALIASES = (JSON.parse(readFileSync(new URL('ptcgl-set-alias.json', DATA), 'utf8')) as { aliases: Record<string, SetAliasEntry> }).aliases;
const ACE = JSON.parse(readFileSync(new URL('ace-spec.json', DATA), 'utf8')) as { sv_era_derived_from_db: string[]; bw_xy_era_vendored_uncertain: string[] };
const ACE_NAMES = new Set([...ACE.sv_era_derived_from_db, ...ACE.bw_xy_era_vendored_uncertain].map(fold));

// ── the generated pool ───────────────────────────────────────────────────────

test('the pool is dated, sourced, and has about a dozen archetypes, most played first', () => {
  assert.match(META_POOL.asOf, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(META_POOL.format, 'standard');
  assert.ok(META_POOL.source.name && META_POOL.source.url.startsWith('https://'));
  assert.ok(META_POOL.decks.length >= 8 && META_POOL.decks.length <= 16, `${META_POOL.decks.length} archetypes`);
  const players = META_POOL.decks.map((d) => d.players);
  assert.deepEqual(players, [...players].sort((a, b) => b - a), 'ordered by players');
  assert.equal(new Set(META_POOL.decks.map((d) => d.id)).size, META_POOL.decks.length, 'one list per archetype');
  for (const d of META_POOL.decks) {
    assert.ok(d.share > 0 && d.share < 1, d.name);
    assert.ok(d.from.event && /^\d{4}-\d{2}-\d{2}$/.test(d.from.date) && /^\d+-\d+(-\d+)?$/.test(d.from.record), d.name);
    assert.ok(d.from.date >= META_POOL.window.from && d.from.date <= META_POOL.window.to, `${d.name} is from inside the window`);
  }
});

test('every pool list is 60 cards, legal for Standard, and its ids are in the snapshot (or flagged)', () => {
  for (const d of META_POOL.decks) {
    assert.equal(metaDeckSize(d), 60, `${d.name} size`);
    assert.equal(legalityProblem(d.list, d.names, FRAMES, ACE_NAMES), null, d.name);
    assert.equal(new Set(d.list.map(([id]) => id)).size, d.list.length, `${d.name} has a line per id`);
    const flagged = new Set(d.unverified ?? []);
    for (const [id, n] of d.list) {
      assert.ok(Number.isInteger(n) && n >= 1 && n <= 60, `${d.name} ${id}`);
      assert.match(id, /^[a-z0-9.]+-[a-z0-9]+$/i, id);
      assert.ok(d.names[id], `${d.name}: ${id} has a name`);
      const f = FRAMES[id];
      if (f) assert.equal(fold(f.name), fold(d.names[id]!), `${d.name}: ${id} is ${f.name}, not ${d.names[id]}`);
      else assert.ok(flagged.has(id), `${d.name}: ${id} is not in the snapshot and is not flagged unverified`);
    }
    for (const id of flagged) assert.ok(d.list.some(([x]) => x === id) && !FRAMES[id], `${d.name}: flag ${id} is real`);
  }
});

test('the pool carries no player names', () => {
  const text = JSON.stringify(META_POOL);
  assert.ok(!/"(player|name_player|country|username)"/i.test(text));
  for (const d of META_POOL.decks) assert.deepEqual(Object.keys(d.from).sort(), ['date', 'event', 'placing', 'record']);
});

test('accessors: exact and unique-partial lookup, the top N, and the report label', () => {
  const first = META_POOL.decks[0]!;
  assert.equal(metaDeck(first.name), first);
  assert.equal(metaDeck(first.name.toUpperCase()), first);
  assert.equal(metaDeck(first.id), first);
  assert.equal(metaDeck('no such archetype xyz'), undefined);
  assert.deepEqual(topMetaDecks(3), META_POOL.decks.slice(0, 3));
  assert.deepEqual(topMetaDecks(0), []);
  assert.ok(topMetaDecks(99).length === META_POOL.decks.length);
  assert.equal(metaLabel(first), `Meta: ${first.name} (${META_POOL.source.name}, ${first.from.date}, ${first.from.record})`);
  // An exact name wins over longer names containing it ("Dragapult" vs "Dragapult Dusknoir").
  assert.equal(metaDecksMatching('Dragapult').length, 1);
  // An ambiguous fragment is returned as every match, never guessed.
  assert.ok(metaDecksMatching('alakazam').length >= 2);
  assert.equal(metaDeck('alakazam'), undefined);
});

test('every pool deck plays against two others in the engine without an error', () => {
  const deckInput = (d: (typeof META_POOL.decks)[number]) => ({
    name: d.name,
    cards: d.list.flatMap(([id, count]) => (FRAMES[id] ? [{ frame: FRAMES[id]!, count }] : [])),
  });
  const decks = META_POOL.decks.map(deckInput);
  for (const [i, a] of decks.entries()) {
    for (const off of [1, 2]) {
      const b = decks[(i + off) % decks.length]!;
      const out = simulate({ a, b, games: 2, seed: 7 + i, pilotFactory: (_s, seed) => makePilot('greedy', seed), maxDecisions: 3_000 });
      assert.equal(out.played, 2, `${a.name} vs ${b.name} played`);
      assert.ok(out.games.every((g) => g.reason !== 'engine error'), `${a.name} vs ${b.name}: ${out.games.map((g) => g.reason).join(', ')}`);
    }
  }
});

// ── the refresh logic, on a small recorded fixture ───────────────────────────

const codeOf = (set: string) => (Object.entries(ALIASES).find(([, a]) => a.set === set && a.kind === 'main') ?? Object.entries(ALIASES).find(([, a]) => a.set === set))?.[0];
/** A Limitless-shaped decklist from catalogue ids (the pool's own first deck, so the lines are real cards). */
function limitlessFrom(list: [string, number][]): LimitlessList {
  const out: LimitlessList = { pokemon: [], trainer: [], energy: [] };
  for (const [id, count] of list) {
    const f = FRAMES[id]!;
    const set = id.replace(/-[^-]*$/, '');
    const basic = f.category === 'Energy' && /^(basic )?w+ energy$/i.test(f.name);
    const code = basic ? 'MEE' : codeOf(set)!;
    const number = String(parseInt(id.slice(set.length + 1), 10));
    const bucket = f.category === 'Pokemon' ? out.pokemon : f.category === 'Trainer' ? out.trainer : out.energy;
    bucket.push({ count, set: code, number, name: f.name });
  }
  return out;
}
const BASE = META_POOL.decks[0]!.list.filter(([id]) => FRAMES[id]);
const standing = (deck: string, wins: number, losses: number, placing: number, decklist: LimitlessList | null = limitlessFrom(BASE)): LimitlessStanding => ({
  deck: { id: deck, name: deck.toUpperCase() }, record: { wins, losses, ties: 0 }, placing, decklist,
});
const ev = (id: string, players: number, date: string) => ({ id, name: `Event ${id}`, date, players });

test('mapCard: PTCGL code + number through the importer alias table; names are checked', () => {
  const [id] = BASE.find(([x]) => FRAMES[x]!.category === 'Pokemon')!;
  const f = FRAMES[id]!;
  const set = id.replace(/-[^-]*$/, '');
  const line: LimitlessCard = { count: 2, set: codeOf(set)!, number: String(parseInt(id.slice(set.length + 1), 10)), name: f.name };
  assert.deepEqual(mapCard(line, ALIASES, FRAMES), { ok: true, id, verified: true });
  // A number that lands on another card falls back to the one card of that name in the set.
  assert.deepEqual(mapCard({ ...line, number: '999' }, ALIASES, FRAMES), { ok: true, id, verified: true });
  // Basic Energy by name, whatever the print.
  assert.deepEqual(mapCard({ count: 4, set: 'SVE', number: '5', name: 'Psychic Energy' }, ALIASES, FRAMES), { ok: true, id: 'sve-005', verified: true });
  assert.deepEqual(mapCard({ count: 4, set: 'XXX', number: '1', name: 'Fire Energy' }, ALIASES, FRAMES), { ok: true, id: 'mee-002', verified: true });
  // A card the snapshot lacks in a known set: kept, flagged unverified.
  assert.deepEqual(mapCard({ count: 1, set: 'SCR', number: '135', name: 'Glass Trumpet' }, ALIASES, FRAMES), { ok: true, id: 'sv07-135', verified: false });
  // An unknown set code is a reason, not a guess.
  const bad = mapCard({ count: 2, set: 'ZZZ', number: '4', name: 'Mystery' }, ALIASES, FRAMES);
  assert.equal(bad.ok, false);
  assert.match((bad as { reason: string }).reason, /set code ZZZ has no mapping.*2 Mystery ZZZ 4/);
});

test('legalityProblem: size, copies, ACE SPEC, rotated cards, a Basic Pokémon', () => {
  const ok = BASE;
  const names = Object.fromEntries(ok.map(([id]) => [id, FRAMES[id]!.name]));
  assert.equal(legalityProblem(ok, names, FRAMES, ACE_NAMES), null);
  assert.match(legalityProblem(ok.slice(1), names, FRAMES, ACE_NAMES)!, /cards, not 60/);
  const nonEnergy = ok.findIndex(([id]) => FRAMES[id]!.category !== 'Energy' && ok.find(([x]) => x === id)![1] >= 1);
  const five = ok.map(([id, n], i): [string, number] => (i === nonEnergy ? [id, 5] : [id, n]));
  const diff = 5 - ok[nonEnergy]![1];
  // Keep the total at 60 by taking the difference from a basic Energy line.
  const energy = five.findIndex(([id]) => FRAMES[id]!.category === 'Energy' && /^(basic )?\w+ energy$/i.test(FRAMES[id]!.name));
  five[energy] = [five[energy]![0], five[energy]![1] - diff];
  assert.match(legalityProblem(five, names, FRAMES, ACE_NAMES)!, /5 copies of/);
  // A card whose every print is rotated (mark G).
  const legalNames = new Set(Object.values(FRAMES).filter((f) => 'HIJ'.includes((f.regulationMark ?? '-').toUpperCase())).map((f) => fold(f.name)));
  const rotated = Object.values(FRAMES).find((f) => f.regulationMark === 'G' && !legalNames.has(fold(f.name)))!;
  const withRotated = ok.map(([id, n], i): [string, number] => (i === nonEnergy ? [rotated.cardId, n] : [id, n]));
  assert.match(legalityProblem(withRotated, { ...names, [rotated.cardId]: rotated.name }, FRAMES, ACE_NAMES)!, /not Standard-legal/);
  // Two ACE SPECs.
  const aces = Object.values(FRAMES).filter((f) => ACE_NAMES.has(fold(f.name)) && 'HIJ'.includes((f.regulationMark ?? '-').toUpperCase())).slice(0, 2);
  assert.equal(aces.length, 2);
  const two = ok.map(([id, n], i): [string, number] => (i === nonEnergy ? [aces[0]!.cardId, n] : i === nonEnergy + 1 ? [aces[1]!.cardId, n] : [id, n]));
  const aceNames = { ...names, [aces[0]!.cardId]: aces[0]!.name, [aces[1]!.cardId]: aces[1]!.name };
  assert.match(legalityProblem(two, aceNames, FRAMES, ACE_NAMES) ?? '', /ACE SPEC|copies|Basic/);
});

test('windowEvents: last N days, enough players', () => {
  const now = new Date('2026-10-11T12:00:00Z');
  const got = windowEvents(
    [ev('a', 100, '2026-10-10T00:00:00Z'), ev('b', 31, '2026-10-10T00:00:00Z'), ev('c', 64, '2026-09-01T00:00:00Z'), ev('d', 32, '2026-09-21T13:00:00Z'), ev('e', 40, '2026-10-12T00:00:00Z')],
    now,
  );
  assert.deepEqual(got.map((e) => e.id), ['a', 'd']);
});

test('rankArchetypes: share of players with an archetype; orderCandidates: best record among the largest events', () => {
  const all: EventStandings[] = [
    { event: ev('big', 200, '2026-10-09T00:00:00Z'), standings: [standing('x', 8, 1, 3), standing('x', 6, 3, 40), standing('y', 7, 2, 10), standing('other', 5, 4, 20), standing('y', 5, 4, 30, null)] },
    { event: ev('mid', 80, '2026-10-05T00:00:00Z'), standings: [standing('x', 9, 0, 1), standing('z', 4, 4, 15)] },
    { event: ev('tiny1', 40, '2026-10-04T00:00:00Z'), standings: [standing('x', 8, 0, 1)] },
    { event: ev('tiny2', 36, '2026-10-03T00:00:00Z'), standings: [standing('x', 7, 1, 2)] },
  ];
  const { archetypes, totalPlayers } = rankArchetypes(all);
  assert.equal(totalPlayers, 9);
  assert.deepEqual(archetypes.map((a) => [a.id, a.players]), [['x', 5], ['y', 2], ['z', 1]], 'ranked by players; "other" is not an archetype');
  assert.ok(Math.abs(archetypes[0]!.share - 5 / 9) < 1e-9);
  assert.equal(archetypes[1]!.candidates.length, 1, 'a player with no decklist counts for share but is not a candidate');
  // The 3 largest events are big, mid, tiny1: the 8-0 in tiny1 beats 8-1 in big, and the 9-0 in mid beats both; tiny2 (7-1) is tried last.
  assert.deepEqual(orderCandidates(archetypes[0]!.candidates).map((c) => `${c.event.id}:${c.record.wins}`), ['mid:9', 'tiny1:8', 'big:8', 'big:6', 'tiny2:7']);
  assert.equal(orderCandidates([{ ...archetypes[0]!.candidates[0]!, record: { wins: 2, losses: 1, ties: 0 } }]).length, 0, 'under 6 rounds played is not a candidate');
});

test('buildPool: top archetypes in share order, each with its best usable list; failures are reported', () => {
  const unmappable: LimitlessList = { ...limitlessFrom(BASE), trainer: [{ count: 1, set: 'ZZZ', number: '1', name: 'Mystery' }] };
  const short: LimitlessList = { ...limitlessFrom(BASE), energy: limitlessFrom(BASE).energy.slice(1) };
  const all: EventStandings[] = [
    { event: ev('big', 200, '2026-10-09T00:00:00Z'), standings: [standing('x', 9, 0, 1, unmappable), standing('x', 7, 2, 9), standing('y', 8, 1, 2, short), standing('y', 7, 2, 11, short), standing('w', 7, 2, 4)] },
    { event: ev('mid', 80, '2026-10-05T00:00:00Z'), standings: [standing('x', 6, 3, 5), standing('y', 6, 3, 8, short), standing('z', 6, 3, 9, unmappable)] },
  ];
  const { pool, skipped } = buildPool({ all, aliases: ALIASES, frames: FRAMES, aceSpecNames: ACE_NAMES, now: new Date('2026-10-11T00:00:00Z'), topN: 3 });
  assert.equal(pool.asOf, '2026-10-11');
  assert.deepEqual(pool.decks.map((d) => d.id), ['x', 'w'], 'y and z have no usable list');
  const x = pool.decks[0]!;
  assert.deepEqual(x.from, { event: 'Event big', date: '2026-10-09', record: '7-2', placing: 9 }, 'the unmappable 9-0 list is passed over for the next best');
  assert.equal(metaDeckSize(x), 60);
  assert.equal(x.players, 3);
  assert.equal(pool.window.events, 2);
  assert.ok(skipped.some((s) => /^X .*9-0.*set code ZZZ has no mapping/.test(s)), skipped.join('\n'));
  assert.ok(skipped.some((s) => /^Y .*cards, not 60/.test(s)));
  assert.ok(skipped.some((s) => /ARCHETYPE SKIPPED/.test(s) && /^Y\b/.test(s)));
  assert.ok(skipped.some((s) => /^Z\b.*ARCHETYPE SKIPPED/.test(s)));
  // Re-mapping the built list round-trips.
  const again = mapList(limitlessFrom(x.list), ALIASES, FRAMES);
  assert.ok(again.ok && JSON.stringify(again.list) === JSON.stringify(x.list));
});

test('buildPool: when every list from the largest events fails, selection falls back to smaller events; the attempt allowance spans both', () => {
  const bad: LimitlessList = { ...limitlessFrom(BASE), trainer: [{ count: 1, set: 'ZZZ', number: '1', name: 'Mystery' }] };
  const all: EventStandings[] = [
    { event: ev('e1', 300, '2026-10-09T00:00:00Z'), standings: [standing('x', 9, 0, 1, bad)] },
    { event: ev('e2', 200, '2026-10-08T00:00:00Z'), standings: [standing('x', 8, 1, 2, bad)] },
    { event: ev('e3', 100, '2026-10-07T00:00:00Z'), standings: [standing('x', 8, 1, 3, bad)] },
    { event: ev('e4', 50, '2026-10-06T00:00:00Z'), standings: [standing('x', 7, 2, 4)] },
    { event: ev('e5', 40, '2026-10-05T00:00:00Z'), standings: [standing('x', 9, 0, 1)] },
  ];
  const now = new Date('2026-10-11T00:00:00Z');
  const { pool, skipped } = buildPool({ all, aliases: ALIASES, frames: FRAMES, aceSpecNames: ACE_NAMES, now });
  assert.equal(pool.decks.length, 1);
  assert.equal(pool.decks[0]!.from.event, 'Event e5', 'e1-e3 (the largest) all failed; the best of the rest (9-0 in e5) is used');
  assert.equal(skipped.filter((s) => /set code ZZZ/.test(s)).length, 3);
  // Three failures in the largest events plus the one that works are within the five attempts; with maxTries 3 the fallback is never reached.
  const capped = buildPool({ all, aliases: ALIASES, frames: FRAMES, aceSpecNames: ACE_NAMES, now, maxTries: 3 });
  assert.equal(capped.pool.decks.length, 0);
  assert.ok(capped.skipped.some((s) => /ARCHETYPE SKIPPED/.test(s)));
});
