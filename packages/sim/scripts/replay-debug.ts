/** One log's replay with the engine's play-by-play beside it: node --import tsx scripts/replay-debug.ts <log> [lastN=60] */
import { readFileSync } from 'node:fs';
import { replayLog, replaySummary } from '../src/replay/replay.js';
const r = replayLog(readFileSync(process.argv[2]!, 'utf8'), { transcript: true });
const n = Number(process.argv[3] ?? 60);
console.log((r.transcript ?? []).slice(-n).join('\n'));
console.log('\n' + replaySummary(r));
for (const u of r.unlogged) console.log(`  unlogged: line ${u.line} turn ${u.turn}: ${u.prompt}`);
