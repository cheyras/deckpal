import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../index.js';
import { closePool, defaultUserId, pool } from '../db.js';

/**
 * Migration 018 attribution — live-DB integration tests (rotom-mcp SPEC §6).
 *
 * Boots the real app on an ephemeral port and exercises the collection write
 * path against the live pokedex DB. Self-cleaning: it targets one real variant,
 * remembers its starting quantity and the event-id high-water mark, and in
 * `after` restores the quantity (deltas sum to zero across the happy-path
 * tests anyway) and deletes only the event rows this run created
 * (id > watermark, scoped to the variant). Tests run serially in file order —
 * the sequence is +1 (default source) then −1 (explicit source), so ordering
 * is load-bearing.
 */

let server: http.Server;
let base: string;
let userId: number;
let variantId: number;
let startQty: number;
let eventWatermark: number;

interface EventJson {
  variantId: number;
  source: string;
  note: string | null;
  quantityDelta: number;
  newQuantity: number;
}

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}/pokedex/api${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

async function currentQty(): Promise<number> {
  const { rows } = await pool.query<{ quantity: number }>(
    'SELECT quantity FROM collection_item WHERE user_id = $1 AND card_variant_id = $2',
    [userId, variantId],
  );
  return rows[0]?.quantity ?? 0;
}

before(async () => {
  const app = createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  userId = await defaultUserId();
  // Any real primary variant works; lowest id keeps the pick deterministic.
  const v = await pool.query<{ id: string }>('SELECT id FROM card_variant WHERE is_primary ORDER BY id LIMIT 1');
  assert.ok(v.rows[0], 'catalog has at least one primary variant');
  variantId = Number(v.rows[0]!.id);
  startQty = await currentQty();
  const wm = await pool.query<{ max: string | null }>('SELECT max(id) AS max FROM collection_event');
  eventWatermark = Number(wm.rows[0]?.max ?? 0);
});

after(async () => {
  try {
    // Restore the starting quantity (no-op event-wise if already there), then
    // remove every event row this run appended for the target variant.
    await api('PATCH', `/collection/variants/${variantId}`, { quantity: startQty, source: 'test-cleanup' });
    await pool.query(
      'DELETE FROM collection_event WHERE user_id = $1 AND card_variant_id = $2 AND id > $3',
      [userId, variantId, eventWatermark],
    );
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    await closePool();
  }
});

/** Newest event rows for the target variant (other writers may interleave). */
async function eventsForVariant(query = ''): Promise<EventJson[]> {
  const { status, json } = await api('GET', `/collection/events?limit=20${query}`);
  assert.equal(status, 200);
  return (json.events as EventJson[]).filter((e) => e.variantId === variantId);
}

// (a) write without source → attributed to 'web' (the column/API default)
test('increment without source → event source defaults to web', async () => {
  const { status, json } = await api('POST', `/collection/variants/${variantId}/increment`, {});
  assert.equal(status, 200);
  assert.equal(json.quantity, startQty + 1);

  const [ev] = await eventsForVariant();
  assert.ok(ev, 'events feed has the new row');
  assert.equal(ev!.quantityDelta, 1);
  assert.equal(ev!.source, 'web');
  assert.equal(ev!.note, null);
});

// (b) explicit source + note round-trip (note trimmed on the way in)
test('increment with source=rotom-mcp + note round-trips through the events feed', async () => {
  const { status, json } = await api('POST', `/collection/variants/${variantId}/increment`, {
    delta: -1,
    source: 'rotom-mcp',
    note: '  pulled from a Stellar Crown pack  ',
  });
  assert.equal(status, 200);
  assert.equal(json.quantity, startQty); // deltas sum to zero across (a)+(b)

  const [ev] = await eventsForVariant();
  assert.ok(ev);
  assert.equal(ev!.quantityDelta, -1);
  assert.equal(ev!.source, 'rotom-mcp');
  assert.equal(ev!.note, 'pulled from a Stellar Crown pack');
});

// (c) ?source= filter is an exact match
test('GET /collection/events?source=rotom-mcp filters to that source', async () => {
  const { status, json } = await api('GET', '/collection/events?source=rotom-mcp&limit=20');
  assert.equal(status, 200);
  const events = json.events as EventJson[];
  assert.ok(events.length >= 1, 'at least the event from (b)');
  for (const ev of events) assert.equal(ev.source, 'rotom-mcp');
  assert.ok(events.some((e) => e.variantId === variantId));

  // And a filter that matches nothing returns an empty feed, not an error.
  const none = await api('GET', '/collection/events?source=no-such-writer-zzz&limit=5');
  assert.equal(none.status, 200);
  assert.deepEqual(none.json.events, []);
});

// (d) invalid source → 400 via the house error envelope, nothing written
test('invalid source rejected with 400 and writes nothing', async () => {
  const qtyBefore = await currentQty();

  for (const bad of ['Rotom MCP', '-starts-with-dash', 'a'.repeat(41), '']) {
    const { status, json } = await api('POST', `/collection/variants/${variantId}/increment`, { delta: 1, source: bad });
    assert.equal(status, 400, `source ${JSON.stringify(bad)} must be rejected`);
    assert.equal(json.error.code, 'bad_request');
  }

  assert.equal(await currentQty(), qtyBefore, 'rejected writes must not change quantity');

  // The read-side filter enforces the same shape.
  const filtered = await api('GET', '/collection/events?source=Not%20Valid');
  assert.equal(filtered.status, 400);
  assert.equal(filtered.json.error.code, 'bad_request');
});
