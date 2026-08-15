import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../index.js';
import { closePool, pool } from '../db.js';

/**
 * Migration 019 deck intelligence — live-DB integration tests (Deck Intelligence
 * plan §2). Boots the real app on an ephemeral port and walks the whole
 * versioning lifecycle against the live deckpal DB:
 *
 *   create → card edits amend v1 in place (no logs yet) → battle log attaches to
 *   v1 → next card edit auto-bumps to v2 → versions list carries per-version W/L
 *   → revert applies the old snapshot through the same write path → strategy PUT
 *   never bumps → log CRUD → DELETE deck cascades everything away.
 *
 * Self-cleaning: everything hangs off one throwaway deck; `after` deletes it
 * (deck_version + battle_log cascade) even when a test fails mid-run. Tests run
 * serially in file order — the sequence IS the auto-bump rule, so ordering is
 * load-bearing.
 */

let server: http.Server;
let base: string;
let deckId: string;
let cardA: string; // tcgdex ids of two real catalog cards
let cardB: string;
let logId: number;

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}/deckpal/api${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

/** A minimal but well-formed Live log where 'TestOwner' plays cardA and wins. */
function winLog(myCardName: string): string {
  return [
    'Setup',
    'TestOwner drew 7 cards for the opening hand.',
    'Rival drew 7 cards for the opening hand.',
    "TestOwner's Turn",
    `TestOwner played ${myCardName} to the Active Spot.`,
    "Rival's Turn",
    'Rival played Dratini to the Active Spot.',
    'Rival conceded.',
  ].join('\n');
}

before(async () => {
  const app = createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Two real, distinct English prints — any will do; lowest ids keep it deterministic.
  const { rows } = await pool.query<{ tcgdex_id: string }>(
    `SELECT tcgdex_id FROM card WHERE lang = 'en' ORDER BY id LIMIT 2`,
  );
  assert.equal(rows.length, 2, 'catalog has at least two cards');
  cardA = rows[0]!.tcgdex_id;
  cardB = rows[1]!.tcgdex_id;
});

after(async () => {
  try {
    if (deckId) await api('DELETE', `/decks/${deckId}`); // cascade removes versions + logs
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    await closePool();
  }
});

test('POST /decks seeds version 1 with an empty snapshot', async () => {
  const { status, json } = await api('POST', '/decks', {
    name: '__deck-intel integration test__', formatCode: 'unlimited', source: 'test-suite',
  });
  assert.equal(status, 201);
  deckId = json.deck.id;
  assert.equal(json.deck.version, 1);
  assert.equal(json.deck.strategyMd, null);

  const versions = await api('GET', `/decks/${deckId}/versions`);
  assert.equal(versions.status, 200);
  assert.equal(versions.json.current, 1);
  assert.equal(versions.json.versions.length, 1);
  assert.equal(versions.json.versions[0].cardCount, 0);
  assert.equal(versions.json.versions[0].source, 'test-suite');
  assert.equal(versions.json.versions[0].isCurrent, true);
});

test('card edits with no battle logs amend v1 in place (no bump)', async () => {
  const add = await api('POST', `/decks/${deckId}/cards`, { cardId: cardA, quantity: 2, source: 'test-suite' });
  assert.equal(add.status, 201);
  assert.equal(add.json.deck.version, 1);

  // A second edit with a versionNote — still v1, note lands on the amended snapshot.
  const patch = await api('PATCH', `/decks/${deckId}/cards/${cardA}`, {
    quantity: 3, source: 'test-suite', versionNote: 'tuning before first battle',
  });
  assert.equal(patch.status, 200);
  assert.equal(patch.json.deck.version, 1);

  const versions = await api('GET', `/decks/${deckId}/versions`);
  assert.equal(versions.json.versions.length, 1, 'stepper noise collapses into one version');
  assert.equal(versions.json.versions[0].cardCount, 3);
  assert.equal(versions.json.versions[0].note, 'tuning before first battle');
});

test('POST /decks/:id/logs attaches to the current version; parser fills result/opponent', async () => {
  const { rows } = await pool.query<{ name: string }>(
    `SELECT c.name FROM card c WHERE c.tcgdex_id = $1 AND c.lang = 'en' LIMIT 1`, [cardA],
  );
  const { status, json } = await api('POST', `/decks/${deckId}/logs`, {
    rawLog: winLog(rows[0]!.name), source: 'test-suite',
  });
  assert.equal(status, 201);
  assert.equal(json.attachedToVersion, 1);
  assert.equal(json.log.result, 'win'); // from the concede line, not caller-supplied
  assert.equal(json.log.opponent, 'Rival');
  assert.equal(json.log.deckVersion, 1);
  assert.ok(json.log.parsed);
  logId = json.log.id;
});

test('an unparseable log with no playerName and no result is a 400', async () => {
  const { status, json } = await api('POST', `/decks/${deckId}/logs`, { rawLog: 'total nonsense, no players here' });
  assert.equal(status, 400);
  assert.equal(json.error.code, 'bad_request');
  assert.match(json.error.message, /playerName/);
});

test('the next card edit auto-bumps to v2 (current version has a battle log)', async () => {
  const { status, json } = await api('POST', `/decks/${deckId}/cards`, {
    cardId: cardB, quantity: 1, source: 'test-suite', versionNote: 'added a second attacker',
  });
  assert.equal(status, 201);
  assert.equal(json.deck.version, 2);

  const versions = await api('GET', `/decks/${deckId}/versions`);
  assert.equal(versions.json.current, 2);
  assert.equal(versions.json.versions.length, 2);
  const [v2, v1] = versions.json.versions; // newest first
  assert.equal(v2.version, 2);
  assert.equal(v2.isCurrent, true);
  assert.equal(v2.note, 'added a second attacker');
  assert.deepEqual(v1.battleLogs, { total: 1, wins: 1, losses: 0, ties: 0 });
  assert.deepEqual(v2.battleLogs, { total: 0, wins: 0, losses: 0, ties: 0 });
});

test('GET /decks/:id/versions/:v returns the snapshot with a diff vs the previous', async () => {
  const { status, json } = await api('GET', `/decks/${deckId}/versions/2`);
  assert.equal(status, 200);
  assert.equal(json.version, 2);
  assert.equal(json.isCurrent, true);
  assert.equal(json.cardCount, 4); // 3× cardA + 1× cardB
  assert.equal(json.diff.added.length, 1);
  assert.equal(json.diff.added[0].tcgdexId, cardB);
  assert.deepEqual(json.diff.removed, []);
  assert.deepEqual(json.diff.changed, []);
  // v1 has no predecessor → no diff.
  const v1 = await api('GET', `/decks/${deckId}/versions/1`);
  assert.equal(v1.json.diff, null);
});

test('GET /decks/:id/logs filters by version and carries totals', async () => {
  const all = await api('GET', `/decks/${deckId}/logs`);
  assert.equal(all.status, 200);
  assert.deepEqual(all.json.totals, { total: 1, wins: 1, losses: 0, ties: 0 });
  assert.equal(all.json.logs[0].id, logId);
  assert.equal(all.json.logs[0].deckVersion, 1);
  assert.equal(all.json.logs[0].turns, 2);
  assert.ok(!('rawLog' in all.json.logs[0]), 'summaries never include the raw log');

  const v2only = await api('GET', `/decks/${deckId}/logs?version=2`);
  assert.deepEqual(v2only.json.logs, []);
  assert.equal(v2only.json.totals.total, 0);
});

test('deck list rows carry version + all-versions record', async () => {
  const { status, json } = await api('GET', '/decks');
  assert.equal(status, 200);
  const row = json.decks.find((d: any) => d.id === deckId);
  assert.ok(row, 'test deck appears in the index');
  assert.equal(row.version, 2);
  assert.deepEqual(row.record, { wins: 1, losses: 0, ties: 0 });
});

test('revert with no logs on the current version amends v2 in place', async () => {
  // v2 has no battle logs → the LOCKED rule says revert AMENDS v2, no bump.
  const { status, json } = await api('POST', `/decks/${deckId}/revert`, { toVersion: 1, source: 'test-suite' });
  assert.equal(status, 200);
  assert.equal(json.deck.version, 2);
  assert.deepEqual(json.revert, { toVersion: 1, version: 2, bumped: false, skippedCards: [] });
  assert.equal(json.counts.total, 3, 'live list is back to the v1 snapshot (3× cardA)');

  const v2 = await api('GET', `/decks/${deckId}/versions/2`);
  assert.equal(v2.json.note, 'Reverted to v1');
});

test('revert bumps when the current version has logs; reverting to current is a 400', async () => {
  // Log a battle on v2, then revert to v1 again — now it must create v3.
  const log = await api('POST', `/decks/${deckId}/logs`, {
    rawLog: 'unparseable', result: 'loss', opponent: 'Rival', source: 'test-suite',
  });
  assert.equal(log.status, 201);
  assert.equal(log.json.attachedToVersion, 2);

  const { status, json } = await api('POST', `/decks/${deckId}/revert`, { toVersion: 1, source: 'test-suite' });
  assert.equal(status, 200);
  assert.equal(json.deck.version, 3);
  assert.equal(json.revert.bumped, true);

  const self = await api('POST', `/decks/${deckId}/revert`, { toVersion: 3 });
  assert.equal(self.status, 400);
});

test('PUT /decks/:id/strategy never bumps and lands on the current snapshot', async () => {
  const md = '# Hide and Sneak\n\nMulligan aggressively for the draw engine.';
  const { status, json } = await api('PUT', `/decks/${deckId}/strategy`, { strategyMd: md, source: 'deckpal-mcp' });
  assert.equal(status, 200);
  assert.equal(json.deck.version, 3, 'strategy edits never bump');
  assert.equal(json.deck.strategyMd, md);

  const v3 = await api('GET', `/decks/${deckId}/versions/3`);
  assert.equal(v3.json.strategyMd, md, 'current snapshot updated in place');
  const v1 = await api('GET', `/decks/${deckId}/versions/1`);
  assert.equal(v1.json.strategyMd, null, 'older snapshots untouched');

  // Clearing: null empties the guide.
  const cleared = await api('PUT', `/decks/${deckId}/strategy`, { strategyMd: null });
  assert.equal(cleared.json.deck.strategyMd, null);
});

test('battle log detail / patch / delete round-trip', async () => {
  const detail = await api('GET', `/decks/${deckId}/logs/${logId}`);
  assert.equal(detail.status, 200);
  assert.ok(detail.json.log.rawLog.includes('TestOwner'));
  assert.equal(detail.json.log.parsed.players.me, 'TestOwner');

  const patched = await api('PATCH', `/decks/${deckId}/logs/${logId}`, {
    opponentDeck: 'Dratini toolbox', notes: 'they bricked turn 1',
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.log.opponentDeck, 'Dratini toolbox');
  assert.equal(patched.json.log.notes, 'they bricked turn 1');
  assert.equal(patched.json.log.result, 'win', 'untouched fields survive');

  const missing = await api('PATCH', `/decks/${deckId}/logs/999999999`, { notes: 'x' });
  assert.equal(missing.status, 404);

  const del = await api('DELETE', `/decks/${deckId}/logs/${logId}`);
  assert.equal(del.status, 200);
  assert.equal(del.json.deleted, logId);
  const gone = await api('GET', `/decks/${deckId}/logs/${logId}`);
  assert.equal(gone.status, 404);
});

test('invalid source is a 400 on every deck write', async () => {
  for (const [method, path, body] of [
    ['POST', '/decks', { name: 'x', source: 'Not Valid' }],
    ['POST', `/decks/${deckId}/cards`, { cardId: cardA, source: '-bad' }],
    ['POST', `/decks/${deckId}/logs`, { rawLog: 'x', result: 'win', source: 'a'.repeat(41) }],
    ['PUT', `/decks/${deckId}/strategy`, { strategyMd: 'x', source: '' }],
  ] as const) {
    const { status, json } = await api(method, path, body);
    assert.equal(status, 400, `${method} ${path} must reject a bad source`);
    assert.equal(json.error.code, 'bad_request');
  }
});

test('DELETE /decks/:id cascades versions and battle logs away', async () => {
  const { status } = await api('DELETE', `/decks/${deckId}`);
  assert.equal(status, 200);
  const versions = await pool.query(`SELECT 1 FROM deck_version WHERE deck_id = $1`, [deckId]);
  const logs = await pool.query(`SELECT 1 FROM battle_log WHERE deck_id = $1`, [deckId]);
  assert.equal(versions.rows.length, 0);
  assert.equal(logs.rows.length, 0);
  deckId = ''; // nothing left for after() to clean
});
