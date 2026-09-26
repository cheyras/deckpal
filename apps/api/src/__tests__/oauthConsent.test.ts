import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import { classifyRedirect, connectionName } from '@deckpal/db';
import { enforceTokenScope } from '../auth.js';

/**
 * Security audit SEC-07, the server's half. Anyone can register an OAuth app
 * named "Claude", so who is asking is decided by where the approval is sent,
 * and a read-only connection is refused every write before any route runs.
 *
 * Run: node --import tsx --test src/__tests__/oauthConsent.test.ts
 */

describe('classifyRedirect: who the approval really goes to', () => {
  test("Claude's documented callback is verified, on either Anthropic domain", () => {
    assert.deepEqual(classifyRedirect('https://claude.ai/api/mcp/auth_callback'), {
      host: 'claude.ai',
      trust: 'verified',
      verifiedName: 'Claude',
    });
    assert.equal(classifyRedirect('https://claude.com/api/mcp/auth_callback').trust, 'verified');
    // Case and a default port change nothing about where the browser goes.
    assert.equal(classifyRedirect('HTTPS://CLAUDE.AI:443/api/mcp/auth_callback').trust, 'verified');
  });

  test('a lookalike is unverified however it names itself, and is named by its host', () => {
    assert.deepEqual(classifyRedirect('https://evil.example/cb'), {
      host: 'evil.example',
      trust: 'unverified',
      verifiedName: null,
    });
    assert.equal(classifyRedirect('https://claude.ai.evil.example/api/mcp/auth_callback').trust, 'unverified');
    assert.equal(classifyRedirect('https://evilclaude.ai/api/mcp/auth_callback').trust, 'unverified');
  });

  test('only the exact callback is verified, not any path on the host', () => {
    // A host match would badge a path that forwarded the code on elsewhere.
    for (const uri of [
      'https://claude.ai/some/other/path',
      'https://claude.ai/api/mcp/auth_callback?next=https://evil.example',
      'https://claude.ai/api/mcp/auth_callback/',
      'https://user@claude.ai/api/mcp/auth_callback',
      'http://claude.ai/api/mcp/auth_callback',
    ]) {
      const r = classifyRedirect(uri);
      assert.notEqual(r.trust, 'verified', uri);
      assert.equal(r.verifiedName, null, uri);
    }
  });

  test('loopback callbacks are "this computer", never verified', () => {
    for (const uri of ['http://localhost:3118/callback', 'http://127.0.0.1:9999/cb', 'http://[::1]:5000/cb']) {
      assert.equal(classifyRedirect(uri).trust, 'local', uri);
    }
    assert.equal(classifyRedirect('http://localhost:3118/callback').host, 'localhost:3118');
  });

  test('an unparseable redirect is unverified, not an exception', () => {
    assert.equal(classifyRedirect('not a url').trust, 'unverified');
  });
});

describe('connectionName: what Profile lists the connection as', () => {
  test('always says where the approval went', () => {
    assert.equal(connectionName('claudeai', 'https://claude.ai/api/mcp/auth_callback'), 'Claude (OAuth · claude.ai)');
    assert.equal(connectionName('Claude', 'https://evil.example/cb'), 'Claude (OAuth · evil.example)');
    assert.equal(connectionName('Claude Code', 'http://localhost:3118/callback'), 'Claude Code (OAuth · this computer)');
  });

  test('a verified callback is named by us, not by what the app registered as', () => {
    assert.equal(connectionName('Totally Legit', 'https://claude.ai/api/mcp/auth_callback'), 'Claude (OAuth · claude.ai)');
  });

  test('a long claimed name gives way before the host does, within the 60-character limit', () => {
    const name = connectionName('A'.repeat(80), 'https://connector.evil.example/cb');
    assert.ok(name.length <= 60, name);
    assert.ok(name.endsWith('(OAuth · connector.evil.example)'), name);
  });

  test('an empty claimed name is not an empty label', () => {
    assert.equal(connectionName('   ', 'https://evil.example/cb'), 'MCP client (OAuth · evil.example)');
    assert.equal(connectionName(null, 'https://evil.example/cb'), 'MCP client (OAuth · evil.example)');
  });
});

describe('enforceTokenScope: a read-only connection changes nothing', () => {
  function run(req: Partial<Request>): { status?: number; body?: unknown; header?: string; passed: boolean } {
    const out: { status?: number; body?: unknown; header?: string; passed: boolean } = { passed: false };
    const res = {
      setHeader: (_: string, v: string) => (out.header = v),
      status(code: number) {
        out.status = code;
        return this;
      },
      json(body: unknown) {
        out.body = body;
        return this;
      },
    } as unknown as Response;
    enforceTokenScope(req as Request, res, (() => (out.passed = true)) as NextFunction);
    return out;
  }

  test('reads pass', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      assert.equal(run({ method, authKind: 'token', tokenScope: 'read' }).passed, true, method);
    }
  });

  test('every write is refused with 403 insufficient_scope, before any route', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const r = run({ method, authKind: 'token', tokenScope: 'read' });
      assert.equal(r.passed, false, method);
      assert.equal(r.status, 403);
      assert.equal((r.body as { error: { code: string } }).error.code, 'insufficient_scope');
      assert.equal(r.header, 'Bearer error="insufficient_scope"');
    }
  });

  test('full tokens, sessions and the self-host user are untouched', () => {
    assert.equal(run({ method: 'DELETE', authKind: 'token', tokenScope: 'full' }).passed, true);
    assert.equal(run({ method: 'DELETE', authKind: 'jwt' }).passed, true);
    assert.equal(run({ method: 'POST', authKind: 'local' }).passed, true);
    assert.equal(run({ method: 'POST' }).passed, true);
  });
});
