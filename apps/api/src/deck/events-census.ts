/**
 * Event census reporter (battle-intel A1). Parses every fixture log (or the
 * files given as argv) through parseBattleEvents and prints, per log: event
 * count, unknown-line count/considered/rate, and the unknown samples; then a
 * corpus-wide event-type histogram. Pure file reads — no DB. Re-run whenever
 * new logs land to spot taxonomy drift (unknown-rate creep = new line shapes).
 *
 *   pnpm --filter pokedex-api census:events [files…]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBattleEvents } from './battleevents.js';

const fixtureDir = fileURLToPath(new URL('./__tests__/fixtures/battle-logs', import.meta.url));
const files =
  process.argv.length > 2
    ? process.argv.slice(2)
    : readdirSync(fixtureDir)
        .filter((f) => f.endsWith('.txt'))
        .sort()
        .map((f) => join(fixtureDir, f));

const histogram = new Map<string, number>();
let totalUnknown = 0;
let totalConsidered = 0;

for (const file of files) {
  const parsed = parseBattleEvents(readFileSync(file, 'utf8'));
  const name = file.split('/').pop();
  const u = parsed.unknown;
  console.log(
    `${name}: ${parsed.events.length} events · ${parsed.turns} turns · players [${parsed.players.join(', ')}] · unknown ${u.count}/${u.considered} (${(u.rate * 100).toFixed(1)}%)`,
  );
  for (const s of u.samples) console.log(`    ? ${s}`);
  for (const e of parsed.events) histogram.set(e.type, (histogram.get(e.type) ?? 0) + 1);
  totalUnknown += u.count;
  totalConsidered += u.considered;
}

console.log(`\nCorpus: unknown ${totalUnknown}/${totalConsidered} (${((totalUnknown / Math.max(1, totalConsidered)) * 100).toFixed(2)}%)`);
console.log('Event-type histogram:');
for (const [type, count] of [...histogram.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(5)}  ${type}`);
}
