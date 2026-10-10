/**
 * Round-trip report: every scripted card's printed text next to its script
 * rendered back to English (src/cards/render.ts), with the similarity score and
 * any structural problems, worst first.
 *
 *   node --import tsx scripts/roundtrip.ts              # every script
 *   node --import tsx scripts/roundtrip.ts me05-034     # cards whose id or name contains this
 *   node --import tsx scripts/roundtrip.ts --problems   # only sections with problems
 *   node --import tsx scripts/roundtrip.ts --json
 */
import { allScripts, FRAMES } from '../src/cards/registry.js';
import { ROUNDTRIP_ALLOW, roundTrip, type RoundTrip } from '../src/cards/render.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
const onlyProblems = args.includes('--problems');
const needle = args.find((a) => !a.startsWith('--'))?.toLowerCase();

const rows: RoundTrip[] = [];
for (const s of allScripts()) {
  if (needle && !s.id.toLowerCase().includes(needle) && !s.name.toLowerCase().includes(needle)) continue;
  const f = FRAMES[s.id];
  if (!f) {
    console.error(`no frame for ${s.id}`);
    continue;
  }
  rows.push(...roundTrip(s, f));
}
const allowed = (r: RoundTrip, p: string): boolean => (ROUNDTRIP_ALLOW[`${r.id}|${r.key}`]?.problems ?? []).some((x) => p.includes(x));
const shown = rows
  .filter((r) => !onlyProblems || r.problems.some((p) => !allowed(r, p)))
  .sort((a, b) => b.problems.length - a.problems.length || a.score - b.score);

if (json) {
  console.log(JSON.stringify(shown, null, 1));
} else {
  for (const r of shown) {
    console.log(`── ${r.score.toFixed(2)}  ${r.id} ${r.name} · ${r.key}${r.opaque ? '  [opaque: custom without gloss]' : ''}`);
    console.log(`   printed : ${r.printed || '(none)'}`);
    console.log(`   rendered: ${r.rendered || '(none)'}`);
    for (const p of r.problems) console.log(`   ${allowed(r, p) ? 'allowed' : 'PROBLEM'} : ${p}`);
  }
  const scores = rows.map((r) => r.score).sort((a, b) => a - b);
  const q = (x: number): string => (scores[Math.min(scores.length - 1, Math.floor(x * scores.length))] ?? 0).toFixed(2);
  const bad = rows.filter((r) => r.problems.some((p) => !allowed(r, p))).length;
  console.log(
    `\n${rows.length} sections from ${new Set(rows.map((r) => r.id)).size} scripts; similarity min ${q(0)} p25 ${q(0.25)} median ${q(0.5)} p75 ${q(0.75)} max ${q(0.999)}; ${bad} with unallowed problems; ${rows.filter((r) => r.opaque).length} opaque`,
  );
}
