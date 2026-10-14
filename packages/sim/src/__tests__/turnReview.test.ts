/**
 * reviewTurn (replay/turnReview.ts): the strongest simulator pilot's options on one of the reader's turns of a real game,
 * the reader's own first action ranked among them. Fixture: hns-11, an anonymised real game PlayerA won.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { def } from '../context.js';
import { reviewTurn, turnPosition } from '../replay/turnReview.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'live-logs');
const raw = readFileSync(join(dir, 'hns-11.txt'), 'utf8');
const AB: [string, string] = ['PlayerA', 'PlayerB'];

test("the reader's deck is rebuilt to the real count before the search: a single copy is played at most once (Astra, #343)", () => {
  // Turn 8: one Secret Box is in hand; the list has one, so no line may play a second.
  const listed = reviewTurn(raw, 8, { players: AB, me: 0, deckList: [{ name: 'Secret Box', count: 1 }] });
  assert.equal(listed.found, true, listed.reason ?? '');
  assert.equal(listed.deck, 'list');
  for (const o of listed.options) assert.ok(o.line.filter((l) => /Secret Box/.test(l)).length <= 1, `${o.first}: ${o.line.join(' → ')}`);
  // Without a list the deck is still cut to its real size, never the replay's reservoir.
  const estimated = reviewTurn(raw, 8, { players: AB, me: 0 });
  assert.equal(estimated.deck, 'estimate');
  for (const o of estimated.options) assert.ok(o.line.filter((l) => /Secret Box/.test(l)).length <= 4, `${o.first}`);
});

test("the rebuilt deck conserves the list: the Stadium in play counts, and listed cards the log never showed are built (Astra, #343)", () => {
  // Turn 8: the reader's Prism Tower is the Stadium in play. Rare Candy is listed but never appears in the log; Hilda
  // comes by its printing's code.
  const deckList = [
    { name: 'Prism Tower', count: 2 },
    { name: 'Secret Box', count: 1 },
    { name: 'Rare Candy', count: 2 },
    { name: 'Hilda', id: 'sv10.5w-084', count: 1 },
  ];
  const pos = turnPosition(raw, 8, { players: AB, me: 0, deckList });
  assert.ok(!('reason' in pos), 'reason' in pos ? pos.reason : '');
  const { game } = pos;
  const name = (iid: number) => def(game.ctx, iid).name;
  assert.equal(game.state.stadium && name(game.state.stadium.card), 'Prism Tower');
  const ps = game.state.p[0];
  const out = [...ps.hand, ...ps.discard, ...ps.lost, ...ps.prizes, game.state.stadium!.card];
  for (const sl of [ps.active, ...ps.bench]) if (sl) out.push(...sl.cards, ...sl.energy, ...sl.tools);
  assert.equal(ps.deck.length + out.length, 60, 'every card of the 60 is somewhere, once');
  const copies = (ids: number[], n: string) => ids.filter((i) => name(i) === n).length;
  for (const e of deckList) {
    assert.ok(copies(ps.deck, e.name) + copies(out, e.name) <= e.count, `${e.name}: ${copies(ps.deck, e.name)} in the deck, ${copies(out, e.name)} out of it, ${e.count} listed`);
  }
  assert.equal(copies(ps.deck, 'Prism Tower'), 1, 'two listed, one is the Stadium in play');
  assert.equal(copies(ps.deck, 'Rare Candy'), 2, 'a listed card the log never showed is in the deck');
  assert.equal(copies(ps.deck, 'Hilda'), 1, 'built from its printing code');
  // The review searches that deck.
  const r = reviewTurn(raw, 8, { players: AB, me: 0, deckList });
  assert.equal(r.found, true, r.reason ?? '');
  assert.equal(r.deck, 'list');
});

test("two printings of one name are two cards: the rebuild keeps each printing's count (Astra, #343)", () => {
  // Turn 1 is PlayerB's: one Riolu me01-076 (80 HP, Accelerating Stab) is already Active. The list also has two of the
  // 70-HP sv08.5-050 printing, which the log never shows.
  const deckList = [
    { name: 'Riolu', id: 'me01-076', count: 2 },
    { name: 'Riolu', id: 'sv08.5-050', count: 2 },
  ];
  const pos = turnPosition(raw, 1, { players: AB, me: 1, deckList });
  assert.ok(!('reason' in pos), 'reason' in pos ? pos.reason : '');
  const { game } = pos;
  const riolus = (ids: number[]) => ids.map((i) => def(game.ctx, i)).filter((d) => d.name === 'Riolu');
  const ps = game.state.p[1];
  const inPlay = [ps.active, ...ps.bench].flatMap((sl) => (sl ? sl.cards : []));
  assert.deepEqual(riolus(inPlay).map((d) => d.hp), [80], 'the Active Riolu is the 80-HP printing');
  const deck = riolus(ps.deck);
  assert.equal(deck.filter((d) => d.hp === 80).length, 1, 'two listed, one in play');
  assert.equal(deck.filter((d) => d.hp === 70).length, 2, 'the other printing is its own card, both copies');
});

test("entries of one reprinted text are one card with both quantities, logged or not (Astra, #343)", () => {
  // Turn 8. Rare Candy never appears in the log; Buddy-Buddy Poffin does, under both of these printings.
  const deckList = [
    { name: 'Rare Candy', id: 'me01-125', count: 2 },
    { name: 'Rare Candy', id: 'sv01-191', count: 2 },
    { name: 'Buddy-Buddy Poffin', id: 'me02.5-184', count: 2 },
    { name: 'Buddy-Buddy Poffin', id: 'sv08.5-101', count: 2 },
  ];
  const pos = turnPosition(raw, 8, { players: AB, me: 0, deckList });
  assert.ok(!('reason' in pos), 'reason' in pos ? pos.reason : '');
  const { game } = pos;
  const ps = game.state.p[0];
  const out = [...ps.hand, ...ps.discard, ...ps.lost, ...ps.prizes];
  for (const sl of [ps.active, ...ps.bench]) if (sl) out.push(...sl.cards, ...sl.energy, ...sl.tools);
  const copies = (ids: number[], n: string) => ids.filter((i) => def(game.ctx, i).name === n).length;
  assert.equal(copies(ps.deck, 'Rare Candy'), 4, 'two entries of two, never only the first');
  const poffinsOut = copies(out, 'Buddy-Buddy Poffin');
  assert.ok(poffinsOut >= 1, 'the log shows Poffin before turn 8');
  assert.equal(copies(ps.deck, 'Buddy-Buddy Poffin') + poffinsOut, 4, 'four listed, counted once across both printings');
});

test('wins are counted in the worlds that ranked the option, never the larger of two samples (Astra, #343)', () => {
  const r = reviewTurn(readFileSync(join(dir, 'hns-34.txt'), 'utf8'), 6, { players: AB, me: 0 });
  assert.equal(r.found, true, r.reason ?? '');
  for (const o of r.options) assert.ok(o.winsIn >= 0 && o.winsIn <= r.worlds, `${o.first}: ${o.winsIn}/${r.worlds}`);
});

test("turn 6: the 3-Prize Vengeful Anchor turn — the reader's line is as good as the best, and every option's line says what it takes", () => {
  const r = reviewTurn(raw, 6, { players: AB, me: 0 });
  assert.equal(r.found, true, r.reason ?? '');
  assert.ok(r.offered > 1);
  assert.ok(r.readerDid.some((a) => /Vengeful Anchor/.test(a)), r.readerDid.join(' | '));
  const mine = r.options.find((o) => o.reader)!;
  assert.ok(mine, "the reader's first action is always among the options");
  assert.ok(mine.behindBest <= 0.3, `the reader's opening (a Stadium before the attack) is not "behind": ${mine.behindBest}`);
  assert.equal(mine.prizes, 3, 'played on, it takes the 3 Prizes the reader took');
  assert.deepEqual(mine.knockOuts, ['Mega Lucario ex']);
  const best = r.options[0]!;
  assert.equal(best.rank, 1);
  assert.equal(best.behindBest, 0);
  assert.ok(best.line.length >= 1 && best.line[0] === best.first, 'a line starts with its first action');
  assert.ok(r.options.every((o, i) => i === 0 || o.behindBest >= r.options[i - 1]!.behindBest), 'best first');
  assert.ok(r.ms < 10_000, `took ${r.ms} ms`);
});

test("the same seed gives the same review (a stored game's review does not change from call to call)", () => {
  const a = reviewTurn(raw, 4, { players: AB, me: 0 });
  const b = reviewTurn(raw, 4, { players: AB, me: 0 });
  assert.deepEqual(a.options.map((o) => [o.first, o.behindBest]), b.options.map((o) => [o.first, o.behindBest]));
});

test("an opponent's turn, a missing turn and a non-log are answered with the reason, never a throw", () => {
  const theirs = reviewTurn(raw, 5, { players: AB, me: 0 });
  assert.equal(theirs.found, false);
  assert.match(theirs.reason ?? '', /opponent's/);
  const missing = reviewTurn(raw, 99, { players: AB, me: 0 });
  assert.equal(missing.found, false);
  assert.match(missing.reason ?? '', /no turn 99/);
  const junk = reviewTurn('not a log', 1, { me: 0 });
  assert.equal(junk.found, false);
});
