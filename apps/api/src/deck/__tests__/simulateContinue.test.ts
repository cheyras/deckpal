/**
 * Simulator continuation (deck/simulateContinue.ts + the cumulative path in
 * deck/simulate.ts): the signed token round-trips and refuses tampering, other
 * accounts, other decks, old and over-long chains; and calls that continue a
 * run give the numbers one longer run gives.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import type { CardFrame, CompareTotals, DeckInput, MatchupTotals } from '@deckpal/sim';
import { ApiError } from '../../http.js';
import {
  CONTINUE_MAX_CALLS, CONTINUE_TTL_MS, continueSecret, fingerprintCounts, identityMismatch, macOf, mintContinueToken, openContinueToken,
  type ContinueIdentity, type ContinueState,
} from '../simulateContinue.js';
import { SIM_TEXT_LIMIT, callPairs, parseSimulateBody, pilotFactory, runComparison, runMatchups, type RunMatchupsOptions } from '../simulate.js';

const SECRET = 'a-long-random-test-secret-of-some-length';
const USER = '00000000-0000-4000-8000-0000000000aa';
const ENV: NodeJS.ProcessEnv = {};

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
const deck = (name: string, m: CardFrame): DeckInput => ({ name, cards: [{ frame: m, count: 20 }, { frame: ENERGY, count: 40 }] });
const PUPS = deck('Pups', mon('t-1', 'Pup', 70, '30'));
const BIG = deck('Big pups', mon('t-4', 'Big Pup', 70, '60'));
const OPPS = [deck('Cats', mon('t-2', 'Cat', 70, '30')), deck('Birds', mon('t-3', 'Bird', 90, '20'))];

const IDENTITY: ContinueIdentity = { subject: fingerprintCounts([{ card_id: '1', quantity: 60 }]), b: null, opponents: ['aaa', 'bbb'], format: '' };

/** Totals from a real (tiny) run, to put in a token. */
async function realState(): Promise<{ state: ContinueState; totals: MatchupTotals[] }> {
  let kept: MatchupTotals[] = [];
  await runMatchups(PUPS, OPPS, {
    games: 4, seed: 1, budgetMs: 60_000, pilot: pilotFactory('fast'),
    mint: (s) => { kept = s.run!; return null; },
  });
  return { totals: kept, state: { calls: 1, odd: 0, speed: 'fast', seed: 1, identity: IDENTITY, run: kept, cmp: null } };
}

function rejects(fn: () => unknown, re: RegExp): void {
  assert.throws(fn, (err: unknown) => err instanceof ApiError && err.status === 400 && re.test(err.message), `expected a 400 matching ${re}`);
}

test('the token round-trips: identity, speed, seed, calls and every total come back exactly', async () => {
  const { state } = await realState();
  const token = mintContinueToken(SECRET, USER, state, Date.now(), ENV);
  assert.match(token, /^sc1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
  const back = openContinueToken(SECRET, USER, token, Date.now(), ENV);
  assert.deepEqual(back, state);
  // The signature is deterministic for the same payload, and a plain 2-opponent token is small.
  assert.ok(token.length < 1500, `token is ${token.length} chars`);
});

test('a paired comparison token round-trips its paired statistics', async () => {
  let kept: CompareTotals[] = [];
  await runComparison(PUPS, BIG, OPPS, { games: 8, seed: 3, budgetMs: 60_000, pilot: pilotFactory('fast'), mint: (s) => { kept = s.cmp!; return null; } });
  const state: ContinueState = { calls: 2, odd: 0, speed: 'fast', seed: 3, identity: { ...IDENTITY, b: 'bbbb' }, run: null, cmp: kept };
  const back = openContinueToken(SECRET, USER, mintContinueToken(SECRET, USER, state, Date.now(), ENV), Date.now(), ENV);
  assert.deepEqual(back, state);
  assert.ok(back.cmp![0]!.paired.m > 0);
});

test('a tampered token is refused: edited totals, edited signature, another account, another secret', async () => {
  const { state } = await realState();
  const token = mintContinueToken(SECRET, USER, state, Date.now(), ENV);
  const [prefix, payload, mac] = token.split('.') as [string, string, string];
  const flip = (s: string, i: number) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);
  rejects(() => openContinueToken(SECRET, USER, `${prefix}.${flip(payload, 5)}.${mac}`, Date.now(), ENV), /failed verification/);
  rejects(() => openContinueToken(SECRET, USER, `${prefix}.${payload}.${flip(mac, 3)}`, Date.now(), ENV), /failed verification/);
  rejects(() => openContinueToken(SECRET, '00000000-0000-4000-8000-0000000000bb', token, Date.now(), ENV), /different account/);
  rejects(() => openContinueToken('another-secret-entirely-different', USER, token, Date.now(), ENV), /failed verification/);
  // Totals a client wrote itself: valid compressed JSON, but not signed by the engine.
  const forged = deflateRawSync(Buffer.from(JSON.stringify({ v: 1, t: Date.now(), c: 1 })));
  rejects(() => openContinueToken(SECRET, USER, `sc1.${forged.toString('base64url')}.${mac}`, Date.now(), ENV), /failed verification/);
  for (const junk of ['', 'hello', 'sc1.x.y', `${token}x`, 42, null, undefined]) {
    rejects(() => openContinueToken(SECRET, USER, junk, Date.now(), ENV), /not a token this simulator issued|failed verification/);
  }
});

test('a token the server signed but cannot use is refused with what to do: version, age, deployment, chain length, damaged totals', async () => {
  const { state } = await realState();
  const sign = (payload: object) => {
    const c = deflateRawSync(Buffer.from(JSON.stringify(payload)));
    return `sc1.${c.toString('base64url')}.${macOf(SECRET, USER, c).toString('base64url')}`;
  };
  const good = { v: 1, t: Date.now(), c: 1, s: 'f', d: 1, k: 'r', e: '', i: { s: IDENTITY.subject, b: null, o: IDENTITY.opponents, f: '' }, a: [] as unknown[] };
  const wire = (await import('@deckpal/sim')).totalsToWire;
  const withTotals = { ...good, a: state.run!.map(wire) };
  assert.equal(openContinueToken(SECRET, USER, sign(withTotals), Date.now(), ENV).calls, 1);
  rejects(() => openContinueToken(SECRET, USER, sign({ ...withTotals, v: 2 }), Date.now(), ENV), /different version of the simulator's token format/);
  rejects(() => openContinueToken(SECRET, USER, sign({ ...withTotals, t: Date.now() - CONTINUE_TTL_MS - 1000 }), Date.now(), ENV), /expired/);
  rejects(() => openContinueToken(SECRET, USER, sign(withTotals), Date.now(), { VERCEL_DEPLOYMENT_ID: 'dpl_new' }), /simulator was last updated/);
  rejects(() => openContinueToken(SECRET, USER, sign({ ...withTotals, c: CONTINUE_MAX_CALLS }), Date.now(), ENV), /limit of 12 calls/);
  rejects(() => openContinueToken(SECRET, USER, sign({ ...withTotals, a: [[1, 2]] }), Date.now(), ENV), /could not be read/);
  rejects(() => openContinueToken(SECRET, USER, sign({ ...withTotals, a: [] }), Date.now(), ENV), /could not be read/);
  // A deployment stamp that matches is accepted.
  const stamped = mintContinueToken(SECRET, USER, state, Date.now(), { VERCEL_DEPLOYMENT_ID: 'dpl_a' });
  assert.equal(openContinueToken(SECRET, USER, stamped, Date.now(), { VERCEL_DEPLOYMENT_ID: 'dpl_a' }).calls, 1);
  rejects(() => openContinueToken(SECRET, USER, stamped, Date.now(), { VERCEL_DEPLOYMENT_ID: 'dpl_b' }), /last updated/);
});

test('identity: the same inputs match; an edited deck, another opponent, a changed speed or seed or kind do not', () => {
  const token: ContinueState = { calls: 1, odd: 0, speed: 'fast', seed: 1, identity: IDENTITY, run: [], cmp: null };
  const now = { speed: 'fast' as const, seed: 1, identity: IDENTITY, names: ['Cats', 'Birds'], subjectName: 'Pups', bName: null };
  assert.equal(identityMismatch(token, now), null);
  assert.match(identityMismatch(token, { ...now, identity: { ...IDENTITY, subject: fingerprintCounts([{ card_id: '1', quantity: 59 }, { card_id: '2', quantity: 1 }]) } })!, /deck being tested \(Pups\) has a different card list/);
  assert.match(identityMismatch(token, { ...now, identity: { ...IDENTITY, opponents: ['aaa', 'zzz'] } })!, /opponent 2 \(Birds\) is a different list/);
  assert.match(identityMismatch(token, { ...now, identity: { ...IDENTITY, opponents: ['aaa'] } })!, /had 2 opponents, this request has 1/);
  assert.match(identityMismatch(token, { ...now, identity: { ...IDENTITY, b: 'bbbb' }, bName: 'v2' })!, /plain run, not a comparison/);
  assert.match(identityMismatch({ ...token, identity: { ...IDENTITY, b: 'bbbb' } }, { ...now, bName: null })!, /paired comparison/);
  assert.match(identityMismatch({ ...token, identity: { ...IDENTITY, b: 'bbbb' } }, { ...now, identity: { ...IDENTITY, b: 'cccc' }, bName: 'v2' })!, /version B \(v2\)/);
  assert.match(identityMismatch(token, { ...now, speed: 'strong' })!, /used speed 'fast'/);
  assert.match(identityMismatch(token, { ...now, seed: 9 })!, /used seed 1/);
  assert.match(identityMismatch(token, { ...now, identity: { ...IDENTITY, format: 'expanded' } })!, /format differs/);
  assert.match(identityMismatch(token, { ...now, speed: 'strong' })!, /never mixed/);
});

test('fingerprintCounts ignores order and line splits but sees any card or quantity change', () => {
  const a = fingerprintCounts([{ card_id: '10', quantity: 2 }, { card_id: '9', quantity: 3 }]);
  assert.equal(fingerprintCounts([{ card_id: '9', quantity: 1 }, { card_id: '10', quantity: 2 }, { card_id: '9', quantity: 2 }]), a);
  assert.notEqual(fingerprintCounts([{ card_id: '10', quantity: 2 }, { card_id: '9', quantity: 4 }]), a);
  assert.notEqual(fingerprintCounts([{ card_id: '10', quantity: 2 }, { card_id: '11', quantity: 3 }]), a);
});

test('the secret is DECKE_APPROVAL_SECRET: unset or empty means continuation is off', () => {
  assert.equal(continueSecret({}), null);
  assert.equal(continueSecret({ DECKE_APPROVAL_SECRET: '' }), null);
  assert.equal(continueSecret({ DECKE_APPROVAL_SECRET: 'x'.repeat(20) }), 'x'.repeat(20));
});

test('parseSimulateBody reads continue_token and bounds it', () => {
  assert.equal(parseSimulateBody({ deck_id: 'x', continue_token: ' sc1.abc.def ' }).continueToken, 'sc1.abc.def');
  assert.throws(() => parseSimulateBody({ deck_id: 'x', continue_token: 7 }), /continue_token must be/);
  assert.throws(() => parseSimulateBody({ deck_id: 'x', continue_token: '' }), /continue_token must be/);
});

// ---------------------------------------------------------------------------
// Continuation equals one long run
// ---------------------------------------------------------------------------

/** Run a call, putting the cumulative totals through a real signed token between calls, as the route does. */
async function chain(calls: number, perCall: number, identity: ContinueIdentity, opts: Partial<RunMatchupsOptions> = {}) {
  let token: string | null = null;
  let last: Awaited<ReturnType<typeof runMatchups>> | null = null;
  for (let i = 0; i < calls; i++) {
    const prior = token ? openContinueToken(SECRET, USER, token, Date.now(), ENV) : null;
    last = await runMatchups(PUPS, OPPS, {
      games: perCall, seed: 7, budgetMs: 60_000, pilot: pilotFactory('fast'), ...opts,
      ...(prior?.run ? { prior: { calls: prior.calls, odd: prior.odd, totals: prior.run } } : {}),
      mint: (s) => mintContinueToken(SECRET, USER, { ...s, speed: 'fast', seed: 7, identity }, Date.now(), ENV),
    });
    token = last.continue_token ?? null;
  }
  return last!;
}

test('plain: three continued calls of 4 games report what one run of 12 games reports', async () => {
  const cont = await chain(3, 4, { ...IDENTITY });
  const long = await runMatchups(PUPS, OPPS, { games: 12, seed: 7, budgetMs: 60_000, pilot: pilotFactory('fast') });
  assert.equal(cont.report.cumulative?.calls, 3);
  assert.equal(cont.report.gamesPlayed, long.report.gamesPlayed);
  assert.equal(cont.report.gamesPlayed, 24);
  assert.deepEqual(cont.report.overall, long.report.overall, 'the overall record, win rate and both splits');
  for (const [i, m] of cont.report.matchups.entries()) {
    const l = long.report.matchups[i]!;
    for (const k of ['played', 'record', 'winRate', 'goingFirst', 'goingSecond', 'avgTurns', 'winReasons', 'lossReasons', 'lossPatterns'] as const) {
      assert.deepEqual(m[k], l[k], `opponent ${i + 1}: ${k}`);
    }
    assert.deepEqual(m.setup.map((s) => ({ ...s, medianFirstAttack: null })), l.setup.map((s) => ({ ...s, medianFirstAttack: null })), 'opening-speed rates add up too');
  }
  assert.match(cont.text, /Cumulative over 3 calls: 24 games \(8 added by this call\)/);
  assert.match(cont.text, /win \d+% \[\d+–\d+%, n=\d+\]/);
  assert.ok(cont.text.length <= SIM_TEXT_LIMIT, `${cont.text.length} chars`);
  assert.match(cont.text, /\nContinue: for a bigger sample call again with the SAME inputs plus continue_token=sc1\.\S+ — new seeds, cumulative results \(3 of at most 12 calls\)/);
  assert.ok(cont.text.indexOf('Caveat:') < cont.text.indexOf('Continue:'), 'the caveat stays in the report; the continue line follows');
  assert.equal(cont.report.continuation?.calls, 3);
  assert.equal(cont.report.continuation?.token, cont.continue_token);
});

test('plain: the first call is the ordinary full report plus a token', async () => {
  const first = await chain(1, 4, { ...IDENTITY });
  assert.equal(first.report.cumulative, undefined);
  assert.match(first.text, /^SIMULATED BATTLES/);
  assert.match(first.text, /Card impact/);
  assert.match(first.text, /\(1 of at most 12 calls\)/);
  assert.ok(first.text.length <= SIM_TEXT_LIMIT);
  const none = await runMatchups(PUPS, OPPS, { games: 4, seed: 7, budgetMs: 60_000, pilot: pilotFactory('fast') });
  assert.equal(none.continue_token, undefined, 'no mint, no token, no continue line');
  assert.doesNotMatch(none.text, /Continue:/);
});

test('paired: continued comparison calls give the interval and verdict of one long comparison', async () => {
  const ident: ContinueIdentity = { ...IDENTITY, b: 'bbbb' };
  let token: string | null = null;
  let last: Awaited<ReturnType<typeof runComparison>> | null = null;
  for (let i = 0; i < 3; i++) {
    const prior = token ? openContinueToken(SECRET, USER, token, Date.now(), ENV) : null;
    last = await runComparison(PUPS, BIG, OPPS, {
      games: 8, seed: 5, budgetMs: 60_000, pilot: pilotFactory('fast'),
      ...(prior?.cmp ? { priorCompare: { calls: prior.calls, odd: prior.odd, totals: prior.cmp } } : {}),
      mint: (s) => mintContinueToken(SECRET, USER, { ...s, speed: 'fast', seed: 5, identity: ident }, Date.now(), ENV),
    });
    token = last.continue_token ?? null;
  }
  const long = await runComparison(PUPS, BIG, OPPS, { games: 24, seed: 5, budgetMs: 60_000, pilot: pilotFactory('fast') });
  const cont = last!;
  assert.equal(cont.report.cumulative?.calls, 3);
  assert.deepEqual(cont.report.overall, long.report.overall, 'the paired difference, its interval, the counts and the verdict — identical, not approximate');
  assert.deepEqual(cont.report.matchups, long.report.matchups);
  assert.deepEqual(cont.report.reportA.overall, long.report.reportA.overall);
  assert.deepEqual(cont.report.reportB.overall, long.report.reportB.overall);
  assert.equal(cont.report.gamesPlayed, 48);
  const lines = cont.text.split('\n');
  assert.match(lines[1]!, /^VERDICT: /);
  assert.equal(lines[1], long.text.split('\n')[1], 'the same verdict line');
  assert.match(cont.text, /Cumulative over 3 calls: 48 games per version \(16 added by this call\)/);
  assert.ok(cont.text.length <= SIM_TEXT_LIMIT, `${cont.text.length} chars`);
  assert.match(cont.text, /Continue: .*\(3 of at most 12 calls\)/);
});

test('the last allowed call gets no token, so a chain ends', async () => {
  const state = await realState();
  const out = await runMatchups(PUPS, OPPS, {
    games: 2, seed: 1, budgetMs: 60_000, pilot: pilotFactory('fast'), prior: { calls: CONTINUE_MAX_CALLS - 1, totals: state.totals },
    mint: (s) => (s.calls < CONTINUE_MAX_CALLS ? 'token' : null),
  });
  assert.equal(out.report.cumulative?.calls, CONTINUE_MAX_CALLS);
  assert.equal(out.continue_token, undefined);
  assert.doesNotMatch(out.text, /Continue:/);
});

test('token size: six opponents plain, eight opponents paired — small enough to sit in the text limit beside a report', async () => {
  const many = Array.from({ length: 8 }, (_, i) => deck(`Opp ${i + 1} (a longer archetype label, Limitless, 12-3)`, mon(`t-${10 + i}`, `Mon${i}`, 60 + i * 10, '30')));
  const ident = (n: number, b: string | null): ContinueIdentity => ({ subject: 'abcdefabcdef', b, opponents: Array.from({ length: n }, (_, i) => `fp${String(i).padStart(10, '0')}`), format: '' });
  const plain = await runMatchups(PUPS, many.slice(0, 6), {
    games: 4, seed: 2, budgetMs: 60_000, pilot: pilotFactory('fast'),
    mint: (s) => mintContinueToken(SECRET, USER, { ...s, speed: 'fast', seed: 2, identity: ident(6, null) }, Date.now(), ENV),
  });
  const cmp = await runComparison(PUPS, BIG, many, {
    games: 4, seed: 2, budgetMs: 60_000, pilot: pilotFactory('fast'),
    mint: (s) => mintContinueToken(SECRET, USER, { ...s, speed: 'fast', seed: 2, identity: ident(8, 'bbbbbbbbbbbb') }, Date.now(), ENV),
  });
  assert.ok(plain.continue_token!.length < 2500, `plain token ${plain.continue_token!.length}`);
  assert.ok(cmp.continue_token!.length < 4500, `paired token ${cmp.continue_token!.length}`);
  assert.ok(plain.text.length <= SIM_TEXT_LIMIT && cmp.text.length <= SIM_TEXT_LIMIT, `${plain.text.length} / ${cmp.text.length}`);
  assert.match(cmp.text, /VERDICT:/);
  assert.match(cmp.text, /Caveat:/);
  assert.ok(cmp.text.includes(cmp.continue_token!), 'the whole token is in the text, uncut');
});

test('odd games: calls of 3 add up to one run of 6 (the pair rounding is carried, not repeated)', async () => {
  const two = await chain(2, 3, { ...IDENTITY });
  const long = await runMatchups(PUPS, OPPS, { games: 6, seed: 7, budgetMs: 60_000, pilot: pilotFactory('fast') });
  assert.equal(two.report.gamesPlayed, long.report.gamesPlayed);
  assert.equal(two.report.gamesPlayed, 12, '6 games per opponent, two opponents');
  assert.deepEqual(two.report.overall, long.report.overall);
  for (const [i, m] of two.report.matchups.entries()) assert.deepEqual(m.record, long.report.matchups[i]!.record);
  const three = await chain(3, 3, { ...IDENTITY });
  const nine = await runMatchups(PUPS, OPPS, { games: 9, seed: 7, budgetMs: 60_000, pilot: pilotFactory('fast') });
  assert.equal(three.report.gamesPlayed, 20, '9 games rounds up to 10 per opponent, as one run of 9 does');
  assert.deepEqual(three.report.overall, nine.report.overall);
});

test('the parity rides in the signed token', async () => {
  const { state } = await realState();
  const back = openContinueToken(SECRET, USER, mintContinueToken(SECRET, USER, { ...state, odd: 1 }, Date.now(), ENV), Date.now(), ENV);
  assert.equal(back.odd, 1);
});

test('callPairs: the pairs the total needs', () => {
  assert.deepEqual(callPairs(3, 0), { pairs: 2, odd: 1 });
  assert.deepEqual(callPairs(3, 1), { pairs: 1, odd: 0 });
  assert.deepEqual(callPairs(24, 0), { pairs: 12, odd: 0 });
  assert.deepEqual(callPairs(2, 1), { pairs: 1, odd: 1 });
});
