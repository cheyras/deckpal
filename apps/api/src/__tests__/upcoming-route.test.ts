/**
 * ACTUAL-ROUTE REGRESSION — series date projection (R1/R2).
 *
 * Executes the REAL Express series route handlers against an isolated mocked
 * RLS query client. Not a copy of the mapping/comparator assembly: the route's
 * own SQL is inspected, so a fixture that bypasses the to_char projection
 * boundary fails here rather than passing against a stale copy.
 *
 * Why this exists: node-postgres parses bare SQL DATE columns (OID 1082) into JS
 * Date objects (via postgres-date). JSON.stringify turns those into UTC
 * timestamps, which render a calendar day early in zones behind UTC, and
 * Date !== string breaks the string-only compareSetOrder used to interleave
 * upcoming placeholders among real catalog sets. The repair projects DATE
 * columns to text with to_char('YYYY-MM-DD') at the SELECT boundary. This test
 * pins that contract end-to-end through the real handler.
 *
 * No live database, no network: the pool is never connected; every query is
 * answered by a mock client inside rlsStore. The installed pg OID 1082 parser
 * is used as a Date control (proving the global parser was NOT overridden), and
 * OID 25 (text) for the explicitly projected columns.
 *
 * Run: node --import tsx --test src/__tests__/upcoming-route.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { Request, Response } from 'express';
import { rlsStore, closePool } from '../db.js';
import { seriesRouter } from '../routes/series.js';

// Defensive: the pool is never connected (every query is answered by the mock
// RLS client), but pin the config so no ambient .env can reach a real database.
Object.assign(process.env, {
  SUPABASE_MODE: '1',
  PGHOST: '127.0.0.1',
  PGPORT: '9',
  PGDATABASE: 'repair_no_network',
  PGUSER: 'repair',
  PGPASSWORD: '',
  PGSSLMODE: 'disable',
});

const ACTIVE_DATE = '2026-09-12T12:00:00.000Z';
const RealDate = globalThis.Date;

/**
 * Deterministic "today" so the Sep 16 placeholder is always in its active
 * window regardless of the real wall clock. todayIso() does
 * `new Date().toISOString().slice(0, 10)`. The multi-arg path is preserved so
 * the installed pg DATE parser (postgres-date → `new Date(year, month, day)`)
 * keeps working under the mock — only the no-arg call is pinned.
 */
class MockDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) {
      super(ACTIVE_DATE);
    } else {
      // postgres-date calls new Date(year, month, day, ...) — pass all args
      // through. Date's overloaded constructor cannot be typed from a rest
      // spread, so suppress the shape check (runtime is correct).
      // @ts-expect-error: spreading unknown[] into Date's overloaded constructor
      super(...args);
    }
  }
}

before(() => {
  (globalThis as { Date: DateConstructor }).Date = MockDate as unknown as DateConstructor;
});

after(() => {
  (globalThis as { Date: DateConstructor }).Date = RealDate as DateConstructor;
  return closePool();
});

// Installed pg parsers — the boundary this test guards. Captured before the
// Date mock is active; the OID 1082 parser still constructs Dates (now via the
// mocked constructor, which extends RealDate), proving the global parser was
// not overridden to return strings.
const dateParser = pg.types.getTypeParser(1082, 'text');
const textParser = pg.types.getTypeParser(25, 'text');

/**
 * Assert the SQL projects `table.field` to ISO text with to_char, and return
 * the value as the OID 25 (text) parser would — i.e. the string the projected
 * column arrives as. This is the boundary: a fixture that drops the to_char
 * and returns a string anyway fails the assert.match, so the test cannot pass
 * against an unprojected SELECT.
 */
function projected(
  table: string,
  field: string,
  value: string | null,
  sql: string,
): string | null {
  const pattern = new RegExp(
    `to_char\\(\\s*${table}\\.${field}\\s*,\\s*'YYYY-MM-DD'\\s*\\)\\s+AS\\s+${field}`,
    'i',
  );
  assert.match(
    sql,
    pattern,
    `${table}.${field} must be projected to ISO text at the SELECT boundary`,
  );
  if (value === null) return null;
  return textParser(value) as string;
}

/** A mock RLS query client that inspects SQL and returns fixture rows. */
function makeClient(): pg.PoolClient & { sqls: string[] } {
  const sqls: string[] = [];
  return {
    sqls,
    async query(text: string): Promise<{ rows: Record<string, unknown>[] }> {
      sqls.push(text);
      // Series list and series detail both select FROM series s.
      if (text.includes('FROM series s')) {
        return {
          rows: [
            {
              id: 'fixture-series',
              tcgdex_id: 'me',
              slug: 'mega-evolution',
              name: 'Mega Evolution',
              first_release_on: projected('s', 'first_release_on', '2025-09-26', text),
              sort_order: 1,
              set_count: '6',
              card_count: '600',
              rep_set_id: null,
              rep_has_logo: false,
              rep_has_symbol: false,
              owned_required: null,
              total_required: null,
            },
          ],
        };
      }
      if (text.includes('FROM card_set cs')) {
        assert.match(
          text,
          /HAVING\s+count\(c\.id\)\s*>\s*0/i,
          'zero-card catalog rows must remain filtered',
        );
        const rows: Array<[string, string, string | null]> = [
          ['newer', 'Newer real set', '2026-10-01'],
          ['older', 'Older real set', '2026-08-01'],
          ['same-z', 'Z same-day set', '2026-01-01'],
          ['same-a', 'A same-day set', '2026-01-01'],
          ['null-z', 'Z unknown', null],
          ['null-a', 'A unknown', null],
        ];
        return {
          rows: rows.map(([id, name, date]) => ({
            id,
            tcgdex_id: id,
            slug: id,
            name,
            released_on: projected('cs', 'released_on', date, text),
            card_count_official: 100,
            card_count_total: 100,
            is_promo: false,
            logo_url: null,
            symbol_url: null,
            card_rows: '100',
            complete_owned: null,
            complete_total: null,
            complete_level: null,
            master_owned: null,
            master_total: null,
            grand_owned: null,
            grand_total: null,
          })),
        };
      }
      throw new Error('unexpected query: ' + text.slice(0, 120));
    },
  } as unknown as pg.PoolClient & { sqls: string[] };
}

/** Pull the real registered route handler by path from the live router. */
function routeHandler(path: string): (req: Request, res: Response, next: (err?: unknown) => void) => void {
  const layer = seriesRouter.stack.find((l) => l.route?.path === path);
  const handle = layer?.route?.stack[0]?.handle;
  assert.ok(handle, `series route ${path} must be registered`);
  return handle;
}

/** Invoke a real route handler inside a mocked RLS client context. */
async function invokeRoute(
  path: string,
  params: Record<string, string>,
  client: pg.PoolClient,
): Promise<unknown> {
  return rlsStore.run(client, () =>
    new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('route timeout')), 5000);
      const req = {
        params,
        user: undefined,
        identityResolution: 'anonymous',
        headers: {},
      } as unknown as Request;
      const res = {
        setHeader() { return this; },
        set() { return this; },
        header() { return this; },
        status(n: number) { assert.equal(n, 200); return this; },
        json(v: unknown) {
          clearTimeout(timer);
          resolve(JSON.parse(JSON.stringify(v)));
          return this;
        },
      } as unknown as Response;
      routeHandler(path)(req, res, (e?: unknown) => {
        clearTimeout(timer);
        reject(e ?? new Error('unexpected next()'));
      });
    }),
  );
}

interface DetailBody {
  series: { firstReleaseOn: string | null };
  sets: Array<{ name: string; releasedOn: string | null; upcoming?: true }>;
}
interface ListBody {
  series: Array<{ firstReleaseOn: string | null; name: string }>;
}

test('control: the installed pg DATE parser returns a JS Date, not a string', () => {
  // Proves the global pg parser was NOT overridden to return strings — the
  // repair must project at the SQL boundary, not mutate the driver.
  const parsed = dateParser('2026-09-16');
  assert.ok(parsed instanceof RealDate, 'OID 1082 parser must return a Date');
  // And a bare Date JSON-serializes as a UTC timestamp, not a calendar string —
  // the reason the to_char projection is necessary.
  assert.doesNotMatch(JSON.stringify(parsed), /^\d{4}-\d{2}-\d{2}$/, 'Date must not serialize as bare YYYY-MM-DD');
});

test('the real detail route projects dates, sorts mixed rows, and omits anonymous progress', async () => {
  const client = makeClient();
  const body = (await invokeRoute('/:seriesSlug', { seriesSlug: 'mega-evolution' }, client)) as DetailBody;

  // firstReleaseOn is a calendar string, not a Date-derived timestamp.
  assert.equal(body.series.firstReleaseOn, '2025-09-26');
  assert.match(body.series.firstReleaseOn ?? '', /^\d{4}-\d{2}-\d{2}$/);

  // Mixed real + upcoming, descending date, same-day names ascending, nulls last.
  assert.deepEqual(
    body.sets.map((s) => s.name),
    [
      'Newer real set',
      '30th Celebration',
      'Older real set',
      'A same-day set',
      'Z same-day set',
      'A unknown',
      'Z unknown',
    ],
  );

  // Every release DTO is a calendar string (or null), never a Date timestamp.
  for (const s of body.sets) {
    assert.ok(
      s.releasedOn === null || /^\d{4}-\d{2}-\d{2}$/.test(s.releasedOn),
      `${s.name} releasedOn must be YYYY-MM-DD or null`,
    );
  }

  // Anonymous response: no progress on any set, including the placeholder.
  for (const s of body.sets) {
    assert.equal('progress' in s, false, `${s.name} must not carry progress for anonymous`);
  }
});

test('the real list route projects firstReleaseOn as a calendar string', async () => {
  const client = makeClient();
  const body = (await invokeRoute('/', {}, client)) as ListBody;
  const first = body.series[0];
  assert.ok(first, 'list must return at least one series');
  assert.equal(first.firstReleaseOn, '2025-09-26');
  assert.match(first.firstReleaseOn ?? '', /^\d{4}-\d{2}-\d{2}$/);
});

test('the detail route issued SQL that projected both date columns to text', async () => {
  const client = makeClient();
  await invokeRoute('/:seriesSlug', { seriesSlug: 'mega-evolution' }, client);
  // The projected() helper already asserted each query's to_char at issue time;
  // here we confirm the route actually ran the set query (not just the series
  // lookup) and that both projections were exercised.
  assert.ok(
    client.sqls.some((s) => /to_char\(\s*cs\.released_on/i.test(s)),
    'detail set query must project cs.released_on',
  );
  assert.ok(
    client.sqls.some((s) => /to_char\(\s*s\.first_release_on/i.test(s)),
    'a series query must project s.first_release_on',
  );
});
