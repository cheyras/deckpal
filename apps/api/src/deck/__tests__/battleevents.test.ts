import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBattleEvents, type BattleEvent, type BattleEventType } from '../battleevents.js';
import { parseBattleLog } from '../battlelog.js';

/**
 * Event-stream emitter tests against ALL stored real logs (fixtures/battle-logs/,
 * exported from battle_log 2026-08-01 — battle-06 is a freetext note with no
 * Live log, kept deliberately as a tolerance fixture). Every expected value
 * was derived by reading the fixtures, not guessed. CI-pure: no DB.
 */

const DIR = fileURLToPath(new URL('./fixtures/battle-logs', import.meta.url));
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.txt')).sort();
const LOG = new Map(FILES.map((f) => [f, readFileSync(join(DIR, f), 'utf8')]));
const parse = (f: string) => parseBattleEvents(LOG.get(f)!);

/** Real Live logs (battle-06 is Chey's freetext note — zero parseable lines). */
const REAL = FILES.filter((f) => f !== 'battle-06.txt');

// ── Corpus-wide invariants ───────────────────────────────────────────────────

test('every stored log parses; unknown lines are exactly the human freetext', () => {
  // battle-04/05 end with a "Chey's notes: …" line; battle-06 is all freetext.
  const expectedUnknown: Record<string, number> = {
    'battle-04.txt': 1, 'battle-05.txt': 1, 'battle-06.txt': 1,
  };
  for (const f of FILES) {
    const p = parse(f);
    assert.equal(p.unknown.count, expectedUnknown[f] ?? 0, `${f} unknown count`);
    if (f === 'battle-06.txt') {
      assert.equal(p.unknown.rate, 1);
      assert.equal(p.events.length, 0);
    } else {
      assert.ok(p.unknown.rate < 0.01, `${f} unknown rate ${p.unknown.rate}`);
      assert.ok(p.events.length > 50, `${f} should emit a full stream`);
      assert.equal(p.players.length, 2, `${f} players`);
    }
  }
});

test('seq is dense and 1-based; turn is monotonic from 0 (setup) through turn headers', () => {
  for (const f of REAL) {
    const p = parse(f);
    let turn = 0;
    p.events.forEach((e, i) => {
      assert.equal(e.seq, i + 1, `${f} seq dense at ${i}`);
      assert.ok(e.turn >= turn, `${f} turn monotonic at seq ${e.seq}`);
      if (e.type === 'turn_start') {
        assert.equal(e.turn, turn + 1, `${f} turn_start increments`);
        assert.equal((e.payload as { turn: number }).turn, e.turn);
      }
      turn = e.turn;
    });
    const turnStarts = p.events.filter((e) => e.type === 'turn_start').length;
    assert.equal(p.turns, turnStarts, `${f} turns == turn_start count`);
  }
});

test('every taxonomy type is observed in the corpus (concede: synthesized — no stored concession)', () => {
  const seen = new Set<string>();
  for (const f of REAL) for (const e of parse(f).events) seen.add(e.type);
  const ALL: BattleEventType[] = [
    'coin_toss', 'go_first', 'opening_hand', 'mulligan', 'turn_start', 'draw', 'end_turn',
    'checkup', 'play_to_bench', 'play_to_active', 'play_card', 'play_stadium', 'evolve',
    'attach', 'retreat', 'promote', 'switch', 'attack', 'use_move', 'knockout', 'prize_take',
    'hand_add', 'discard', 'shuffle', 'move_cards', 'damage_counters', 'damage', 'heal',
    'condition', 'effect_negated', 'activate', 'game_end',
  ];
  for (const t of ALL) assert.ok(seen.has(t), `type '${t}' not observed`);
  // concede is exercised below with the synthesized log battlelog.test.ts also uses.
});

// ── Consistency with the shipped summary parser (backward-compat guard) ──────

test('event stream agrees with parseBattleLog on turns, prizes, KOs and result', () => {
  for (const f of REAL) {
    const raw = LOG.get(f)!;
    const summary = parseBattleLog(raw, [], 'cheyras');
    const p = parse(f);
    assert.equal(p.turns, summary.totalTurns, `${f} turns`);

    const me = summary.players.me!;
    const opp = summary.players.opponent!;
    const prizes = (who: string) =>
      p.events
        .filter((e): e is Extract<BattleEvent, { type: 'prize_take' }> => e.type === 'prize_take' && e.actor === who)
        .reduce((n, e) => n + e.payload.count, 0);
    assert.equal(prizes(me), summary.prizesTaken.me, `${f} my prizes`);
    assert.equal(prizes(opp), summary.prizesTaken.opponent, `${f} opp prizes`);

    // knockout actor = owner of the KO'd mon; byMe = opponent's mons downed.
    const kos = (owner: string) =>
      p.events
        .filter((e): e is Extract<BattleEvent, { type: 'knockout' }> => e.type === 'knockout' && e.actor === owner)
        .map((e) => e.payload.card.name);
    assert.deepEqual(kos(opp), summary.knockouts.byMe.map((n) => n.replace(/^\([^)]+\)\s*/, '')), `${f} KOs by me`);
    assert.deepEqual(kos(me), summary.knockouts.byOpponent.map((n) => n.replace(/^\([^)]+\)\s*/, '')), `${f} KOs by opp`);

    const end = p.events.find((e): e is Extract<BattleEvent, { type: 'game_end' }> => e.type === 'game_end');
    assert.ok(end, `${f} has game_end`);
    assert.equal(end!.payload.winner === me ? 'win' : 'loss', summary.result, `${f} result`);
    assert.equal(end!.seq, p.events.length, `${f} game_end is the final event`);
  }
});

// ── Setup events (real excerpt: battle-10 opening) ───────────────────────────

test('battle-10 setup: coin toss, go-first, opening hands, mulligans with reveals, bonus draw', () => {
  const p = parse('battle-10.txt');
  const [e1, e2, e3, e4, e5, e6, e7, e8] = p.events;
  assert.deepEqual(e1, { seq: 1, turn: 0, actor: 'cheyras', type: 'coin_toss', payload: { call: 'tails' } });
  assert.deepEqual(e2, { seq: 2, turn: 0, actor: 'xTheWizardx', type: 'coin_toss', payload: { won: true } });
  assert.deepEqual(e3, { seq: 3, turn: 0, actor: 'xTheWizardx', type: 'go_first', payload: { order: 'second' } });

  // Owner's opening hand is fully revealed (hidden-info boundary, Ground Truth #7)…
  assert.equal(e4!.type, 'opening_hand');
  assert.equal(e4!.actor, 'cheyras');
  const hand = (e4 as Extract<BattleEvent, { type: 'opening_hand' }>).payload;
  assert.equal(hand.count, 7);
  assert.equal(hand.cards!.length, 7);
  assert.deepEqual(hand.cards![0], { name: 'Banette', ref: 'me5_34' });
  // …the opponent's is a bare count.
  assert.equal(e5!.type, 'opening_hand');
  assert.equal(e5!.actor, 'xTheWizardx');
  assert.equal((e5 as Extract<BattleEvent, { type: 'opening_hand' }>).payload.cards, undefined);

  // Mulligans reveal the whole hand each time; reveal groups fold into the event.
  assert.equal(e6!.type, 'mulligan');
  const m1 = (e6 as Extract<BattleEvent, { type: 'mulligan' }>).payload;
  assert.equal(m1.count, 1);
  assert.equal(m1.cards!.length, 7);
  assert.equal(e7!.type, 'mulligan');
  const m5 = (e7 as Extract<BattleEvent, { type: 'mulligan' }>).payload;
  assert.equal(m5.count, 5);
  assert.equal(m5.cards!.length, 28); // reveal groups 2–5, 7 cards each
  assert.deepEqual(e8, {
    seq: 8, turn: 0, actor: 'cheyras', type: 'draw',
    payload: { count: 5, reason: 'mulligan_bonus' },
  });
});

// ── Attacks: damage, weakness/resistance modifiers, breakdown folding ────────

test('battle-12 Dusk Raid: attack with weakness modifier and folded damage breakdown', () => {
  const p = parse('battle-12.txt');
  const atk = p.events.find(
    (e): e is Extract<BattleEvent, { type: 'attack' }> =>
      e.type === 'attack' && e.payload.damage === 440,
  )!;
  assert.equal(atk.actor, 'warthog2010');
  assert.equal(atk.turn, 3);
  assert.deepEqual(atk.payload.attacker, { name: 'Mega Darkrai ex', ref: 'me5_116' });
  assert.equal(atk.payload.move, 'Dusk Raid');
  assert.deepEqual(atk.payload.target, { player: 'cheyras', card: { name: 'Dhelmise', ref: 'me5_39' } });
  assert.deepEqual(atk.payload.modifiers, [{ amount: 220, reason: 'Darkness Weakness' }]);
  assert.deepEqual(atk.payload.breakdown, [
    { label: 'Base damage', amount: 110 },
    { label: '3 damage counters', amount: 110 },
    { label: 'Weakness to Darkness', amount: 220 },
    { label: 'Total damage', amount: 440 },
  ]);
});

test('battle-08 Poison Jab: resistance modifier is negative, damage 0', () => {
  const p = parse('battle-08.txt');
  const atk = p.events.find(
    (e): e is Extract<BattleEvent, { type: 'attack' }> => e.type === 'attack' && e.payload.move === 'Poison Jab',
  )!;
  assert.equal(atk.payload.damage, 0);
  assert.deepEqual(atk.payload.modifiers, [{ amount: -10, reason: 'Fighting Resistance' }]);
  assert.deepEqual(atk.payload.breakdown?.find((b) => b.label === 'Resistance to Fighting'), {
    label: 'Resistance to Fighting', amount: -10,
  });
});

test('use_move covers both abilities and damage-less attacks (deliberately undistinguished)', () => {
  const p8 = parse('battle-08.txt');
  // Hide 'n' Sneak is an attack with no damage clause (and a curly apostrophe in the raw log)…
  const sneak = p8.events.find(
    (e): e is Extract<BattleEvent, { type: 'use_move' }> => e.type === 'use_move' && e.payload.move === "Hide 'n' Sneak",
  )!;
  assert.equal(sneak.payload.user.name, 'Shuppet');
  // …Flip the Script is an Ability. Same line shape, same event type.
  const p12 = parse('battle-12.txt');
  const flip = p12.events.find(
    (e): e is Extract<BattleEvent, { type: 'use_move' }> => e.type === 'use_move' && e.payload.move === 'Flip the Script',
  )!;
  assert.deepEqual(flip.payload.user, { name: 'Fezandipiti ex', ref: 'sv6-5_38' });
});

// ── Board movement: switch/promote/retreat, via-attribution ──────────────────

test("battle-12 Boss's Orders: gust becomes a switch event attributed via the trainer", () => {
  const p = parse('battle-12.txt');
  const sw = p.events.find((e): e is Extract<BattleEvent, { type: 'switch' }> => e.type === 'switch')!;
  assert.equal(sw.actor, 'cheyras'); // owner of the switched board
  assert.deepEqual(sw.payload, {
    in: { name: 'Dhelmise', ref: 'me5_39' },
    out: { name: 'Poltchageist', ref: 'me5_5' },
    via: "Boss's Orders",
  });
  const promote = p.events.find((e) => e.type === 'promote' && e.seq > sw.seq)!;
  assert.equal(promote.turn, sw.turn);
});

test('battle-12 retreat and Night Stretcher recovery', () => {
  const p = parse('battle-12.txt');
  const ret = p.events.find((e): e is Extract<BattleEvent, { type: 'retreat' }> => e.type === 'retreat' && e.actor === 'cheyras')!;
  assert.deepEqual(ret.payload.card, { name: 'Sinistcha', ref: 'me5_6' });
  const mv = p.events.find((e): e is Extract<BattleEvent, { type: 'move_cards' }> => e.type === 'move_cards' && e.payload.to === 'hand')!;
  assert.deepEqual(mv.payload, {
    to: 'hand', card: { name: 'Sinistcha', ref: 'me5_6' }, owner: 'cheyras', via: 'Night Stretcher',
  });
});

test('battle-12 Special Red Card: hand shuffle, deck-bottom move, blind draw', () => {
  const p = parse('battle-12.txt');
  const i = p.events.findIndex((e) => e.type === 'play_card' && (e.payload as { card: { name: string } }).card.name === 'Special Red Card');
  assert.ok(i > 0);
  const [shuffle, bottom, draw] = p.events.slice(i + 1, i + 4);
  assert.equal(shuffle!.type, 'shuffle');
  assert.deepEqual(shuffle!.payload, { zone: 'hand', via: 'Special Red Card' });
  assert.equal(bottom!.type, 'move_cards');
  assert.deepEqual(bottom!.payload, { to: 'deck_bottom', count: 4, via: 'Special Red Card' });
  assert.equal(draw!.type, 'draw');
  assert.deepEqual(draw!.payload, { count: 3, via: 'Special Red Card' });
});

// ── Trainers, abilities-as-plays, nested actions ─────────────────────────────

test('battle-09 Dudunsparce: bare "played X." is play_card (trainer OR in-play ability — not guessed)', () => {
  const p = parse('battle-09.txt');
  const i = p.events.findIndex((e) => e.type === 'play_card' && (e.payload as { card: { name: string } }).card.name === 'Dudunsparce');
  assert.ok(i > 0, 'Dudunsparce ability line parsed as play_card');
  const [draw, shuffle] = p.events.slice(i + 1, i + 3);
  assert.equal(draw!.type, 'draw');
  assert.deepEqual(draw!.payload, { count: 3, via: 'Dudunsparce' });
  assert.equal(shuffle!.type, 'shuffle');
  assert.deepEqual(shuffle!.payload, {
    zone: 'deck', count: 2, via: 'Dudunsparce',
    cards: [{ name: 'Dudunsparce' }, { name: 'Dunsparce' }],
  });
});

test('battle-03 Rare Candy: nested evolution keeps via', () => {
  const p = parse('battle-03.txt');
  const ev = p.events.find(
    (e): e is Extract<BattleEvent, { type: 'evolve' }> => e.type === 'evolve' && e.payload.via === 'Rare Candy',
  )!;
  assert.equal(ev.actor, 'Robni16');
  assert.deepEqual(ev.payload, {
    from: { name: 'Dreepy' }, to: { name: 'Dragapult ex' }, where: 'bench', via: 'Rare Candy',
  });
});

test('battle-08 Buddy-Buddy Poffin: drew-and-played-to-bench with folded card list', () => {
  const p = parse('battle-08.txt');
  const d = p.events.find(
    (e): e is Extract<BattleEvent, { type: 'draw' }> => e.type === 'draw' && e.payload.to === 'bench' && e.payload.via === 'Buddy-Buddy Poffin',
  )!;
  assert.equal(d.payload.count, 2);
  assert.deepEqual(d.payload.cards, [{ name: 'Shuppet' }, { name: 'Poltchageist' }]);
});

test('battle-04 Prism Tower re-use: opponent-controlled discard with owner and folded cards', () => {
  const p = parse('battle-04.txt');
  const mv = p.events.find(
    (e): e is Extract<BattleEvent, { type: 'move_cards' }> => e.type === 'move_cards' && e.payload.to === 'discard',
  )!;
  assert.equal(mv.actor, 'cheyras'); // cheyras chose the cards…
  assert.equal(mv.payload.owner, 'CJW9298'); // …from CJW9298's hand
  assert.equal(mv.payload.count, 2);
  assert.deepEqual(mv.payload.cards, [{ name: 'Rare Candy' }, { name: 'Froakie' }]);
  assert.equal(mv.payload.via, 'Prism Tower');
});

// ── KO sequence, prizes, hidden hand-adds ────────────────────────────────────

test('battle-12 KO sequence: knockout → tool discard → prize → hidden hand_add → promote', () => {
  const p = parse('battle-12.txt');
  const ko = p.events.find((e): e is Extract<BattleEvent, { type: 'knockout' }> => e.type === 'knockout')!;
  assert.equal(ko.actor, 'cheyras'); // owner of the downed Dhelmise
  assert.deepEqual(ko.payload.card, { name: 'Dhelmise', ref: 'me5_39' });
  const after = p.events.slice(ko.seq, ko.seq + 4); // seq is 1-based ⇒ slice from index ko.seq
  assert.equal(after[0]!.type, 'discard');
  assert.deepEqual((after[0] as Extract<BattleEvent, { type: 'discard' }>).payload.from, {
    player: 'cheyras', card: { name: 'Dhelmise', ref: 'me5_39' },
  });
  assert.equal(after[1]!.type, 'prize_take');
  assert.deepEqual(after[1]!.payload, { count: 1 });
  // Opponent's prize pickup is hidden information: card is null.
  assert.equal(after[2]!.type, 'hand_add');
  assert.deepEqual(after[2]!.payload, { card: null });
  assert.equal(after[3]!.type, 'promote');
});

test('battle-08 named hand_add (own prize pickup is revealed)', () => {
  const p = parse('battle-08.txt');
  const add = p.events.find(
    (e): e is Extract<BattleEvent, { type: 'hand_add' }> => e.type === 'hand_add' && e.payload.card !== null,
  )!;
  assert.equal(add.actor, 'cheyras');
  assert.deepEqual(add.payload.card, { name: 'Buddy-Buddy Poffin' });
});

// ── Special conditions, checkup, counters, damage, heal, negation ────────────

test('battle-12 poison: condition on apply, checkup event, condition-attributed counters', () => {
  const p = parse('battle-12.txt');
  const cond = p.events.find((e): e is Extract<BattleEvent, { type: 'condition' }> => e.type === 'condition')!;
  assert.equal(cond.payload.condition, 'Poisoned');
  assert.deepEqual(cond.payload.target, {
    player: 'warthog2010', card: { name: 'Mega Darkrai ex', ref: 'me5_116' },
  });
  assert.equal(cond.payload.via, 'Subjugating Chains');

  const checkups = p.events.filter((e) => e.type === 'checkup');
  assert.equal(checkups.length, 2);
  const poisonTick = p.events.find(
    (e): e is Extract<BattleEvent, { type: 'damage_counters' }> => e.type === 'damage_counters' && e.payload.condition === 'Poisoned',
  )!;
  assert.equal(poisonTick.actor, null); // system line
  assert.equal(poisonTick.payload.count, 1);
  assert.equal(poisonTick.seq, checkups[0]!.seq + 1);
});

test('battle-05 Matcha Spin counters, heal, and bench damage', () => {
  const p = parse('battle-05.txt');
  const counters = p.events.filter(
    (e): e is Extract<BattleEvent, { type: 'damage_counters' }> => e.type === 'damage_counters' && e.payload.via === 'Matcha Spin',
  );
  assert.ok(counters.length >= 1);
  const heal = p.events.find((e): e is Extract<BattleEvent, { type: 'heal' }> => e.type === 'heal')!;
  assert.equal(heal.payload.target.card.name, 'Lurantis ex');
  assert.ok(heal.payload.amount > 0);
});

test('battle-04 bench damage lines become damage events', () => {
  const p = parse('battle-04.txt');
  const dmg = p.events.filter((e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage');
  assert.ok(dmg.length >= 1);
  for (const d of dmg) {
    assert.ok(d.payload.amount > 0);
    assert.equal(d.payload.target.player, d.actor);
  }
});

test("battle-08 effect_negated: Hide 'n' Sneak protection", () => {
  const p = parse('battle-08.txt');
  const neg = p.events.find((e): e is Extract<BattleEvent, { type: 'effect_negated' }> => e.type === 'effect_negated')!;
  assert.equal(neg.actor, null);
  assert.deepEqual(neg.payload, { effect: 'Poison Jab', card: { name: 'Shuppet' } });
});

test('battle-12 tool/energy activation (no owner on the line ⇒ actor null)', () => {
  const p = parse('battle-12.txt');
  const act = p.events.find((e): e is Extract<BattleEvent, { type: 'activate' }> => e.type === 'activate')!;
  assert.equal(act.actor, null);
  assert.deepEqual(act.payload.card, { name: 'Telepathic Psychic Energy', ref: 'me3_88' });
});

// ── Stadiums and card refs ───────────────────────────────────────────────────

test('battle-12 stadium: play_stadium on placement, play_card on each later use', () => {
  const p = parse('battle-12.txt');
  const placed = p.events.find((e): e is Extract<BattleEvent, { type: 'play_stadium' }> => e.type === 'play_stadium')!;
  assert.deepEqual(placed.payload.card, { name: 'Prism Tower', ref: 'me4_80' });
  const used = p.events.filter(
    (e) => e.type === 'play_card' && (e.payload as { card: { name: string } }).card.name === 'Prism Tower',
  );
  assert.ok(used.length >= 1, 'later per-turn stadium uses are play_card');
  assert.ok(used.every((e) => e.seq > placed.seq));
});

test('card refs: (setId_localId[_variant]) prefixes parse into CardRef.ref', () => {
  const p = parse('battle-12.txt');
  const gastly = p.events.find(
    (e) => e.type === 'play_to_bench' && (e.payload as { card: { name: string } }).card.name === 'Gastly',
  )!;
  assert.deepEqual((gastly.payload as { card: unknown }).card, { name: 'Gastly', ref: 'me3_48_ph' });
  // Older logs have bare names — no ref key at all.
  const p3 = parse('battle-03.txt');
  const bare = p3.events.find((e) => e.type === 'play_to_bench')!;
  assert.equal('ref' in (bare.payload as { card: object }).card, false);
});

// ── Game endings ─────────────────────────────────────────────────────────────

test('game_end reasons across the corpus: prizes, timeout, no_bench', () => {
  const end = (f: string) =>
    parse(f).events.find((e): e is Extract<BattleEvent, { type: 'game_end' }> => e.type === 'game_end')!;

  const prizes = end('battle-03.txt');
  assert.deepEqual(prizes.payload, { winner: 'cheyras', reason: 'prizes' }); // 'All Prize cards taken.' carries no note

  const oppPrizes = end('battle-12.txt');
  assert.equal(oppPrizes.payload.reason, 'prizes');
  assert.equal(oppPrizes.payload.winner, 'warthog2010');
  assert.equal(oppPrizes.payload.note, 'Opponent took all of their Prize cards.');

  const timeout = end('battle-08.txt');
  assert.deepEqual(timeout.payload, {
    winner: 'cheyras', reason: 'timeout', note: 'Opponent was inactive for too long.',
  });

  const noBench = end('battle-10.txt');
  assert.deepEqual(noBench.payload, {
    winner: 'cheyras', reason: 'no_bench', note: 'No Benched Pokémon for backup.',
  });

  // KO-sweep phrasing still resolves to prizes (the sentence states prize completion).
  const sweep = end('battle-07.txt');
  assert.equal(sweep.payload.reason, 'prizes');
  assert.equal(sweep.payload.winner, 'Golduck28711');
});

test('a concession emits a concede event (synthesized — no stored concession yet)', () => {
  const log = [
    'Setup',
    'Ash drew 7 cards for the opening hand.',
    'Misty drew 7 cards for the opening hand.',
    "Ash's Turn",
    'Ash played Pikachu to the Bench.',
    'Misty conceded.',
  ].join('\n');
  const p = parseBattleEvents(log);
  const last = p.events[p.events.length - 1]!;
  assert.equal(last.type, 'concede');
  assert.equal(last.actor, 'Misty');
  assert.equal(p.unknown.count, 0);
});

// ── Tolerance (the prime directive) ──────────────────────────────────────────

test('never throws on arbitrary text; freetext degrades to zero events at rate 1', () => {
  for (const junk of ['', '   \n\n', 'complete nonsense\nnothing here', '🎴'.repeat(50), 'null']) {
    const p = parseBattleEvents(junk);
    assert.deepEqual(p.events, []);
    assert.equal(p.turns, 0);
    if (junk.trim()) assert.equal(p.unknown.rate, 1);
    else assert.equal(p.unknown.rate, 0);
  }
  const note = parse('battle-06.txt'); // Chey's freetext win note — a real stored row
  assert.deepEqual(note.events, []);
  assert.equal(note.unknown.rate, 1);
});

test('unknown lines are counted with capped samples, and known lines still parse around them', () => {
  const log = [
    'Setup',
    'Ash drew 7 cards for the opening hand.',
    'Misty drew 7 cards for the opening hand.',
    "Ash's Turn",
    'something the parser has never seen',
    'Ash played Pikachu to the Bench.',
    '   • orphan, bullet, list',
  ].join('\n');
  const p = parseBattleEvents(log);
  assert.equal(p.unknown.count, 2);
  assert.equal(p.unknown.considered, 7);
  assert.deepEqual(p.unknown.samples, ['something the parser has never seen', '   • orphan, bullet, list']);
  assert.equal(p.events.filter((e) => e.type === 'play_to_bench').length, 1);
});
