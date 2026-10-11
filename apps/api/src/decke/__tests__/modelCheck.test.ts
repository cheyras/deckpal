/**
 * The check that would have caught a phantom model id months earlier.
 *
 * `MODELS.research.id` was `openai/o3-deep-research`, which is not on the
 * Gateway key. It typechecked, built, passed CI, passed review twice, and
 * failed every single call with a 404 that was framed as an answer. Six ways to
 * not notice; this is the seventh.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkModels,
  configuredModelIds,
  modelCheckStatus,
  modelCheckWarning,
} from '../modelCheck.js';
import { MODELS } from '../models.js';

/** A Gateway that has exactly these ids. */
const gatewayWith = (ids: string[]): typeof fetch =>
  (async () =>
    ({
      ok: true,
      json: async () => ({ data: ids.map((id) => ({ id })) }),
    }) as unknown as Response) as unknown as typeof fetch;

test('every configured id is checked — primary, fallback AND escalate', () => {
  const ids = configuredModelIds();
  // A fallback nobody verified is a fallback that fails exactly when needed,
  // which is the failure mode of the row this file was written for.
  assert.ok(ids.includes('perplexity/sonar'), 'the research primary');
  // sonar-pro left the Gateway catalogue (2026-10-10); research has no fallback.
  assert.ok(!ids.includes('perplexity/sonar-pro'), 'a model the Gateway no longer lists');
  assert.ok(ids.includes('anthropic/claude-opus-5'), 'an escalate target');
  assert.ok(ids.includes('typesafe-ai/jev'), 'the judgment model, which fails open and so fails silently');
  assert.ok(ids.includes('anthropic/claude-sonnet-5.5'), 'the chat primary');
  assert.equal(new Set(ids).size, ids.length, 'ids are deduplicated');
});

test('chat has room to plan and emit a complete deck', () => {
  assert.equal(MODELS.chat.id, 'anthropic/claude-sonnet-5.5');
  assert.equal(MODELS.chat.fallback, 'google/gemini-2.5-flash');
  assert.equal(MODELS.chat.maxOutputTokens, 8_000);
});

test('the phantom id is caught', async () => {
  const real = configuredModelIds().filter((i) => i !== 'perplexity/sonar');
  const c = await checkModels('k', gatewayWith(real));
  assert.deepEqual(c.missing, ['perplexity/sonar']);
  assert.equal(modelCheckStatus(c).status, 'missing');
  const w = modelCheckWarning(c);
  assert.ok(w);
  // NAMES IT. "One model is wrong" without saying which is a puzzle.
  assert.match(w, /perplexity\/sonar/);
  assert.match(w, /DO NOT EXIST/);
});

test('a healthy deployment is silent', async () => {
  const c = await checkModels('k', gatewayWith(configuredModelIds()));
  assert.deepEqual(c.missing, []);
  assert.equal(modelCheckStatus(c).status, 'ok');
  assert.equal(modelCheckWarning(c), null, 'a healthy deployment must not add noise');
});

test('an EMPTY catalogue is "unverified", never "everything is missing"', async () => {
  // A response-shape change must not report five missing models. A false alarm
  // that loud trains people to ignore this check, which costs more than the
  // check is worth.
  const c = await checkModels('k', gatewayWith([]));
  assert.deepEqual(c.missing, []);
  assert.equal(modelCheckStatus(c).status, 'unverified');
  assert.match(modelCheckWarning(c) ?? '', /could not verify/);
});

test('an unreachable Gateway is reported, not treated as healthy', async () => {
  const dead = (async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch;
  const c = await checkModels('k', dead);
  assert.equal(modelCheckStatus(c).status, 'unverified');
  assert.match(c.unreachable ?? '', /ECONNREFUSED/);
});

test('a non-200 from the Gateway is reported', async () => {
  const denied = (async () => ({ ok: false, status: 401 }) as unknown as Response) as unknown as typeof fetch;
  const c = await checkModels('k', denied);
  assert.equal(modelCheckStatus(c).status, 'unverified');
  assert.match(c.unreachable ?? '', /401/);
});

test('no key means unverified rather than a crash', async () => {
  const c = await checkModels(null);
  assert.equal(modelCheckStatus(c).status, 'unverified');
  assert.ok(c.checked > 0, 'it still knows how many it would have checked');
});

test('the health payload names the missing ids', async () => {
  // Deliberately UNLIKE the entitlement block, which never returns its list:
  // that holds user uuids and /health is unauthenticated. A model id is a
  // public product name and naming it is the entire use of the check.
  const real = configuredModelIds().filter((i) => i !== 'perplexity/sonar');
  const s = modelCheckStatus(await checkModels('k', gatewayWith(real)));
  assert.deepEqual(s.missing, ['perplexity/sonar']);
});
