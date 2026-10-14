/**
 * Since 2026-10-14 a stored PTCG Live log reaches the parser from an API route (the battle digest), so a crafted line
 * must not make its multi-group patterns backtrack for seconds (CodeQL js/polynomial-redos on #342). Live's own lines
 * are a couple of hundred characters; longer ones are skipped as not Live's.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { LIVE_BULLET_MAX, LIVE_LINE_MAX, parseLiveLog } from '../replay/liveLog.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'live-logs');

test('a crafted log of long ambiguous lines is skipped fast, each counted as unrecognised', () => {
  const lines = [
    "PlayerA's " + 'a used '.repeat(3_000) + 'x',
    "PlayerA's " + 'a used a on '.repeat(2_000) + 'x',
    'a was switched with '.repeat(2_000) + 'x',
    '   • ' + 'x, '.repeat(3_000),
  ];
  const raw = "PlayerA's Turn\n" + Array.from({ length: 30 }, (_, i) => lines[i % lines.length]).join('\n');
  const t0 = Date.now();
  const r = parseLiveLog(raw);
  assert.ok(Date.now() - t0 < 500, `took ${Date.now() - t0} ms`);
  assert.ok(r.unknown.count >= 30, `${r.unknown.count} unrecognised`);
});

test("every line of every real log is within the limits (the limits never cut Live's own text)", () => {
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.txt'))) {
    for (const line of readFileSync(join(dir, f), 'utf8').split(/\r?\n/)) {
      const bullet = /^\s*•/.test(line);
      assert.ok(line.length <= (bullet ? LIVE_BULLET_MAX : LIVE_LINE_MAX), `${f}: ${line.length} chars`);
    }
  }
});
