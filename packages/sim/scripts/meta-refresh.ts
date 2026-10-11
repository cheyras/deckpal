/**
 * Refresh the built-in meta pool (src/meta/data.ts) from Limitless's public
 * tournament API. Run by hand, from packages/sim:
 *
 *   node --import tsx scripts/meta-refresh.ts            # write src/meta/data.ts
 *   node --import tsx scripts/meta-refresh.ts --dry-run  # print the pool, write nothing
 *   node --import tsx scripts/meta-refresh.ts --days 14 --min-players 64 --top 10
 *
 * Read-only GETs (the events list, then each qualifying event's standings),
 * one at a time with a pause between (and backing off on a 429), User-Agent naming DeckPal. Nothing is
 * written to any database or service; the only output is the data file.
 *
 * What it does, in order (the selection rule lives in src/meta/select.ts):
 *   1. lists recent Standard events; keeps those in the last 21 days with 32+ players;
 *   2. fetches their standings (archetype, record, placing, decklist);
 *   3. ranks archetypes by share of players; for each of the top 12 takes the best
 *      record among its decklists from the largest events;
 *   4. maps every card to a catalogue id with the importer's own PTCGL set-alias
 *      table (apps/api/src/deck/data/ptcgl-set-alias.json) checked against the
 *      sim's frame snapshot, and checks the list is a legal 60-card Standard
 *      deck. A list that fails is SKIPPED with a printed reason (never dropped
 *      silently); the next-best list for that archetype is tried.
 *   5. writes src/meta/data.ts. Review the diff and the printed skip list, then
 *      run the tests; commit the file. The data carries archetype, event name/date
 *      and record only, never player names.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRAMES } from '../src/cards/frames-all.js';
import { buildPool, fold, LARGEST_EVENTS, MIN_PLAYERS, TOP_N, WINDOW_DAYS, windowEvents, type EventStandings, type LimitlessEvent, type LimitlessStanding, type SetAliasEntry } from '../src/meta/select.js';

const API = 'https://play.limitlesstcg.com/api';
const UA = 'DeckPal-meta-refresh/1.0 (+https://deckpal.app; read-only, low volume)';
const CONCURRENCY = 1;
const DELAY_MS = 1_200;
const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(here, '../../../apps/api/src/deck/data');
const OUT = resolve(here, '../src/meta/data.ts');

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const num = (name: string, d: number) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : d;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function get<T>(url: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (res.ok) return (await res.json()) as T;
    if (attempt >= 6 || (res.status < 500 && res.status !== 429)) throw new Error(`GET ${url} -> ${res.status}`);
    // Rate limited or a hiccup: honour Retry-After if given, else back off.
    const wait = Number(res.headers.get('retry-after'));
    await sleep(Number.isFinite(wait) && wait > 0 ? wait * 1_000 : 5_000 * attempt);
  }
}

/** --cache <dir>: keep each event's standings on disk so a re-run (or a tweak to the rule) does not fetch them again. */
async function cached<T>(id: string, fetcher: () => Promise<T>): Promise<T> {
  const dir = args.includes('--cache') ? args[args.indexOf('--cache') + 1] : undefined;
  if (!dir) {
    const out = await fetcher();
    await sleep(DELAY_MS);
    return out;
  }
  const file = resolve(dir, `${id}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as T;
  const out = await fetcher();
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(out));
  await sleep(DELAY_MS);
  return out;
}

async function main(): Promise<void> {
  const days = num('--days', WINDOW_DAYS);
  const minPlayers = num('--min-players', MIN_PLAYERS);
  const topN = num('--top', TOP_N);
  const now = new Date();
  const listed = await get<LimitlessEvent[]>(`${API}/tournaments?game=PTCG&format=STANDARD&limit=500`);
  const events = windowEvents(listed, now, days, minPlayers);
  console.log(`${listed.length} recent Standard events listed; ${events.length} in the last ${days} days with ${minPlayers}+ players.`);
  if (!events.length) throw new Error('No qualifying events — nothing to build a pool from.');

  const all: EventStandings[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    while (next < events.length) {
      const event = events[next++]!;
      const standings = await cached(event.id, () => get<LimitlessStanding[]>(`${API}/tournaments/${event.id}/standings`));
      all.push({ event, standings });
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  all.sort((a, b) => (a.event.id < b.event.id ? -1 : 1)); // fixed order, whatever finished first

  // Limitless-only codes the importer's table lacks (checked against the catalogue at play time like any unverified id).
  const EXTRA_ALIASES: Record<string, SetAliasEntry> = { '30C': { set: '30th', kind: 'main' } };
  const aliases = { ...EXTRA_ALIASES, ...(JSON.parse(readFileSync(resolve(DATA_DIR, 'ptcgl-set-alias.json'), 'utf8')) as { aliases: Record<string, SetAliasEntry> }).aliases };
  const ace = JSON.parse(readFileSync(resolve(DATA_DIR, 'ace-spec.json'), 'utf8')) as { sv_era_derived_from_db: string[]; bw_xy_era_vendored_uncertain: string[] };
  const aceSpecNames = new Set([...ace.sv_era_derived_from_db, ...ace.bw_xy_era_vendored_uncertain].map(fold));

  const { pool, skipped } = buildPool({ all, aliases, frames: FRAMES, aceSpecNames, now, topN, windowDays: days, minPlayers });
  console.log(`\nPool as of ${pool.asOf}: ${pool.decks.length} archetypes from ${pool.window.events} events / ${pool.window.players} players (best of the ${LARGEST_EVENTS} largest events per archetype).`);
  for (const d of pool.decks) {
    console.log(`  ${(d.share * 100).toFixed(1).padStart(5)}%  ${String(d.players).padStart(5)}  ${d.name.padEnd(32)} ${d.from.event} · ${d.from.date} · ${d.from.record} · #${d.from.placing}`);
  }
  if (skipped.length) console.log(`\nSkipped (${skipped.length}):\n  ${skipped.join('\n  ')}`);
  if (flag('--dry-run')) return;
  if (!pool.decks.length) throw new Error('Refusing to write an empty pool.');

  const body = JSON.stringify(pool, null, 2);
  writeFileSync(
    OUT,
    `// GENERATED by scripts/meta-refresh.ts from Limitless's public tournament API. Do not edit by hand.\n` +
      `// Re-run: node --import tsx scripts/meta-refresh.ts (from packages/sim).\n` +
      `import type { MetaPool } from './types.js';\n\nexport const POOL_DATA: MetaPool = ${body};\n`,
  );
  console.log(`\nWrote ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
