/**
 * The pilot measurements (scripts/pilot-agreement.ts, scripts/pilot-h2h.ts) rest on three things tested here:
 * watching a replay changes nothing about it; a pilot asked about a replayed position answers a legal option and
 * leaves the game untouched; and the tuning switches mean what the specs say.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { makePilot } from '../pilot/index.js';
import { DEFAULT_TUNING, tuningFor } from '../pilot/tuning.js';
import { replayLog, type ReplayObservation } from '../replay/replay.js';

const LOGS = ['hns-05.txt', 'tbs-58.txt'];
const read = (f: string): string => readFileSync(new URL(`./fixtures/live-logs/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function observe(f: string): { plain: ReturnType<typeof replayLog>; seen: ReplayObservation[]; withObs: ReturnType<typeof replayLog> } {
  const plain = replayLog(read(f));
  const withObs = replayLog(read(f), {
    observe: () => {
      const out: ReplayObservation[] = [];
      return {
        decision(o) {
          out.push({ ...o, game: o.game.clone(), decision: null as never });
          const last = out[out.length - 1] as ReplayObservation;
          last.decision = last.game.decision as never;
        },
        finish: () => out,
      };
    },
  });
  return { plain, seen: (withObs.observed ?? []) as ReplayObservation[], withObs };
}

test('observing a replay does not change it', () => {
  for (const f of LOGS) {
    const { plain, seen, withObs } = observe(f);
    assert.equal(withObs.replayed, plain.replayed, f);
    assert.equal(withObs.actions, plain.actions, f);
    assert.equal(withObs.divergence, plain.divergence, f);
    assert.equal(withObs.mismatches.length, plain.mismatches.length, f);
    assert.ok(seen.length > 20, `${f}: ${seen.length} observations`);
    assert.ok(seen.some((o) => o.decision.kind === 'main' && o.known && o.event), `${f}: no main-phase decision with its logged action`);
    for (const o of seen) assert.ok(o.choice.every((i) => i >= 0 && i < o.options.length), `${f}: logged choice out of range`);
  }
});

test('every pilot answers a replayed position with a legal option and leaves the game untouched', () => {
  const { seen } = observe('hns-05.txt');
  const mains = seen.filter((o) => o.known && o.decision.kind === 'main' && o.options.length > 1).slice(0, 25);
  assert.ok(mains.length > 10);
  for (const name of ['policy', 'greedy', 'search'] as const) {
    const pilot = makePilot(name, 5);
    for (const o of mains) {
      const g = o.game.clone();
      const before = JSON.stringify(g.state);
      const pick = pilot.choose(g, g.decision as never);
      assert.equal(pick.length, 1, name);
      assert.ok((pick[0] as number) >= 0 && (pick[0] as number) < o.options.length, `${name}: ${pick[0]} of ${o.options.length}`);
      assert.equal(JSON.stringify(g.state), before, `${name} changed the game it was asked about`);
    }
  }
});

test('tuning switches: on, off, and legacy', () => {
  const base = { ...DEFAULT_TUNING };
  assert.deepEqual(tuningFor([]), base);
  assert.equal(tuningFor(['x']).x, true);
  assert.equal(tuningFor(['x', '-x']).x, false);
  const all = tuningFor(Object.keys(base).concat('y', 'legacy'));
  for (const k of Object.keys(base)) assert.equal(all[k], false, k);
});

// ---------------------------------------------------------------------------
// What a search remembers across the decisions of a turn (the `reuse` switch)
// ---------------------------------------------------------------------------

test('publicKey: the opponent\'s hidden cards are not in it, what the player can see is', async () => {
  const { createContext } = await import('../context.js');
  const { Game } = await import('../game.js');
  const { cloneState } = await import('../state.js');
  const { publicKey } = await import('../pilot/lookahead.js');
  const { HIDE_N_SNEAK, TOOLBOX_SLOWKING } = await import('./decks.js');
  const ctx = createContext(HIDE_N_SNEAK, TOOLBOX_SLOWKING, { first: 0, maxTurns: 60 });
  const g = new Game(ctx, null, 7);
  g.start();
  const pilots = [makePilot('greedy', 1), makePilot('greedy', 2)];
  // Play into turn 4: both hands and boards are filled in.
  while (!g.over && g.state.turn < 4) g.submit((pilots[(g.decision as { player: 0 | 1 }).player] as ReturnType<typeof makePilot>).choose(g, g.decision as never));
  const env = { ctx, emit: null };
  const a = cloneState(g.state);
  const base = publicKey(env, a, 0);
  assert.equal(publicKey(env, cloneState(a), 0), base, 'a copy has the same key');
  // Swap a card of the opponent's hand with one of their deck: hidden from player 0, so the key must not move.
  const b = cloneState(a);
  const oh = b.p[1].hand;
  const od = b.p[1].deck;
  assert.ok(oh.length > 0 && od.length > 0);
  [oh[0], od[0]] = [od[0] as number, oh[0] as number];
  assert.equal(publicKey(env, b, 0), base, 'the opponent\'s hand contents are not in the key');
  // The same swap in player 0's own hand is visible to them.
  const c = cloneState(a);
  const mh = c.p[0].hand;
  const md = c.p[0].deck;
  const i = mh.findIndex((x, k) => ctx.cardDef[x] !== ctx.cardDef[md[0] as number] && k >= 0);
  assert.ok(i >= 0);
  [mh[i], md[0]] = [md[0] as number, mh[i] as number];
  assert.notEqual(publicKey(env, c, 0), base, 'my own hand contents are in the key');
  // A card moved from my hand to my discard pile is visible too.
  const d = cloneState(a);
  d.p[0].discard.push(d.p[0].hand.pop() as number);
  assert.notEqual(publicKey(env, d, 0), base);
});

test('the search pilot with reuse is deterministic and legal over whole games', async () => {
  const { createContext } = await import('../context.js');
  const { Game } = await import('../game.js');
  const { playOut } = await import('../play.js');
  const { HIDE_N_SNEAK, TOOLBOX_SLOWKING } = await import('./decks.js');
  const run = (): string => {
    const ctx = createContext(HIDE_N_SNEAK, TOOLBOX_SLOWKING, { first: 0, maxTurns: 14, events: true });
    const g = playOut(new Game(ctx, null, 21), [makePilot('search', 5), makePilot('search', 6)]);
    return JSON.stringify([g.state.winner, g.state.turn, g.events.length, g.events.slice(-30)]);
  };
  assert.equal(run(), run());
});
