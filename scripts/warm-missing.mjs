// warm-missing.mjs — fill cache gaps the manifest-driven warmer misses.
//
// Root cause this addresses: apps/images/src/warmer.ts uses TCGdex's compiled
// datas.json as its work-list, but datas.json OMITS many promo / energy / trainer-kit
// sets (e.g. mep, mfb, svp, smp, tk-*, mc-*) even though the TCGdex image CDN still
// serves art for some of them. This script drives off the DB card list instead and
// probes the CDN directly, warming every missing (serie,set,localId,quality) that the
// CDN actually has. It only ADDS files (atomic writes), never deletes/evicts, and
// mirrors fetch.ts validation (content-type image/webp + RIFF/WEBP magic — the
// soft-404 trap). Cards the CDN 404s are reported as genuine upstream gaps.
//
// Usage: node warm-missing.mjs <missing.csv> [--report out.json]
//   missing.csv rows: serie,set,localId,missHigh,missLow   (1 = that quality missing)
import { existsSync } from 'node:fs';
import { mkdir, rename, writeFile, readFile, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const CACHE_ROOT = process.env.IMAGE_CACHE_ROOT || '/home/cheyras/pokedex/cache';
const UA = 'pokedex-images/1.0 (+cheyras@gmail.com)';
const RATE_PER_SEC = 5;
const MAX_CONCURRENCY = 2;

const csvPath = process.argv[2];
const reportIdx = process.argv.indexOf('--report');
const reportPath = reportIdx > -1 ? process.argv[reportIdx + 1] : null;
const gapIdx = process.argv.indexOf('--gapfile');
const gapPath = gapIdx > -1 ? process.argv[gapIdx + 1] : null;
if (!csvPath) { console.error('usage: node warm-missing.mjs <missing.csv> [--report out.json] [--gapfile gaps.txt]'); process.exit(1); }

process.on('unhandledRejection', (e) => { process.stderr.write(`[unhandledRejection] ${e}\n`); });
process.on('uncaughtException', (e) => { process.stderr.write(`[uncaughtException] ${e}\n`); });

const srcUrl = (serie, set, localId, q) =>
  `https://assets.tcgdex.net/en/${serie}/${set}/${localId}/${q}.webp`;
const absPath = (serie, set, localId, q) =>
  `${CACHE_ROOT}/images/en/${serie}/${set}/${localId}.${q}.webp`;

// ── polite gate: <=5 starts/sec, <=2 concurrent (mirrors fetch.ts) ──
let inFlight = 0; let recent = []; const waiters = [];
function pump() {
  while (waiters.length) {
    const now = Date.now();
    recent = recent.filter((t) => now - t < 1000);
    if (inFlight < MAX_CONCURRENCY && recent.length < RATE_PER_SEC) {
      inFlight++; recent.push(now); waiters.shift()();
    } else {
      const wait = recent.length >= RATE_PER_SEC ? 1000 - (now - recent[0]) + 5 : 25;
      setTimeout(pump, Math.max(5, wait)); return;
    }
  }
}
const acquire = () => new Promise((r) => { waiters.push(r); pump(); });
const release = () => { inFlight--; pump(); };

async function fetchWebp(url) {
  await acquire();
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    const ct = res.headers.get('content-type');
    if (res.status === 404) return { kind: 'gap' };
    if (!res.ok) { await res.arrayBuffer().catch(() => {}); return { kind: 'error', reason: `HTTP ${res.status}` }; }
    if (!ct || !ct.toLowerCase().startsWith('image/webp')) {
      await res.arrayBuffer().catch(() => {});
      return { kind: 'gap', reason: `content-type ${ct}` };
    }
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length < 12 || body.toString('ascii', 0, 4) !== 'RIFF' || body.toString('ascii', 8, 12) !== 'WEBP')
      return { kind: 'error', reason: `not RIFF/WEBP (${body.length}b)` };
    return { kind: 'ok', body };
  } catch (e) { return { kind: 'error', reason: String(e.message || e) }; }
  finally { release(); }
}

async function warmOne(serie, set, localId, q, st) {
  const key = `${serie}/${set}/${localId}/${q}`;
  const abs = absPath(serie, set, localId, q);
  if (existsSync(abs)) { st.skipped++; return; }
  if (knownGaps.has(key)) { st.skipped++; st.gap++; return; }
  const r = await fetchWebp(srcUrl(serie, set, localId, q));
  if (r.kind === 'ok') {
    await mkdir(dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp`;
    await writeFile(tmp, r.body);
    await rename(tmp, abs);
    st.warmed++; st.bytes += r.body.length;
    st.warmedRows.push(`${serie},${set},${localId},${q},${r.body.length}`);
  } else if (r.kind === 'gap') {
    st.gap++; st.gapSet.add(key);
    if (gapPath) await appendFile(gapPath, key + '\n');
  } else {
    st.errors++; st.errRows.push(`${key}: ${r.reason}`);
  }
}

const knownGaps = new Set();
if (gapPath && existsSync(gapPath)) {
  for (const l of (await readFile(gapPath, 'utf8')).split('\n')) if (l.trim()) knownGaps.add(l.trim());
  process.stderr.write(`[resume] ${knownGaps.size} known gaps loaded from ${gapPath}\n`);
}

const lines = (await readFile(csvPath, 'utf8')).trim().split('\n').filter(Boolean);
const jobs = [];
for (const ln of lines) {
  const [serie, set, localId, mh, ml] = ln.split(',');
  if (!serie || !set || !localId) continue;
  if (mh === '1') jobs.push([serie, set, localId, 'high']);
  if (ml === '1') jobs.push([serie, set, localId, 'low']);
}

const st = { warmed: 0, skipped: 0, gap: 0, errors: 0, bytes: 0, warmedRows: [], errRows: [], gapSet: new Set() };
let idx = 0; const started = Date.now();
async function worker() { while (idx < jobs.length) { const j = jobs[idx++]; await warmOne(...j, st); if (idx % 100 === 0) process.stderr.write(`  ..${idx}/${jobs.length} warmed=${st.warmed} gap=${st.gap} err=${st.errors}\n`); } }
await Promise.all(Array.from({ length: MAX_CONCURRENCY }, worker));

const secs = ((Date.now() - started) / 1000).toFixed(0);
process.stderr.write(`DONE ${secs}s jobs=${jobs.length} warmed=${st.warmed} skipped=${st.skipped} gap=${st.gap} errors=${st.errors} bytes=${st.bytes}\n`);
if (reportPath) {
  await writeFile(reportPath, JSON.stringify({
    jobs: jobs.length, warmed: st.warmed, skipped: st.skipped, gap: st.gap, errors: st.errors, bytes: st.bytes,
    warmedRows: st.warmedRows, gap_files: [...new Set([...knownGaps, ...st.gapSet])], errRows: st.errRows,
  }, null, 2));
  process.stderr.write(`report → ${reportPath}\n`);
}
