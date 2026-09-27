import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildClientErrorLog } from '../routes/clientErrors.js';

/**
 * Unit tests for the pure shaping/truncation behind the client-error beacon
 * (QUAL-01's observability piece). No network, no DB — see
 * `routes/clientErrors.ts` for why the route itself is not wired through a
 * DB or GitHub the way `/bugs` is.
 *
 * Run: node --import tsx --test src/__tests__/clientErrors.test.ts
 */

const NOW = new Date('2026-09-26T12:00:00.000Z');

describe('buildClientErrorLog', () => {
  test('carries route, message, stack and buildId through unchanged when short', () => {
    const log = buildClientErrorLog(
      { route: '/decks/abc', message: 'Cannot read properties of undefined', stack: 'Error: boom\n  at x', buildId: 'deadbeef' },
      NOW,
    );
    assert.deepEqual(log, {
      route: '/decks/abc',
      message: 'Cannot read properties of undefined',
      stack: 'Error: boom\n  at x',
      buildId: 'deadbeef',
      ts: '2026-09-26T12:00:00.000Z',
    });
  });

  test('defaults route and message when missing; stack and buildId stay undefined', () => {
    const log = buildClientErrorLog({}, NOW);
    assert.equal(log.route, '(unknown)');
    assert.equal(log.message, '(no message)');
    assert.equal(log.stack, undefined);
    assert.equal(log.buildId, undefined);
  });

  test('a non-object body (null, array, string) is treated as empty, not an error', () => {
    for (const bad of [null, undefined, 'oops', 42, ['a']]) {
      const log = buildClientErrorLog(bad, NOW);
      assert.equal(log.route, '(unknown)');
      assert.equal(log.message, '(no message)');
    }
  });

  test('non-string fields are dropped rather than coerced', () => {
    const log = buildClientErrorLog({ route: 123, message: { evil: true }, stack: null, buildId: [] }, NOW);
    assert.equal(log.route, '(unknown)');
    assert.equal(log.message, '(no message)');
    assert.equal(log.stack, undefined);
    assert.equal(log.buildId, undefined);
  });

  test('truncates each field at its own limit', () => {
    const log = buildClientErrorLog(
      {
        route: 'x'.repeat(400),
        message: 'y'.repeat(600),
        stack: 'z'.repeat(5000),
        buildId: 'w'.repeat(200),
      },
      NOW,
    );
    assert.equal(log.route!.length, 300);
    assert.equal(log.message.length, 500);
    assert.equal(log.stack!.length, 4000);
    assert.equal(log.buildId!.length, 100);
  });

  test('unexpected extra fields on the body are never copied into the log', () => {
    const log = buildClientErrorLog(
      { route: '/x', message: 'm', userId: 'should-not-appear', email: 'nope@example.com', collection: [1, 2, 3] },
      NOW,
    );
    assert.deepEqual(Object.keys(log).sort(), ['buildId', 'message', 'route', 'stack', 'ts']);
  });

  test('ts reflects the injected clock, not wall time', () => {
    const log = buildClientErrorLog({}, new Date('2020-01-01T00:00:00.000Z'));
    assert.equal(log.ts, '2020-01-01T00:00:00.000Z');
  });
});
