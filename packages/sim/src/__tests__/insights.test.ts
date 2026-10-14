/**
 * replayInsights (replay/insights.ts): the battle digest's reading of a real PTCG Live log — boards from the engine's
 * replay, attacks and moments from Live's own lines. The fixture logs are anonymised real games; the variants below edit
 * one of them to make the moments the fixtures do not contain (a self-Knock-Out, an attack that did no damage, a near miss).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assessReview, momentText, replayInsights } from '../replay/insights.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'live-logs');
// The fixtures may check out with CRLF (Windows); the variants below edit them line by line.
const log = (f: string): string => readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n');
const AB: [string, string] = ['PlayerA', 'PlayerB'];
const label = (s: 0 | 1) => (s === 0 ? 'me' : 'opp');

test('a whole game replays: a board for every turn, every attack with printed damage, what changed it and the HP it met', () => {
  const ins = replayInsights(log('hns-11.txt'), { players: AB });
  assert.deepEqual(ins.players, AB, 'side 0 is the player the caller named first');
  assert.equal(ins.replay.completed, true);
  assert.equal(ins.replay.stoppedTurn, null);
  assert.ok(ins.turns.length >= 10 && ins.turns.every((t) => t.board), 'a board as each turn began');
  const anchor = ins.attacks.find((a) => a.move === 'Vengeful Anchor')!;
  assert.equal(anchor.side, 0);
  assert.equal(anchor.printed, '30+');
  assert.equal(anchor.dealt, 340);
  assert.ok(anchor.modifiers.includes('Weakness to Psychic: 170'), anchor.modifiers.join('; '));
  assert.ok(!anchor.modifiers.some((m) => /^(Base|Total) damage/i.test(m)), 'base and total are not modifiers');
  assert.equal(anchor.hpBefore, 340, 'Mega Lucario ex had all 340 HP');
  assert.equal(anchor.knockedOut, true);
  const resisted = ins.attacks.find((a) => a.move === 'Aura Jab' && a.dealt === 100)!;
  assert.ok(resisted.modifiers.some((m) => /Resistance/.test(m)), resisted.modifiers.join('; '));
  // One line per card each side showed, from DeckPal's own card data.
  const lucario = ins.cards[1].find((c) => c.name === 'Mega Lucario ex')!;
  assert.match(lucario.line, /340 HP/);
  assert.match(lucario.line, /Aura Jab/);
  assert.equal(ins.ending?.reason, 'prizes');
  assert.equal(ins.ending?.winner, 0);
});

test("timer turns are moments: Live's \"didn't take an action in time\"", () => {
  const ins = replayInsights(log('tbs-57.txt'), { players: AB });
  const timer = ins.moments.filter((m) => m.kind === 'timer');
  assert.deepEqual(timer.map((m) => m.turn), [8, 10, 12]);
  assert.ok(timer.every((m) => m.side === 1));
  assert.match(momentText(timer[0]!, label), /^opp didn't take an action in time: the timer ended their turn 8$/);
});

test('effects that did not affect a Pokémon are one moment per effect per turn, counted', () => {
  const ins = replayInsights(log('hns-34.txt'), { players: AB });
  const t3 = ins.moments.find((m) => m.kind === 'blocked' && m.turn === 3)!;
  assert.equal(t3.text, 'Effects of Soul Destroyer did not affect Shuppet ×2, Poltchageist');
  assert.equal(ins.ending?.reason, 'no_bench');
});

test('a concession is the ending, with who conceded and when', () => {
  const ins = replayInsights(log('tbs-62.txt'), { players: AB });
  assert.deepEqual({ reason: ins.ending?.reason, winner: ins.ending?.winner, turn: ins.ending?.turn }, { reason: 'concede', winner: 0, turn: 5 });
  assert.match(momentText(ins.moments.at(-1)!, label), /^opp conceded on turn 5$/);
  // A turn-5 concession is a short game: the review is brief unless the reader wrote notes.
  assert.equal(assessReview(ins, 0, { result: 'win' }).depth, 'brief');
});

test("a Pokémon Knocked Out on its owner's own turn is a self_ko, with the Prizes it gave away", () => {
  // PlayerA's turn 6 (the one that starts "PlayerA drew"): their own Dhelmise is Knocked Out and PlayerB takes a Prize.
  const raw = log('hns-11.txt').replace(
    "PlayerA attached (sve_5) Basic Psychic Energy to (me5_33) Shuppet on the Bench.",
    "PlayerA attached (sve_5) Basic Psychic Energy to (me5_33) Shuppet on the Bench.\nPlayerA's (me5_39) Dhelmise was Knocked Out!\nPlayerB took a Prize card.",
  );
  const ins = replayInsights(raw, { players: AB });
  const self = ins.moments.find((m) => m.kind === 'self_ko')!;
  assert.ok(self, 'the self-Knock-Out is a moment');
  assert.equal(self.side, 0);
  assert.match(momentText(self, label), /^me's Dhelmise was Knocked Out on me's own turn \(its own attack or effect\); opp took 1 Prize card for it$/);
  // An opponent's attack Knocking Out PlayerA's Pokémon on PlayerB's turn is not a self_ko.
  assert.equal(ins.moments.filter((m) => m.kind === 'self_ko').length, 1);
  assert.ok(assessReview(ins, 0, {}).reasons.some((r) => /Knocked Out on your own turn/.test(r)));
});

test('an attack that prints damage and did none is no_damage (its cause not asserted); one that left its target on 30 HP or less is near_ko', () => {
  const zero = "PlayerB's (me1_77) Mega Lucario ex used Aura Jab on PlayerA’s (me5_5) Poltchageist for 0 damage.\n";
  const raw = log('hns-11.txt')
    // Turn 3: Aura Jab did nothing to Poltchageist (and so did not Knock it Out).
    .replace(
      "PlayerB's (me1_77) Mega Lucario ex used Aura Jab on PlayerA’s (me5_5) Poltchageist for 130 damage.\nPlayerA's (me5_5) Poltchageist was Knocked Out!\nPlayerB took a Prize card.\nA card was added to PlayerB's hand.\nPlayerA's (me5_5) Poltchageist is now in the Active Spot.\n",
      zero,
    );
  const ins = replayInsights(raw, { players: AB });
  const nothing = ins.moments.find((m) => m.kind === 'no_damage')!;
  assert.ok(nothing, ins.moments.map((m) => m.kind).join(','));
  assert.match(momentText(nothing, label), /^opp's Mega Lucario ex used Aura Jab \(it prints 130\) on me's Poltchageist and did no damage$/);
  // A failed coin flip explains a zero: no moment then (Astra, #342: Continuous Spin on tails).
  const tails = replayInsights(raw.replace(zero, zero + "- PlayerB flipped a coin and it landed on tails.\n"), { players: AB });
  assert.equal(tails.moments.filter((m) => m.kind === 'no_damage').length, 0);

  const near = log('hns-11.txt').replace(
    "PlayerA's (me5_39) Dhelmise used Vengeful Anchor on PlayerB’s (me1_77) Mega Lucario ex for 340 damage.",
    "PlayerA's (me5_39) Dhelmise used Vengeful Anchor on PlayerB’s (me1_77) Mega Lucario ex for 320 damage.",
  ).replace("PlayerB's (me1_77) Mega Lucario ex was Knocked Out!\n", '');
  const n = replayInsights(near, { players: AB });
  const miss = n.moments.find((m) => m.kind === 'near_ko')!;
  assert.ok(miss, n.moments.map((m) => m.kind).join(','));
  assert.match(momentText(miss, label), /left opp's Mega Lucario ex on 20 HP \(320 of the 340 it needed\)/);
});

test('review worth: close games, notes and surprises raise it; the reasons are listed', () => {
  const ins = replayInsights(log('hns-34.txt'), { players: AB });
  const a = assessReview(ins, 0, { finalPrizes: { me: 5, opponent: 6 }, leadChanged: true, result: 'loss', hasNotes: true });
  assert.equal(a.depth, 'deep');
  assert.ok(a.score >= 6 && a.score <= 10);
  for (const why of [/close/, /lead changed/, /notes/, /did not apply/]) assert.ok(a.reasons.some((r) => why.test(r)), `${why}: ${a.reasons.join(', ')}`);
});

test('boards come from the run the replay keeps, not a rejected backtracking attempt (Astra, #342)', () => {
  // hns-05 backtracks over which Shuppet a line meant; on turn 6 the Energy is on a Benched Shuppet, not the Active one.
  const ins = replayInsights(log('hns-05.txt'), { players: AB });
  const t6 = ins.turns.find((t) => t.turn === 6)!.board!;
  assert.equal(t6[0].active?.name, 'Shuppet');
  assert.deepEqual(t6[0].active?.energy, [], 'the Active Shuppet has no Energy');
  assert.ok(t6[0].bench.some((m) => m.name === 'Shuppet' && m.energy.includes('Telepathic Psychic')), 'a Benched Shuppet holds it');
});

test('the final board is after the last action: the winner has no Prizes left, the Knocked Out Pokémon is gone (Astra, #342)', () => {
  const ins = replayInsights(log('hns-11.txt'), { players: AB });
  assert.equal(ins.finalBoard![0].prizesLeft, 0, 'PlayerA took the last Prizes');
  assert.notEqual(ins.finalBoard![1].active?.name, 'Mega Lucario ex', 'the Knocked Out Mega Lucario ex is not still Active');
});

test('two printings that share a name are two cards, each with its own line (Astra, #342)', () => {
  const ins = replayInsights(log('hns-36.txt'), { players: AB });
  const riolus = [...ins.cards[0], ...ins.cards[1]].filter((c) => c.name === 'Riolu');
  assert.equal(riolus.length, 2, JSON.stringify(riolus));
  assert.notEqual(riolus[0]!.line, riolus[1]!.line, 'different HP and attacks');
});

test('an attack logged as a bare "used X." is an attack too: a copied attack and its Knock Outs, a search attack (Astra, #342)', () => {
  const ins = replayInsights(log('tbs-57.txt'), { players: AB });
  const trifrost = ins.attacks.filter((a) => a.move === 'Seek Inspiration (Trifrost)');
  assert.ok(trifrost.length >= 2, JSON.stringify(ins.attacks.map((a) => a.move)));
  assert.ok(trifrost.every((a) => a.dealt === 110 && a.target?.side === 1));
  assert.ok(trifrost.some((a) => a.knockedOut), 'Trifrost Knocked Out a Metang');
  const call = ins.attacks.find((a) => a.move === 'Call for Family')!;
  assert.ok(call, 'a damage-less attack is listed');
  assert.equal(call.target, null);
  assert.equal(call.dealt, 0);
});

test("a damage-clause attack keeps its copied name and every Pokémon it hit on detail lines (Astra, #342: turn 13's Trifrost)", () => {
  const ins = replayInsights(log('tbs-57.txt'), { players: AB });
  const t13 = ins.attacks.filter((a) => a.turn === 13);
  assert.deepEqual(
    t13.map((a) => [a.move, a.target?.name, a.dealt, a.knockedOut]),
    [
      ['Seek Inspiration (Trifrost)', 'Mega Excadrill ex', 110, true],
      ['Seek Inspiration (Trifrost)', 'Metang', 110, true],
      ['Seek Inspiration (Trifrost)', 'Genesect ex', 110, false],
    ],
  );
});

test('a codeless card is described by the printing its logged moves fit, or said to be ambiguous (Astra, #342: Metang)', () => {
  const ins = replayInsights(log('tbs-57.txt'), { players: AB });
  const metang = ins.cards[1].find((c) => c.name === 'Metang')!;
  assert.match(metang.line, /Ability Metal Maker/, 'the log shows it using Metal Maker');
  assert.doesNotMatch(metang.line, /Guard Press/, 'not the other printing');
});

test('a codeless attacker is matched against every printing of its name (Astra, #342: Tea Server)', () => {
  // The name may resolve to a printing without the attack; any printing that has it makes it an attack.
  const raw = log('hns-11.txt').replace(
    "PlayerA's (sv6-5_38) Fezandipiti ex used Flip the Script.\n",
    "PlayerA's (sv6-5_38) Fezandipiti ex used Flip the Script.\nPlayerA's Poltchageist used Tea Server.\n",
  );
  assert.notEqual(raw, log('hns-11.txt'), 'the fixture line was found');
  const ins = replayInsights(raw, { players: AB });
  assert.ok(ins.attacks.some((a) => a.attacker === 'Poltchageist' && a.move === 'Tea Server'), JSON.stringify(ins.attacks.map((a) => `${a.attacker}:${a.move}`)));
});

test("where the engine disagrees with the log, boards after that line are flagged, never presented as facts (Astra, #342)", () => {
  const ins = replayInsights(log('hns-34.txt'), { players: AB });
  assert.ok(ins.replay.mismatches.length > 0, 'the engine reports differences on this game');
  assert.ok(ins.replay.mismatches.some((m) => /draws/.test(m.what)), JSON.stringify(ins.replay.mismatches));
  // The difference is on the last turn: every turn's starting board came before it, the final board after it.
  assert.equal(ins.finalApproximate, true, "the final board (a hand of 16) is the engine's reading");
  assert.ok(ins.turns.every((t) => !t.approximate), 'boards from before the difference stay facts');
  assert.equal(ins.replay.approximateFrom, null);
  // A game the engine replays without a difference has nothing flagged.
  const clean = replayInsights(log('hns-11.txt'), { players: AB });
  assert.deepEqual(clean.replay.mismatches, []);
  assert.equal(clean.finalApproximate, false);
});

test('text that is not a log gives the empty reading, never a throw', () => {
  for (const raw of ['', 'hello', '\u0000\u0001', 'X'.repeat(10_000)]) {
    const ins = replayInsights(raw);
    assert.deepEqual(ins.attacks, []);
    assert.deepEqual(ins.moments, []);
  }
});
