/**
 * reviewTurn (replay/turnReview.ts): the strongest simulator pilot's options on one of the reader's turns of a real game,
 * the reader's own first action ranked among them. Fixture: hns-11, an anonymised real game PlayerA won.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { reviewTurn } from '../replay/turnReview.js';

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
