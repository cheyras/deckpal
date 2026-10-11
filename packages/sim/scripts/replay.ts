/**
 * Replay real PTCG Live logs through the engine (not part of CI's pass/fail).
 *
 *   node --import tsx scripts/replay.ts [log.txt ...]   (default: every fixture log)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { replayLog, replaySummary } from '../src/replay/replay.js';

const dir = 'src/__tests__/fixtures/live-logs';
const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(dir).filter((f) => f.endsWith('.txt')).map((f) => join(dir, f));
for (const f of files) {
  const r = replayLog(readFileSync(f, 'utf8'));
  console.log(`\n## ${f}\n${replaySummary(r)}`);
}
