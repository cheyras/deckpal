/**
 * Audit a directory of PTCG Live battle logs against the engine.
 *
 *   node --import tsx scripts/audit-logs.ts [dir] [--verbose] [--players A,B] [--json]
 *
 * dir defaults to the committed fixtures. Every `.txt` file is one log. Prints a
 * per-log summary (damage / Knock Out / Prize checks) and corpus totals; exits 1
 * when any check is a MISMATCH.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditLog, formatAudit, type LogAudit, type Verdict } from '../src/replay/audit.js';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const json = args.includes('--json');
const pi = args.indexOf('--players');
const players = pi >= 0 ? (args[pi + 1]?.split(',') as [string, string] | undefined) : undefined;
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--players');
const dir = resolve(positional[0] ?? fileURLToPath(new URL('../src/__tests__/fixtures/live-logs', import.meta.url)));

const files = readdirSync(dir).filter((f) => f.endsWith('.txt')).sort();
const audits: LogAudit[] = files.map((f) => auditLog(readFileSync(join(dir, f), 'utf8'), f, players ? { players } : {}));

if (json) {
  console.log(JSON.stringify(audits, null, 2));
} else {
  for (const a of audits) console.log(formatAudit(a, verbose));
  const sum = (k: 'damage' | 'kos' | 'prizes'): Record<Verdict, number> => {
    const t: Record<Verdict, number> = { match: 0, explained: 0, mismatch: 0, unchecked: 0 };
    for (const a of audits) for (const v of Object.keys(t) as Verdict[]) t[v] += a.totals[k][v];
    return t;
  };
  const unknown = audits.reduce((n, a) => n + a.unknown.count, 0);
  const considered = audits.reduce((n, a) => n + a.unknown.considered, 0);
  console.log(`\n${audits.length} logs, unknown lines ${unknown}/${considered}`);
  for (const k of ['damage', 'kos', 'prizes'] as const) {
    const t = sum(k);
    console.log(`  ${k.padEnd(6)} ${t.match} match / ${t.explained} explained / ${t.mismatch} MISMATCH / ${t.unchecked} unchecked`);
  }
}
const bad = audits.some((a) => a.totals.damage.mismatch + a.totals.kos.mismatch + a.totals.prizes.mismatch > 0);
process.exitCode = bad ? 1 : 0;
