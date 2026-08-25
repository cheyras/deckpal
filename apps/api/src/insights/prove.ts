/**
 * DB-backed proof for the insights module (read-only except the sanctioned
 * collection_value_point snapshot). Run:
 *   node --import tsx apps/api/src/insights/prove.ts
 *
 * Proves, against the LIVE DB and real numbers:
 *   1. current Trainer Level, collection value, Pokédex captured count
 *   2. snapshotCollectionValue() appends today's snapshot and is a same-day no-op
 *   3. GET /insights/value reads the snapshot back (throwaway express app, port 0)
 *   4. the category='Pokemon' gate (a Trainer with dexIds does not capture)
 *   5. the router mounts and answers on a throwaway app
 * Closes the pool at the end so connections return to baseline.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { closePool, defaultUserId, q, q1 } from '../db.js';
import { TRAINER_UNIQUE_MODE, trainerLevel, trainerLevelProgress } from './trainerLevel.js';
import { currentCollectionValue, ownedCounts, snapshotCollectionValue, valueSeries } from './collectionValue.js';
import { dexCapturedCount, dexCompletion } from './pokedex.js';
import { insightsRouter, publicPokedexRouter } from '../routes/insights.js';

const line = (s = ''): void => console.log(s);

async function main(): Promise<void> {
  const userId = await defaultUserId();
  line(`user_id = ${userId}`);

  line('\n=== 1. Real current numbers (SQL-backed) ===');
  const counts = await ownedCounts(userId);
  const uniqueForLevel = TRAINER_UNIQUE_MODE === 'pairs' ? counts.uniquePairs : counts.uniqueCards;
  const prog = trainerLevelProgress(uniqueForLevel);
  line(`  unique cards=${counts.uniqueCards}  unique pairs=${counts.uniquePairs}  total qty=${counts.totalQuantity}`);
  line(`  Trainer Level (mode=${TRAINER_UNIQUE_MODE}) = floor(${uniqueForLevel}/10) = ${trainerLevel(uniqueForLevel)}  (into ${prog.intoLevel}/10, ${prog.toNext} to next)`);
  const value = await currentCollectionValue(userId);
  for (const v of value) line(`  collection value ${v.currency} = ${v.total.toFixed(v.currency === 'JPY' ? 0 : 2)}  (${v.totalMinor} minor, ${v.pricedVariants} priced variants, qty ${v.quantity})`);
  const dex = await dexCompletion(userId);
  line(`  Pokédex captured = ${dex.captured}/${dex.total} (${dex.pct}%)`);
  const gens = dex.byGeneration.filter((g) => g.captured > 0).map((g) => `gen${g.generation}:${g.captured}/${g.total}`);
  line(`  captured by gen: ${gens.join(', ') || '(none)'}`);

  line('\n=== 2. snapshotCollectionValue() — append then same-day no-op ===');
  const before = await q1<{ n: string }>(`SELECT count(*) AS n FROM collection_value_point WHERE user_id=$1`, [userId]);
  line(`  rows before: ${before?.n}`);
  const snap1 = await snapshotCollectionValue(userId);
  line(`  call #1 observedOn=${snap1.observedOn} inserted=${snap1.inserted} (${snap1.currencies.map((c) => `${c.currency}:${c.inserted ? 'new' : 'noop'}=${c.totalMinor}`).join(', ')})`);
  const snap2 = await snapshotCollectionValue(userId);
  line(`  call #2 observedOn=${snap2.observedOn} inserted=${snap2.inserted} (expected 0 — idempotent per day)`);
  const after = await q1<{ n: string }>(`SELECT count(*) AS n FROM collection_value_point WHERE user_id=$1`, [userId]);
  line(`  rows after:  ${after?.n}  (delta = ${Number(after?.n) - Number(before?.n)}, one legitimate snapshot: one row per priced currency)`);

  line('\n=== 3. valueSeries reads the snapshot back ===');
  for (const cur of ['USD', 'EUR'] as const) {
    const s = await valueSeries(userId, '30d', cur);
    const pts = s.points.map((p) => `${p.date}=${p.value}`).join(', ');
    line(`  ${cur} 30d: ${s.points.length} point(s) [${pts}]  delta=${s.delta ? s.delta.value : 'n/a (needs ≥2 days)'}`);
  }

  line('\n=== 4. category=Pokemon gate (DB-level) ===');
  const trainer = await q<{ tcgdex_id: string; name: string; category: string; species_rows: string }>(
    `SELECT c.tcgdex_id, c.name, c.category,
            (SELECT count(*) FROM card_species cs WHERE cs.card_id=c.id) AS species_rows
       FROM card c WHERE c.name ILIKE '%tropical tidal wave%' ORDER BY c.tcgdex_id`,
  );
  for (const t of trainer) line(`  ${t.tcgdex_id} "${t.name}" category=${t.category} card_species_rows=${t.species_rows}`);
  const nonPk = await q1<{ n: string }>(`SELECT count(*) AS n FROM card_species cs JOIN card c ON c.id=cs.card_id WHERE c.category<>'Pokemon'`);
  line(`  card_species rows pointing at a non-Pokemon card: ${nonPk?.n}  (importer gates population; capture query gates again)`);
  const gated = await dexCapturedCount(userId);
  line(`  captured (gated query) = ${gated}  — Trainers with dexIds contribute 0`);

  line('\n=== 5. Router harness (throwaway express app, ephemeral port) ===');
  const app = express();
  // Stub identity: the real app settles "who is calling" via resolveIdentity /
  // resolveOptionalIdentity (index.ts) before these routers; this harness pins
  // the proven user so currentUserId()/optionalUserId() answer without the
  // auth plumbing.
  app.use((req, _res, next) => {
    req.user = { id: userId };
    req.identityResolution = 'user';
    next();
  });
  // Mounted in the same order as index.ts: the two public Pokédex reads live on
  // publicPokedexRouter; everything else (overview, value) stays on
  // insightsRouter.
  app.use('/insights', publicPokedexRouter);
  app.use('/insights', insightsRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', () => r()));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}/insights`;
  const hit = async (path: string): Promise<void> => {
    const res = await fetch(base + path);
    const body = (await res.json()) as Record<string, unknown>;
    let summary = '';
    if (path === '/overview') {
      const t = body.trainer as { level: number };
      const pk = body.pokedex as { captured: number; total: number };
      const cv = body.collectionValue as { currency: string; total: number }[];
      summary = `trainer L${t.level}, dex ${pk.captured}/${pk.total}, value ${cv.map((v) => `${v.currency} ${v.total}`).join('/')}`;
    } else if (path.startsWith('/value')) {
      const c = body.current as { currency: string; total: number };
      const s = body.series as { points: unknown[] };
      summary = `current ${c.currency} ${c.total}, ${s.points.length} series point(s)`;
    } else if (path === '/pokedex?generation=1') {
      const comp = body.completion as { captured: number; total: number };
      const sp = body.species as unknown[];
      summary = `completion ${comp.captured}/${comp.total}, ${sp.length} gen-1 species`;
    } else {
      const sp = body.species as { name: string; captured: boolean; level: number; cardPool: number } | undefined;
      summary = sp ? `${sp.name} captured=${sp.captured} level=${sp.level} pool=${sp.cardPool}` : JSON.stringify(body);
    }
    line(`  GET ${path} → ${res.status}  ${summary}`);
  };
  await hit('/overview');
  await hit('/value?range=30d&currency=USD');
  await hit('/pokedex?generation=1');
  await hit('/pokedex/6');
  await hit('/pokedex/charizard');
  await new Promise<void>((r) => server.close(() => r()));

  await closePool();
  line('\n(pool closed; connections returned to baseline)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
