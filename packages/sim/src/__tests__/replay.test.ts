/**
 * Live log replay: the parser reads real PTCG Live logs, and the audit checks
 * every stated attack damage, Knock Out and Prize count against the engine.
 * Fixtures are the owner's real games (Hide 'n' Sneak, Toolbox Slowking),
 * anonymised: the owner is PlayerA, every opponent PlayerB.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { auditLog, type LogAudit } from '../replay/audit.js';
import { codeToCardId, resolveFrame } from '../replay/cardCodes.js';
import { parseLiveLog } from '../replay/liveLog.js';

const DIR = new URL('./fixtures/live-logs/', import.meta.url);
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.txt')).sort();
// Normalise line endings: a Windows checkout (core.autocrlf) turns fixtures into CRLF.
const read = (f: string): string => readFileSync(new URL(f, DIR), 'utf8').replace(/\r\n/g, '\n');
const PLAYERS: [string, string] = ['PlayerA', 'PlayerB'];

test('fixtures: 5–10 anonymised real logs, no real handles', () => {
  assert.ok(FILES.length >= 5 && FILES.length <= 10, `${FILES.length} fixtures`);
  for (const f of FILES) {
    const p = parseLiveLog(read(f));
    assert.deepEqual([...p.players].sort(), PLAYERS, `${f} players ${p.players}`);
  }
});

test('card codes map to TCGdex ids', () => {
  assert.equal(codeToCardId('sv6-5_38'), 'sv06.5-038');
  assert.equal(codeToCardId('(me5_29_ph)'), 'me05-029');
  assert.equal(codeToCardId('me2-5_98'), 'me02.5-098');
  assert.equal(codeToCardId('sv10_102'), 'sv10-102');
  assert.equal(codeToCardId('mee_6'), 'mee-006');
  // Black Bolt / White Flare: Zekrom and Reshiram set tokens.
  assert.equal(codeToCardId('zsv10-5_79'), 'sv10.5b-079');
  assert.equal(codeToCardId('rsv10-5_84'), 'sv10.5w-084');
  assert.equal(codeToCardId('Ability'), null);
  // A code names one printing: an absent printing does NOT fall back to a same-named card.
  assert.equal(resolveFrame('Riolu', 'sv08.5-050').frame?.hp, 70);
  assert.equal(resolveFrame('Riolu', 'me01-076').frame?.hp, 80);
  assert.equal(resolveFrame('Pecharunt ex', 'sv08.5-163').frame, null);
  // Without a code, a name resolves only when every printing shares one game text.
  assert.equal(resolveFrame('Riolu').frame, null);
  assert.equal(resolveFrame('Mega Kangaskhan ex').frame?.hp, 300);
  assert.equal(resolveFrame('Basic Psychic Energy').frame?.category, 'Energy');
});

test('parser coverage: unknown lines under 1% per log; every printed code maps', () => {
  let unknown = 0;
  let considered = 0;
  for (const f of FILES) {
    const p = parseLiveLog(read(f), { players: PLAYERS });
    assert.ok(p.unknown.rate < 0.01, `${f}: ${p.unknown.count}/${p.unknown.considered} unknown: ${p.unknown.samples.join(' | ')}`);
    assert.equal(p.codes.mapped, p.codes.mentions, `${f}: unmapped codes`);
    assert.ok(p.turns >= 5, `${f}: ${p.turns} turns`);
    assert.ok(p.events.some((e) => e.t === 'game_end'), `${f}: no game end`);
    unknown += p.unknown.count;
    considered += p.unknown.considered;
  }
  // The one unknown line in the corpus is the owner's freetext note appended to hns-05.
  assert.equal(unknown, 1);
  assert.ok(considered > 900);
});

test('parser: attack with Weakness rider and damage breakdown', () => {
  const p = parseLiveLog(read('tbs-58.txt'), { players: PLAYERS });
  const atk = p.events.filter((e) => e.t === 'attack');
  assert.equal(atk.length, 4);
  const [brave, jab] = atk as Extract<(typeof atk)[number], { t: 'attack' }>[];
  assert.equal(brave!.p, 1);
  assert.equal(brave!.attacker.name, 'Mega Lucario ex');
  assert.equal(brave!.move, 'Mega Brave');
  assert.deepEqual(brave!.target, { player: 0, card: { name: 'Mega Kangaskhan ex' } });
  assert.equal(brave!.damage, 540);
  assert.deepEqual(brave!.riders, [{ kind: 'weakness', type: 'Fighting', amount: 270 }]);
  assert.deepEqual(brave!.breakdown, [
    { label: 'Base damage', amount: 270 },
    { label: 'Weakness to Fighting', amount: 270 },
    { label: 'Total damage', amount: 540 },
  ]);
  assert.deepEqual(jab!.riders, [{ kind: 'resistance', type: 'Fighting', amount: -30 }]);
  const end = p.events.find((e) => e.t === 'game_end');
  assert.deepEqual(end && { w: (end as { winner: number }).winner, r: (end as { reason: string }).reason }, { w: 1, r: 'prizes' });
});

test('parser: code-era mentions, spread damage lines, chosen copy attack, setup', () => {
  const p = parseLiveLog(read('tbs-65.txt'), { players: PLAYERS });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a test reads event fields loosely
  const t = (k: string): any[] => p.events.filter((e) => e.t === k);
  assert.deepEqual(t('go_first').map((e) => [e.p, (e as { first: boolean }).first]), [[1, true]]);
  const hand = t('opening_hand').find((e) => e.p === 0) as { cards?: { name: string; id?: string }[] };
  assert.equal(hand.cards?.length, 7);
  assert.deepEqual(hand.cards?.[1], { name: 'Mega Kangaskhan ex', code: 'me1_104', id: 'me01-104' });
  const spread = t('damage') as { p: number; target: { name: string }; amount: number; sub: boolean }[];
  assert.equal(spread.length, 6);
  assert.ok(spread.every((d) => d.p === 1 && d.amount === 110 && d.sub));
  assert.deepEqual(t('chose').map((e) => (e as { option: string }).option), ['Trifrost', 'Trifrost']);
  assert.deepEqual(t('prize').map((e) => [e.p, (e as { count: number }).count]), [[0, 2], [0, 4]]);
  assert.equal(t('knockout').length, 5);
  const air = t('attach').find((e) => (e as { card: { name: string } }).card.name === 'Air Balloon') as { card: { id?: string } };
  assert.equal(air.card.id, 'sv10.5b-079');
});

test('parser never throws and counts what it cannot read', () => {
  for (const junk of ['', 'hello', '•', '- Damage breakdown:', 'A\'s Turn\n   • x', '\u0000\u0001'.repeat(50)]) {
    const p = parseLiveLog(junk);
    assert.ok(p.unknown.count <= p.unknown.considered);
  }
  const p = parseLiveLog('Setup\nPlayerA chose heads for the opening coin flip.\nsomething odd happened\n   • stray bullet');
  assert.equal(p.unknown.count, 2);
});

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

const AUDITS: LogAudit[] = FILES.map((f) => auditLog(read(f), f, { players: PLAYERS }));

test('audit: zero unexplained mismatches over the owner\'s real games', () => {
  const bad = AUDITS.flatMap((a) => [
    ...a.damage.filter((d) => d.verdict === 'mismatch').map((d) => `${a.name} L${d.line} ${d.attacker}→${d.target}: ${d.reason}`),
    ...a.kos.filter((d) => d.verdict === 'mismatch').map((d) => `${a.name} KO L${d.line} ${d.card}: ${d.reason}`),
    ...a.prizes.filter((d) => d.verdict === 'mismatch').map((d) => `${a.name} prizes T${d.turn}: ${d.reason}`),
  ]);
  assert.deepEqual(bad, []);
  const sum = (k: 'damage' | 'kos' | 'prizes', v: 'match' | 'explained') => AUDITS.reduce((n, a) => n + a.totals[k][v], 0);
  // Coverage floors, so an audit that silently checks nothing fails.
  assert.ok(sum('damage', 'match') >= 10, `damage matches ${sum('damage', 'match')}`);
  assert.ok(sum('damage', 'explained') >= 3);
  assert.ok(sum('kos', 'match') >= 20, `KO matches ${sum('kos', 'match')}`);
  assert.ok(sum('prizes', 'match') >= 25, `prize matches ${sum('prizes', 'match')}`);
});

test('audit: Weakness ×2 and Resistance −30 reproduce exactly from printed frames', () => {
  const a = AUDITS.find((x) => x.name === 'tbs-58.txt')!;
  const d = a.damage.map((x) => [x.move, x.target, x.logged, x.engine, x.verdict]);
  assert.deepEqual(d, [
    ['Mega Brave', 'Mega Kangaskhan ex', 540, 540, 'match'], // Fighting Weakness
    ['Aura Jab', 'Slowpoke', 100, 100, 'match'], // Fighting Resistance -30
    ['Aura Jab', 'Slowpoke', 100, 100, 'match'],
    ['Mega Brave', 'Slowking', 240, 240, 'match'],
  ]);
  // Mega ex: 3 Prize cards.
  assert.deepEqual(a.prizes[0], { turn: 3, side: 1, expected: 3, taken: 3, kos: ['Mega Kangaskhan ex'], verdict: 'match', reason: '' });
});

test('audit: variable attacks verify Weakness from the log\'s own base (Vengeful Anchor 30+)', () => {
  const a = AUDITS.find((x) => x.name === 'hns-11.txt')!;
  const va = a.damage.filter((x) => x.move === 'Vengeful Anchor');
  assert.equal(va.length, 2);
  for (const x of va) {
    assert.equal(x.verdict, 'explained');
    assert.equal(x.pre, 170); // 30 base + 140 for 4 discarded Pokémon
    assert.equal(x.engineFromPre, 340); // Psychic Weakness on Mega Lucario ex
  }
});

test('audit: copied attacks use the copied card\'s printing; Prizes cap at what is left', () => {
  const a = AUDITS.find((x) => x.name === 'tbs-57.txt')!;
  const hammer = a.damage.find((x) => x.via === 'Metallic Hammer')!;
  assert.equal(hammer.printed, '150+'); // Metagross's attack, not Slowking's Seek Inspiration
  assert.equal(hammer.engineFromPre, 300);
  // Three Metang took 110 each across two Trifrosts: each hit lands on a different Metang.
  assert.ok(a.kos.filter((k) => k.card === 'Metang').every((k) => k.verdict === 'match'));
  // Mega Excadrill ex (3) + Metang (1) with 3 Prizes left: 3.
  const last = a.prizes[a.prizes.length - 1]!;
  assert.deepEqual([last.expected, last.taken, last.verdict], [3, 3, 'match']);
});

test('audit: Weakness is not applied to the Bench (Seek Inspiration → Trifrost)', () => {
  const log = [
    'Setup',
    'PlayerA chose heads for the opening coin flip.',
    'PlayerA won the coin toss.',
    'PlayerA decided to go first.',
    'PlayerA played (me1_76) Riolu to the Active Spot.',
    'PlayerB played (me1_76) Riolu to the Active Spot.',
    'PlayerB played (me1_104) Mega Kangaskhan ex to the Bench.',
    '',
    "PlayerA's Turn",
    'PlayerA evolved (me1_76) Riolu to (me1_77) Mega Lucario ex in the Active Spot.',
    "PlayerA's (me1_77) Mega Lucario ex used Seek Inspiration.",
    '- PlayerA chose Trifrost',
    "- PlayerB's (me1_104) Mega Kangaskhan ex took 110 damage.",
    "- PlayerB's (me1_76) Riolu took 110 damage.",
    "PlayerB's (me1_76) Riolu was Knocked Out!",
    'PlayerA took a Prize card.',
  ].join('\n');
  const a = auditLog(log, 'bench', { players: PLAYERS });
  const [kang, riolu] = a.damage;
  assert.equal(kang!.where, 'bench');
  assert.equal(kang!.engineFromPre, 110); // a Fighting attacker, a Fighting-weak target, on the Bench: no ×2
  assert.equal(kang!.verdict, 'explained');
  assert.equal(riolu!.where, 'active');
  assert.equal(riolu!.engineFromPre, 110);
  assert.deepEqual(a.totals.kos, { match: 1, explained: 0, mismatch: 0, unchecked: 0 });
  assert.deepEqual(a.totals.prizes, { match: 1, explained: 0, mismatch: 0, unchecked: 0 });
});

test('audit catches a log the rules cannot produce', () => {
  const base = read('tbs-58.txt');
  // Resistance dropped from Live's line: the engine still applies it.
  const noRes = base.replace(
    "for 100 damage. PlayerA's Slowpoke took -30 less damage because of Fighting Resistance.\n- Damage breakdown:\n   • Base damage: 130 damage\n   • Resistance to Fighting: -30 damage\n   • Total damage: 100 damage",
    'for 130 damage.',
  );
  assert.notEqual(noRes, base);
  const a = auditLog(noRes, 'mutated', { players: PLAYERS });
  const m = a.damage.find((d) => d.verdict === 'mismatch');
  assert.ok(m, 'the dropped Resistance must be reported');
  assert.match(m!.reason, /turns 130 into 100/);
  // A Mega ex worth 2 Prizes.
  const prize = auditLog(base.replace('PlayerB took 3 Prize cards.', 'PlayerB took 2 Prize cards.'), 'mutated', { players: PLAYERS });
  assert.equal(prize.totals.prizes.mismatch, 1);
  // A Knock Out below HP: Mega Brave without Weakness is 270 < 300.
  const ko = auditLog(
    base.replace(
      "for 540 damage. PlayerA's Mega Kangaskhan ex took 270 more damage because of Fighting Weakness.\n- Damage breakdown:\n   • Base damage: 270 damage\n   • Weakness to Fighting: 270 damage\n   • Total damage: 540 damage",
      'for 270 damage.',
    ),
    'mutated',
    { players: PLAYERS },
  );
  assert.equal(ko.totals.damage.mismatch, 1); // the engine applies the Weakness Live "forgot"
  assert.equal(ko.totals.kos.mismatch, 1);
});
