/**
 * Invoked only by scripts/test-db-integration.mjs in a sanitized fresh process.
 * All route queries and tool self-hops below are real; only catalog/price seed
 * data and anonymous identity are fixtures. This does not test auth/RLS policy.
 */
import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const root = process.env.DECKPAL_TEST_ROOT;
assert.ok(root && /^\/tmp\/deckpal-db-[^/]+$/.test(root), 'This child requires a runner-owned disposable root.');
assert.equal(realpathSync(root), root);
assert.equal(readFileSync(join(root, '.deckpal-ci-owner'), 'utf8'), process.env.DECKPAL_TEST_MARKER);
assert.equal(process.env.PGHOST, join(root, 'socket'));
assert.equal(process.env.PGPORT, '55432');
assert.equal(process.env.PGDATABASE, 'deckpal_ci_test');
assert.equal(process.env.PGUSER, 'deckpal_ci_fixture');
assert.equal(process.env.PGSSLMODE, 'disable');
assert.equal(process.env.DATABASE_URL, undefined);
assert.ok(!Object.keys(process.env).some((key) => /^SUPABASE/.test(key)), 'Supabase environment must not reach integration imports.');
assert.equal(dirname(process.env.DECKPAL_TEST_RESULT), root);
try {
  lstatSync(join(REPO, '.env'));
  throw new Error('Refusing integration imports: repo-root .env exists; its contents were not read.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const { default: pg } = await import('pg');
const client = new pg.Client({
  host: join(root, 'socket'), port: 55432,
  user: 'deckpal_ci_fixture', database: 'deckpal_ci_test',
  password: '', ssl: false, connectionTimeoutMillis: 5000,
});
let server;
let pool;
const RealDate = globalThis.Date;
const originalFetch = globalThis.fetch;
const evidence = { timezone: process.env.TZ, status: 'running', cases: [] };
try {
  await client.connect();
  // Verify the real target BEFORE any fixture DDL. The fixture role has only
  // pg_read_all_settings beyond database ownership so it can prove this target.
  const identity = (await client.query(`
    SELECT current_database() AS database, current_user AS role,
           inet_server_addr() AS tcp_address,
           current_setting('data_directory') AS data_directory,
           current_setting('unix_socket_directories') AS socket_directory,
           current_setting('listen_addresses') AS listen_addresses,
           current_setting('server_version') AS postgres_version,
           (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser`
  )).rows[0];
  assert.equal(identity.database, 'deckpal_ci_test');
  assert.equal(identity.role, 'deckpal_ci_fixture');
  assert.equal(identity.superuser, false);
  assert.equal(identity.tcp_address, null);
  assert.equal(realpathSync(identity.data_directory), join(root, 'data'));
  assert.equal(identity.socket_directory, join(root, 'socket'));
  assert.equal(identity.listen_addresses, '');
  evidence.connection = identity;
  await client.query(readFileSync(join(HERE, 'fixture.sql'), 'utf8'));

  const dateControl = await client.query(`
    SELECT DATE '2026-09-16' AS native_date,
           to_char(DATE '2026-09-16', 'YYYY-MM-DD') AS calendar_date,
           to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today`);
  const control = dateControl.rows[0];
  assert.equal(dateControl.fields[0].dataTypeID, 1082);
  assert.equal(dateControl.fields[1].dataTypeID, 25);
  assert.ok(control.native_date instanceof RealDate);
  assert.equal(control.calendar_date, '2026-09-16');
  assert.match(control.native_date.toJSON(), /^2026-09-16T/);
  evidence.cases.push({
    name: 'real_postgres_date_oid_boundary',
    nativeOid: dateControl.fields[0].dataTypeID,
    projectedOid: dateControl.fields[1].dataTypeID,
    nativeConstructor: control.native_date.constructor.name,
    nativeJson: control.native_date.toJSON(),
    projected: control.calendar_date,
  });

  // Only zero-argument Date construction is pinned for announcement expiry.
  // The pg parser's year/month/day constructor and timestamp semantics survive.
  class AnnouncementDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : ['2026-09-12T12:00:00.000Z'])); }
  }
  globalThis.Date = AnnouncementDate;
  const { default: express } = await import('express');
  const database = await import('../db.ts');
  pool = database.pool;
  const { seriesRouter } = await import('../routes/series.ts');
  const { cardsRouter } = await import('../routes/cards.ts');
  const { errorMiddleware } = await import('../http.ts');
  const { fmtDate } = await import('../../../web/src/lib/format.ts');
  const { allTools, makeApi } = await import('@deckpal/agent-tools');
  const { buildDataTools, DEFAULT_MAX_TOOL_CHARS } = await import('../decke/adapters/aisdk.ts');
  const { toCallToolResult } = await import('../../../mcp/src/adapters/mcp.ts');
  const requests = [];
  const app = express();
  app.use((req, res, next) => {
    requests.push({ method: req.method, path: req.originalUrl });
    if (req.method !== 'GET') return res.status(405).end();
    req.identityResolution = 'anonymous';
    next();
  });
  app.use('/api/series', seriesRouter);
  app.use('/api/cards', cardsRouter);
  app.use(errorMiddleware);
  server = await new Promise((resolveServer, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolveServer(listening));
    listening.once('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  server.requestTimeout = 5000;
  globalThis.fetch = (url, options) => {
    const target = new URL(typeof url === 'string' ? url : url instanceof URL ? url : url.url);
    assert.equal(target.origin, base, 'integration HTTP must stay on its own loopback server');
    assert.equal(options?.method ?? 'GET', 'GET');
    return originalFetch(url, { ...options, signal: AbortSignal.timeout(5000) });
  };
  async function get(path) {
    const response = await fetch(base + '/api' + path);
    assert.equal(response.status, 200, path + ' must return a real successful route response');
    return response.json();
  }

  const list = await get('/series');
  assert.deepEqual(list.series.map((item) => [item.slug, item.firstReleaseOn]), [
    ['mega-evolution', '2025-09-26'], ['unknown', null],
  ]);
  const detail = await get('/series/mega-evolution');
  const expectedNames = [
    'Newer real set', '30th Celebration', 'September real set', 'Older real set',
    'A same-day set', 'Z same-day set', 'A unknown', 'Z unknown',
  ];
  assert.deepEqual(detail.sets.map((set) => set.name), expectedNames);
  assert.equal(detail.series.firstReleaseOn, '2025-09-26');
  assert.equal(detail.sets.some((set) => set.setId === 'zero-card'), false);
  for (const set of detail.sets) {
    assert.ok(set.releasedOn === null || /^\d{4}-\d{2}-\d{2}$/.test(set.releasedOn),
      set.name + ' must serialize an actual SQL DATE as a calendar string');
    assert.equal('progress' in set, false);
  }
  const september = detail.sets.find((set) => set.setId === 'september');
  const upcoming = detail.sets.find((set) => set.upcoming);
  assert.equal(september.releasedOn, '2026-09-16');
  assert.equal(fmtDate(september.releasedOn), 'Sep 16, 2026');
  assert.equal(fmtDate(upcoming.releasedOn), 'Sep 16, 2026');
  assert.equal(fmtDate(detail.series.firstReleaseOn), 'Sep 26, 2025');
  assert.equal(fmtDate(null), '—');
  assert.equal(fmtDate('2026-09-16T00:00:00.000Z'),
    process.env.TZ === 'America/Denver' ? 'Sep 15, 2026' : 'Sep 16, 2026');
  evidence.cases.push({
    name: 'real_series_sql_http_json_calendar_order',
    firstReleaseOn: detail.series.firstReleaseOn,
    names: detail.sets.map((set) => set.name),
    releaseDates: detail.sets.map((set) => set.releasedOn),
    renderedRealDate: fmtDate(september.releasedOn),
    renderedUpcomingDate: fmtDate(upcoming.releasedOn),
    zeroCardExcluded: true,
    anonymousProgressAbsent: true,
    nullableSeriesDate: list.series[1].firstReleaseOn,
  });

  // Exercise announcement suppression using an actual catalog row, then restore
  // the focused fixture for the subsequent price route calls.
  await client.query("UPDATE card_set SET name = ' 30TH   CELEBRATION ' WHERE id = 8");
  const suppressed = await get('/series/mega-evolution');
  assert.equal(suppressed.sets.some((set) => set.upcoming), false);
  await client.query("UPDATE card_set SET name = 'September real set' WHERE id = 8");
  evidence.cases.push({ name: 'real_catalog_name_suppresses_announcement', upcomingRows: 0 });

  const history = await get('/cards/base1-1/prices?range=30d&currency=JPY');
  assert.equal(history.currency, 'JPY');
  assert.equal(history.range, '30d');
  assert.equal(history.series.length, 3);
  const expected = new Map();
  const today = new RealDate(control.today + 'T12:00:00.000Z');
  for (let variantId = 1; variantId <= 3; variantId++) {
    const variant = history.series[variantId - 1];
    assert.equal(variant.variantId, variantId);
    assert.equal(variant.kind, 'normal');
    assert.equal(variant.displayName, 'Printing ' + variantId);
    assert.equal(variant.tier, 'standard');
    assert.equal(variant.points.length, 31);
    for (let i = 0; i < 31; i++) {
      const date = new RealDate(today.getTime() + (i - 30) * 86400000).toISOString().slice(0, 10);
      const value = i === 0 ? 0 : variantId * 1000 + i;
      const point = {
        grain: 'day', start: date, end: date, open: value, high: value, low: value, close: value,
        highOn: date, lowOn: date, mean: value, median: value, n: 1,
      };
      assert.deepEqual(variant.points[i], point, 'actual price SQL must match deterministic daily observations');
      expected.set(variantId + ':' + date, point);
    }
  }
  const usd = await get('/cards/base1-1/prices?range=30d&currency=USD');
  assert.equal(usd.series[0].points[1].close, 10.01, 'real USD route converts cents to major units');
  assert.equal(history.series[0].points[1].close, 1001, 'JPY stays in whole yen');
  evidence.cases.push({
    name: 'real_price_sql_daily_aggregation_currency_and_range',
    variants: 3, observations: expected.size, pointsPerVariant: 31,
    usdMajor: usd.series[0].points[1].close, jpyMajor: history.series[0].points[1].close,
    zeroPrice: history.series[0].points[0].close,
    capturedThrough: control.today,
  });

  const tool = allTools().find((definition) => definition.name === 'card_price_history');
  assert.ok(tool);
  assert.equal(DEFAULT_MAX_TOOL_CHARS, 6000);
  const tools = buildDataTools({
    pool, userId: 'disposable-fixture', jwt: 'synthetic-test-token', apiBase: base + '/api',
  });
  const ctx = {
    userId: 'disposable-fixture',
    db: { query: () => { throw new Error('History tool must use its real API self-hop'); } },
    api: makeApi(base + '/api'),
  };
  const seen = new Set();
  const pages = [];
  let offset = 0;
  for (let page = 0; page < 20; page++) {
    const input = tool.inputSchema.parse({ card_id: 'base1-1', range: '30d', currency: 'JPY', offset });
    const before = requests.length;
    const visible = await tools.card_price_history.execute(input, {
      toolCallId: 'real-history-' + page, messages: [], context: undefined,
    });
    assert.equal(typeof visible, 'string');
    assert.equal(requests.length - before, 1, 'each actual chat page must make one real API self-hop');
    assert.equal(requests.at(-1).path, '/api/cards/base1-1/prices?range=30d&currency=JPY');
    assert.ok(visible.length <= 5500, 'complete records must fit under the adapter output cap');
    assert.doesNotMatch(visible, /Cut off here/);
    const raw = await tool.handler(input, ctx);
    assert.ok(!raw.isError, raw.text);
    assert.equal(raw.text, visible);
    assert.equal(toCallToolResult(raw).content[0].text, visible);
    let variant;
    let count = 0;
    for (const line of visible.split('\n')) {
      const identity = line.match(/^variant (\d+) \| kind normal \| Printing (\d+)/);
      if (identity) { variant = Number(identity[1]); assert.equal(identity[1], identity[2]); }
      if (!line.includes('grain=')) continue;
      assert.ok(variant, 'each page needs a variant identity');
      const fields = Object.fromEntries([...line.matchAll(/(\w+)=([^\s]+)/g)].map((match) => [match[1], match[2]]));
      const key = variant + ':' + fields.start;
      const point = expected.get(key);
      assert.ok(point, 'unexpected observation ' + key);
      assert.ok(!seen.has(key), 'duplicate observation ' + key);
      for (const [field, value] of Object.entries(point)) assert.equal(fields[field], String(value), key + ' ' + field);
      seen.add(key);
      count++;
    }
    assert.ok(count > 0, 'nonempty history page must advance');
    const next = visible.match(/next_offset=(\d+|none)\b/);
    assert.ok(next, 'text-only callers require continuation');
    pages.push({ offset, characters: visible.length, points: count, nextOffset: next[1] });
    if (next[1] === 'none') break;
    assert.ok(Number(next[1]) > offset);
    offset = Number(next[1]);
  }
  assert.equal(seen.size, 93, 'all observations, including the final variant, must reach the real chat adapter');
  assert.ok(pages.length > 1);
  assert.equal(pages.at(-1).nextOffset, 'none');
  evidence.cases.push({
    name: 'real_postgres_prices_shared_tool_chat_and_mcp_text',
    variants: 3, observations: seen.size, pages, globalChatLimit: DEFAULT_MAX_TOOL_CHARS,
    requests: requests.filter((request) => request.path.includes('/prices')).length,
  });
  evidence.status = 'passed';
  writeFileSync(process.env.DECKPAL_TEST_RESULT, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  globalThis.Date = RealDate;
  if (server) {
    server.closeAllConnections();
    await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  }
  if (pool) await pool.end();
  await client.end();
}
