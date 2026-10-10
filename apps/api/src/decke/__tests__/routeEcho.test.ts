import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROUTE_ECHO_PART, decisionFromEcho, readRouteEcho, routeEchoFor } from '../routeEcho.js';
import { decideTier } from '../tiers.js';
import type { Triage } from '../triage.js';

const triage = (pathway: Triage['pathway'], also: Triage['also'] = null): Triage => ({
  pathway, also, signals: [], missing: [], wantsDeep: 'no', source: 'model',
});
const clear = { guardFired: false, toolErrors: 0 };

test('the part name is the one the browser listens for', () => {
  assert.equal(ROUTE_ECHO_PART, 'data-decke-route');
});

test('a first leg\'s decision round-trips through the echo unchanged', () => {
  for (const t of [triage('navigate'), triage('deck_build'), triage('price_value', 'navigate')]) {
    const decision = decideTier({ triage: t, carried: clear, deepApproved: false });
    const echo = routeEchoFor(decision);
    assert.ok(echo, `no echo for ${t.pathway}`);
    assert.deepEqual(Object.keys(echo).sort(), ['effort', 'pathways', 'tier'], 'exactly the contract\'s three fields');
    // What the browser sends back is what it was given, so JSON is the honest wire.
    const back = readRouteEcho(JSON.parse(JSON.stringify(echo)));
    assert.deepEqual(back, echo);
    const reused = decisionFromEcho(back!);
    assert.deepEqual([reused.tier, reused.pathways, reused.effort], [decision.tier, decision.pathways, decision.effort]);
    assert.deepEqual(reused.reasons, ['echo']);
  }
});

test('Deep Think is never echoed and never accepted from the browser', () => {
  const deep = decideTier({ triage: triage('battle_review'), carried: clear, deepApproved: true });
  assert.equal(routeEchoFor(deep), null);
  assert.equal(readRouteEcho({ tier: 'deep', pathways: ['battle_review'], effort: 'high' }), null);
});

test('the echo is validated strictly; anything off is null, never partially trusted', () => {
  const ok = { tier: 'standard', pathways: ['deck_build'], effort: 'medium' };
  assert.deepEqual(readRouteEcho(ok), ok);
  assert.deepEqual(readRouteEcho({ ...ok, pathways: ['deck_build', 'battle_log'] })?.pathways, ['deck_build', 'battle_log']);
  for (const [why, value] of [
    ['absent', undefined],
    ['null', null],
    ['a string', 'standard'],
    ['an array', [ok]],
    ['unknown tier', { ...ok, tier: 'opus' }],
    ['missing tier', { pathways: ok.pathways, effort: ok.effort }],
    ['no pathways', { ...ok, pathways: [] }],
    ['three pathways', { ...ok, pathways: ['deck_build', 'battle_log', 'lists'] }],
    ['unknown pathway', { ...ok, pathways: ['deck_build', 'shopping'] }],
    ['duplicate pathways', { ...ok, pathways: ['lists', 'lists'] }],
    ['pathways not an array', { ...ok, pathways: 'deck_build' }],
    ['unknown effort', { ...ok, effort: 'max' }],
    ['extra key', { ...ok, deepApproved: true }],
  ] as const) {
    assert.equal(readRouteEcho(value), null, why);
  }
});
