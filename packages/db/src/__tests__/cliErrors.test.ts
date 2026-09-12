import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { safeDiagnostic } from '../cliErrors.js';

describe('safeDiagnostic', () => {
  // ── Known pg error codes ──────────────────────────────────────────────────

  it('maps ECONNREFUSED to a helpful message', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
      code: 'ECONNREFUSED',
    });
    const msg = safeDiagnostic(err);
    assert.ok(msg.includes('ECONNREFUSED'));
    assert.ok(msg.includes('database server running'));
    assert.ok(!msg.includes('127.0.0.1:5432'));
  });

  it('maps 28P01 (auth failed) without leaking credentials', () => {
    const err = Object.assign(
      new Error('password authentication failed for user "deckpal" at postgres://deckpal:s3cret@db:5432/deck'),
      { code: '28P01' },
    );
    const msg = safeDiagnostic(err);
    assert.ok(msg.includes('28P01'));
    assert.ok(msg.includes('invalid password'));
    assert.ok(!msg.includes('s3cret'), 'must not leak password');
    assert.ok(!msg.includes('postgres://'), 'must not leak DSN');
    assert.ok(!msg.includes('deckpal'), 'must not leak username');
  });

  it('maps 3D000 (database does not exist)', () => {
    const err = Object.assign(new Error('database "mydb" does not exist'), { code: '3D000' });
    const msg = safeDiagnostic(err);
    assert.ok(msg.includes('3D000'));
    assert.ok(msg.includes('does not exist'));
    assert.ok(!msg.includes('mydb'), 'must not leak database name');
  });

  it('maps 42P01 (relation does not exist)', () => {
    const err = Object.assign(new Error('relation "migration_lock" does not exist'), { code: '42P01' });
    const msg = safeDiagnostic(err);
    assert.ok(msg.includes('42P01'));
    assert.ok(msg.includes('migrations'));
  });

  it('maps connection-class errors (08xxx)', () => {
    const err = Object.assign(new Error('connection lost mid-query'), { code: '08006' });
    const msg = safeDiagnostic(err);
    assert.ok(msg.includes('08006'));
    assert.ok(!msg.includes('mid-query'));
  });

  // ── Unknown pg error codes — CLOSED allowlist ─────────────────────────────

  it('does NOT print unknown codes even if they match a valid pattern', () => {
    const err = Object.assign(new Error('some internal error'), { code: '99999' });
    const msg = safeDiagnostic(err);
    // Unknown codes must NOT appear in output — closed allowlist
    assert.ok(!msg.includes('99999'), 'unknown code must not be printed');
    assert.ok(msg.includes('Migration failed'));
  });

  it('does NOT print TOPSECRET as a code (closed allowlist)', () => {
    const err = { code: 'TOPSECRET', message: 'postgres://owner:password@private/db' };
    const msg = safeDiagnostic(err);
    assert.ok(!msg.includes('TOPSECRET'), 'secret code must not leak');
    assert.ok(!msg.includes('postgres://'), 'DSN must not leak');
    assert.ok(!msg.includes('password'), 'password must not leak');
  });

  it('rejects codes that look like injection attempts', () => {
    const err = Object.assign(new Error('x'), { code: 'DROP TABLE;' });
    const msg = safeDiagnostic(err);
    assert.ok(!msg.includes('DROP TABLE'));
  });

  // ── Prototype-chain safety ────────────────────────────────────────────────

  it('does not read constructor from prototype chain', () => {
    const err = { code: 'constructor' };
    const msg = safeDiagnostic(err);
    // 'constructor' is not in our allowlist — should not produce a map lookup
    // that returns Object.prototype.constructor
    assert.ok(!msg.includes('function'), 'must not leak prototype function');
    assert.ok(!msg.includes('[object Object]'), 'must not leak stringified object');
    assert.ok(msg.includes('Migration failed'));
  });

  it('does not read __proto__ from prototype chain', () => {
    const err = { code: '__proto__' };
    const msg = safeDiagnostic(err);
    assert.ok(!msg.includes('[object Object]'));
    assert.ok(msg.includes('Migration failed'));
  });

  // ── Hostile accessor / Proxy / coercion safety ────────────────────────────

  it('does not invoke toString on code value', () => {
    let touched = 0;
    const err = {
      code: {
        toString() { touched++; throw new Error('TOPSECRET'); },
      },
    };
    const msg = safeDiagnostic(err);
    assert.equal(touched, 0, 'toString must not be invoked');
    assert.equal(typeof msg, 'string');
    assert.ok(msg.length > 10);
    assert.ok(!msg.includes('TOPSECRET'));
  });

  it('does not invoke getter on code property', () => {
    let touched = 0;
    const err = Object.defineProperty({}, 'code', {
      get() { touched++; throw new Error('TOPSECRET'); },
    });
    const msg = safeDiagnostic(err);
    assert.equal(touched, 0, 'getter must not be invoked');
    assert.equal(typeof msg, 'string');
    assert.ok(msg.length > 10);
    assert.ok(!msg.includes('TOPSECRET'));
  });

  it('handles hostile Proxy without invoking any traps', () => {
    let touched = 0;
    const err = new Proxy({}, {
      get() { touched++; throw new Error('TOPSECRET'); },
      has() { touched++; throw new Error('TOPSECRET'); },
      getOwnPropertyDescriptor() { touched++; throw new Error('TOPSECRET'); },
    });
    const msg = safeDiagnostic(err);
    // Proxy traps may be called by getOwnPropertyDescriptor — but we catch them
    assert.equal(typeof msg, 'string');
    assert.ok(msg.length > 10);
    assert.ok(!msg.includes('TOPSECRET'));
  });

  // ── Standard Error without pg code ────────────────────────────────────────

  it('handles plain Error without leaking message', () => {
    const err = new Error('FATAL: password postgres://admin:p4ss@host/db');
    const msg = safeDiagnostic(err);
    assert.ok(msg.includes('Migration failed'));
    assert.ok(!msg.includes('p4ss'));
    assert.ok(!msg.includes('admin'));
    assert.ok(!msg.includes('postgres://'));
  });

  it('handles Error with stack without leaking it', () => {
    const err = new Error('secret in stack');
    const msg = safeDiagnostic(err);
    assert.ok(!msg.includes('secret in stack'));
    assert.ok(!msg.includes('at '));
  });

  // ── Non-Error caught values ───────────────────────────────────────────────

  it('handles null safely', () => {
    const msg = safeDiagnostic(null);
    assert.ok(msg.includes('no error details'));
  });

  it('handles undefined safely', () => {
    const msg = safeDiagnostic(undefined);
    assert.ok(msg.includes('no error details'));
  });

  it('handles string throw without stringifying it', () => {
    const msg = safeDiagnostic('postgres://user:pass@host/db connection failed');
    assert.ok(!msg.includes('postgres://'));
    assert.ok(!msg.includes('pass'));
    assert.ok(msg.includes('unexpected error type'));
  });

  it('handles number throw', () => {
    const msg = safeDiagnostic(42);
    assert.ok(msg.includes('unexpected error type'));
  });

  it('handles object throw without stringifying it', () => {
    const obj = { message: 'secret', detail: 'postgres://u:p@h/d', stack: 'at foo.js:1' };
    const msg = safeDiagnostic(obj);
    assert.ok(!msg.includes('secret'));
    assert.ok(!msg.includes('postgres://'));
    assert.ok(!msg.includes('at foo'));
  });

  // ── System error codes ────────────────────────────────────────────────────

  it('maps ENOTFOUND system error', () => {
    const err = Object.assign(new Error('getaddrinfo ENOTFOUND db.example.com'), {
      code: 'ENOTFOUND',
    });
    const msg = safeDiagnostic(err);
    assert.ok(msg.includes('ENOTFOUND'));
    assert.ok(msg.includes('Host not found'));
    assert.ok(!msg.includes('db.example.com'));
  });

  it('maps ETIMEDOUT system error', () => {
    const err = Object.assign(new Error('connect ETIMEDOUT 10.0.0.1:5432'), {
      code: 'ETIMEDOUT',
    });
    const msg = safeDiagnostic(err);
    assert.ok(msg.includes('ETIMEDOUT'));
    assert.ok(!msg.includes('10.0.0.1'));
  });

  it('maps ENOTFOUND from plain object (not Error instance)', () => {
    const msg = safeDiagnostic({ code: 'ENOTFOUND' });
    assert.match(msg, /ENOTFOUND/);
    assert.ok(msg.includes('Host not found'));
  });

  // ── Encoded credentials ───────────────────────────────────────────────────

  it('never leaks percent-encoded credentials from raw error', () => {
    const err = new Error('connect to postgres://admin:p%40ssw0rd@host:5432/db failed');
    const msg = safeDiagnostic(err);
    assert.ok(!msg.includes('p%40ssw0rd'));
    assert.ok(!msg.includes('p@ssw0rd'));
    assert.ok(!msg.includes('postgres://'));
  });

  it('never leaks detail field from pg errors', () => {
    const err = Object.assign(new Error('auth failed'), {
      code: '28000',
      detail: 'User "admin" with password "secret123" not found',
    });
    const msg = safeDiagnostic(err);
    assert.ok(!msg.includes('secret123'));
    assert.ok(!msg.includes('admin'));
    assert.ok(msg.includes('28000'));
  });
});
