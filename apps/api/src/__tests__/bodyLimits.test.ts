/**
 * SEC-08: body-size limits are per-route, not one 12mb parser for the whole
 * app. The subtlety that makes this worth an in-process HTTP test rather than
 * just reading the source: `express.json()` no-ops on a request whose body a
 * PRIOR matching parser already consumed (body-parser's own `req._body`
 * check) — so whichever parser matches a given path FIRST decides its limit,
 * and a later, more generous parser for the same path can never override a
 * smaller one mounted ahead of it. That is exactly how the pre-fix bug
 * happened (the blanket 12mb parser on `app` shadowed /register's and
 * /token's own 16kb parsers), and it is exactly the property these tests
 * exercise directly rather than trusting the reasoning about it.
 *
 * `index.ts`'s own source order is checked separately by the meta-test in
 * rateLimit.test.ts ("body-size and bugs limiters mount most-specific-first").
 * These tests prove the MECHANISM that ordering depends on actually behaves
 * the way that meta-test assumes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { errorMiddleware } from '../http.js';
import { mountOAuthServer } from '../oauthServer.js';

/** A body of roughly `bytes` bytes of valid JSON: {"text":"aaaa...a"}. */
function jsonBodyOfSize(bytes: number): string {
  const overhead = '{"text":""}'.length;
  const fill = 'a'.repeat(Math.max(0, bytes - overhead));
  return JSON.stringify({ text: fill });
}

/**
 * A body with exactly `chars` CHARACTERS (JS string length / UTF-16 code
 * units) of a real multibyte character, not bytes. This is the distinction
 * an earlier version of this PR's sizing got wrong: every character-count
 * cap in this codebase (STRATEGY_MAX, RAW_LOG_MAX, MAX_TEXT, …) is measured
 * in JS string length, but an `express.json()` limit is measured in UTF-8
 * BYTES on the wire. '戦' is one BMP character outside Latin-1 — one UTF-16
 * code unit, three UTF-8 bytes — the worst realistic ratio (astral/emoji
 * characters cost two code units for four bytes, a ratio of two, not three).
 */
function jsonBodyOfCharCount(field: string, chars: number): string {
  return JSON.stringify({ [field]: '戦'.repeat(chars) });
}

async function withServer(app: express.Express, run: (origin: string) => Promise<void>): Promise<void> {
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  try {
    await run(origin);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
}

function postJson(origin: string, path: string, body: string): Promise<Response> {
  return fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
}

// The exact per-route sizing this PR ships in index.ts, replicated here so
// the mechanism can be exercised without importing the real createApp() (and
// its live-DB dependencies: the RLS pool, admin bootstrap, model checks…).
function buildBodyLimitFixture(): express.Express {
  const app = express();
  app.use('/bugs', express.json({ limit: '12mb' }));
  app.use('/dev/scan-queue', express.json({ limit: '4mb' }));
  app.use('/dev/scan-flags', express.json({ limit: '4mb' }));
  app.use('/decke', express.json({ limit: '1mb' }));
  app.use('/lists', express.json({ limit: '1mb' }));
  app.use('/decks', express.json({ limit: '256kb' }));
  app.use(express.json({ limit: '100kb' }));
  const echo: express.RequestHandler = (req, res) => {
    const body = req.body as { text?: string; strategyMd?: string; rawLog?: string };
    res.status(200).json({ received: (body.text ?? body.strategyMd ?? body.rawLog)?.length ?? 0 });
  };
  for (const path of ['/bugs', '/dev/scan-queue', '/dev/scan-flags', '/decke', '/lists', '/decks', '/generic']) {
    app.post(path, echo);
  }
  app.use(errorMiddleware);
  return app;
}

describe('per-route body-size limits (SEC-08)', () => {
  it('the default (100kb) accepts a small body and rejects one just over it — as a proper 413, not a 500', async () => {
    const app = buildBodyLimitFixture();
    await withServer(app, async (origin) => {
      const ok = await postJson(origin, '/generic', jsonBodyOfSize(50_000));
      assert.equal(ok.status, 200);

      const tooBig = await postJson(origin, '/generic', jsonBodyOfSize(150_000));
      assert.equal(tooBig.status, 413, 'oversize body on the default parser must 413, not 500');
      assert.equal((await tooBig.json()).error.code, 'payload_too_large');
    });
  });

  it('/bugs accepts up to ~12mb — a size that would 413 on the 100kb default', async () => {
    const app = buildBodyLimitFixture();
    await withServer(app, async (origin) => {
      const big = await postJson(origin, '/bugs', jsonBodyOfSize(8_000_000)); // a real screenshot dataURL, well over 100kb
      assert.equal(big.status, 200, "/bugs's own 12mb parser must win over the 100kb default, not be shadowed by it");

      const tooBig = await postJson(origin, '/bugs', jsonBodyOfSize(13_000_000));
      assert.equal(tooBig.status, 413);
    });
  });

  it('/dev/scan-queue and /dev/scan-flags accept up to ~4mb', async () => {
    const app = buildBodyLimitFixture();
    await withServer(app, async (origin) => {
      for (const path of ['/dev/scan-queue', '/dev/scan-flags']) {
        const ok = await postJson(origin, path, jsonBodyOfSize(3_500_000));
        assert.equal(ok.status, 200, `${path}'s 4mb parser must accept a real labeler photo`);
        const tooBig = await postJson(origin, path, jsonBodyOfSize(4_500_000));
        assert.equal(tooBig.status, 413, `${path} must still cap at 4mb`);
      }
    });
  });

  it('/decke accepts up to ~1mb (MAX_TEXT x2 + MAX_TOOLS worth of tool records)', async () => {
    const app = buildBodyLimitFixture();
    await withServer(app, async (origin) => {
      const ok = await postJson(origin, '/decke', jsonBodyOfSize(700_000));
      assert.equal(ok.status, 200, "a worst-case transcript turn must fit /decke's 1mb parser");
      const tooBig = await postJson(origin, '/decke', jsonBodyOfSize(1_200_000));
      assert.equal(tooBig.status, 413);
    });
  });

  it('/decke accepts a real worst-case MULTIBYTE transcript turn (2x MAX_TEXT in Japanese)', async () => {
    // The regression review found: an earlier version of this parser was
    // sized by character count, but a limit here is measured in UTF-8
    // bytes, and a BMP character outside Latin-1 is 1 code unit but 3 bytes.
    // 24,000 Japanese characters in ONE field is already 3x the naive
    // estimate; deckeHistory.ts allows TWO such fields (asked + answered).
    const app = buildBodyLimitFixture();
    await withServer(app, async (origin) => {
      const body = JSON.stringify({ asked: '戦'.repeat(24_000), answered: '戦'.repeat(24_000) });
      const res = await fetch(origin + '/decke', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      assert.equal(res.status, 200, 'a legitimate Japanese transcript turn at both MAX_TEXT fields must not 413');
    });
  });

  it('/lists accepts up to ~1mb (BULK_MAX items x NOTE_MAX notes)', async () => {
    const app = buildBodyLimitFixture();
    await withServer(app, async (origin) => {
      const ok = await postJson(origin, '/lists', jsonBodyOfSize(700_000));
      assert.equal(ok.status, 200, "a worst-case bulk add must fit /lists's 1mb parser");
      const tooBig = await postJson(origin, '/lists', jsonBodyOfSize(1_200_000));
      assert.equal(tooBig.status, 413);
    });
  });

  it('/decks accepts a legitimate non-English strategy guide and battle log that the 100kb default would have rejected', async () => {
    // decks.ts's STRATEGY_MAX (40,000 chars) and RAW_LOG_MAX (50,000 chars)
    // are character counts, and at the x3 worst-case byte ratio a full-length
    // battle log is ~150kb on the wire — already over the 100kb default.
    // This is the exact route review found missing an exception at all.
    const app = buildBodyLimitFixture();
    await withServer(app, async (origin) => {
      const strategy = await fetch(origin + '/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonBodyOfCharCount('strategyMd', 40_000),
      });
      assert.equal(strategy.status, 200, 'a full-length multibyte strategy guide must not 413 on /decks');

      const log = await fetch(origin + '/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonBodyOfCharCount('rawLog', 50_000),
      });
      assert.equal(log.status, 200, 'a full-length multibyte battle log must not 413 on /decks');

      const tooBig = await postJson(origin, '/decks', jsonBodyOfSize(300_000));
      assert.equal(tooBig.status, 413, '/decks still caps at 256kb for anything genuinely oversized');
    });
  });

  it('regression control: reversing the mount order lets the blanket default shadow a named exception', async () => {
    // This is the actual failure mode SEC-08 fixes for /register and /token:
    // body-parser no-ops on an already-consumed body, so whichever parser for
    // a path runs FIRST wins. Mounting the small default BEFORE the named
    // exception (the wrong order) reproduces exactly that bug for /bugs here,
    // which is what makes the real ordering in index.ts load-bearing rather
    // than cosmetic.
    const app = express();
    app.use(express.json({ limit: '100kb' })); // wrong: default mounted first
    app.use('/bugs', express.json({ limit: '12mb' })); // now a no-op for any body the default already accepted or rejected
    app.post('/bugs', (req, res) => res.status(200).json({ received: (req.body as { text?: string }).text?.length ?? 0 }));
    app.use(errorMiddleware);
    await withServer(app, async (origin) => {
      const wouldBeFineOn12mb = await postJson(origin, '/bugs', jsonBodyOfSize(500_000));
      assert.equal(wouldBeFineOn12mb.status, 413, 'proves the bug: /bugs\'s 12mb parser is shadowed when mounted after the default');
    });
  });
});

describe('SEC-08: /register and /token — the dead-code fix, proven end to end', () => {
  it('/register rejects an oversize body with its own 413, never reaching the handler (no blanket parser upstream)', async () => {
    const app = express();
    mountOAuthServer(app); // exactly as index.ts now mounts it: nothing precedes it that reads the body
    app.use(errorMiddleware);
    await withServer(app, async (origin) => {
      const res = await postJson(origin, '/register', jsonBodyOfSize(20_000)); // over the 16kb limit in oauthServer.ts
      assert.equal(res.status, 413, "/register's own 16kb parser must now actually run and reject an oversize body");
    });
  });

  it('/token rejects an oversize body the same way', async () => {
    const app = express();
    mountOAuthServer(app);
    app.use(errorMiddleware);
    await withServer(app, async (origin) => {
      const res = await postJson(origin, '/token', jsonBodyOfSize(20_000));
      assert.equal(res.status, 413, "/token's own 16kb parser must now actually run and reject an oversize body");
    });
  });
});
