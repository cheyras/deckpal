import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { LANG, QUALITIES, type Quality } from './config.js';
import { cardAbsolutePath, cardCacheKey, cardRelativePath, type CardRef } from './layout.js';
import { closePool, getPool } from './assets.js';
import { fromUrl, isWebp, putAsset, sniffContentType } from './store.js';

/**
 * warm:pkmn — fallback card-art warmer for cards the catalog CDN does not have.
 *
 * TCGdex lacks art for energy sets, promos, e-card, trainer kits and special
 * subsets — those 404 on assets.tcgdex.net. pkmn.gg (backend `[redacted host]/pkmn`)
 * has them: each card object carries `largeImageUrl` (→ high) and `thumbImageUrl`
 * (→ low), already WebP.
 *
 * Was `scripts/warm-from-pkmn.mjs`, which (a) never recorded a manifest row, so its
 * output became untraceable orphans, and (b) validated a download only by
 * `length >= 800`, which is how 30 PNG bodies ended up stored under `.webp` names.
 * Both are fixed here: every write goes through store.ts `putAsset` with the real
 * per-card source URL, and the content type is sniffed from the bytes.
 *
 *   pnpm --filter pokedex-images warm:pkmn -- --dry-run
 *   pnpm --filter pokedex-images warm:pkmn -- --set smp
 *   PKMN_AUTH=[redacted path] pnpm --filter pokedex-images warm:pkmn
 *
 * Secret handling (CLAUDE.md): the session is read at RUNTIME from `PKMN_AUTH`
 * (default `[redacted path]`), never committed, never logged. Refresh
 * tokens rotate, so run ONE consumer at a time.
 */

const BASE = 'https://[redacted host]/pkmn';
const SESSION_PATH = process.env.PKMN_AUTH ?? join(homedir(), 'Transfer', 'redacted-auth-file');

interface Session {
  access_token: string;
  refresh_token: string;
}

let session: Session | null = null;

async function loadSession(): Promise<Session> {
  if (session) return session;
  if (!existsSync(SESSION_PATH)) {
    throw new Error(
      `pkmn session not found at ${SESSION_PATH}. Set PKMN_AUTH to the session file ` +
        `(JSON with access_token + refresh_token). Never commit or log it.`,
    );
  }
  const raw = JSON.parse(await readFile(SESSION_PATH, 'utf-8')) as Record<string, string>;
  const access = raw.access_token ?? raw.accessToken;
  const refresh = raw.refresh_token ?? raw.refreshToken;
  if (!access || !refresh) throw new Error(`pkmn session at ${SESSION_PATH} is missing tokens`);
  session = { access_token: access, refresh_token: refresh };
  return session;
}

function apiHeaders(s: Session): Record<string, string> {
  return {
    'User-Agent': 'Mozilla/5.0',
    Origin: 'https://www.pkmn.gg',
    Referer: 'https://www.pkmn.gg/',
    Accept: 'application/json',
    Authorization: `Bearer ${s.access_token}`,
  };
}

async function refreshSession(): Promise<void> {
  const s = await loadSession();
  const res = await fetch(`${BASE}/v1/auth/refresh`, {
    method: 'POST',
    headers: {
      ...apiHeaders(s),
      'Content-Type': 'application/json',
      Cookie: `refresh_token=${s.refresh_token}`,
    },
    body: '{}',
  });
  if (!res.ok) throw new Error(`pkmn session refresh failed: HTTP ${res.status}`);
  const j = (await res.json()) as { accessToken: string; refreshToken?: string };
  session = { access_token: j.accessToken, refresh_token: j.refreshToken ?? s.refresh_token };
  await writeFile(SESSION_PATH, JSON.stringify(session), { mode: 0o600 });
}

async function apiJson<T>(path: string): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await loadSession();
    const res = await fetch(BASE + path, { headers: apiHeaders(s) });
    if (res.status === 401) {
      await refreshSession();
      continue;
    }
    return res.ok ? ((await res.json()) as T) : null;
  }
  return null;
}

// ── set crosswalk: our tcgdex set id → pkmn setId ────────────────────────────
interface PkmnSet {
  id: string;
  slug: string;
  name: string;
  category: string;
}

const REV_XWALK: Record<string, string> = {
  'sv08.5': 'sv8pt5',
  'sv03.5': 'sv3pt5',
  'sv06.5': 'sv6pt5',
  sv06: 'sv6',
  sv08: 'sv8',
  sv09: 'sv9',
  'sv10.5b': 'sv10pt5_blk',
  sve: 'sve23',
};
const OVERRIDE: Record<string, string> = {
  mep: 'MEP',
  'swsh4.5sv': 'swsh45sv',
  'sm3.5': 'sm35',
  'sm7.5': 'sm75',
  'swsh12.5gg': 'swsh12pt5gg',
  'swsh4.5': 'swsh45',
  hgssp: 'hsp',
};

const norm = (s: string): string => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function buildCrosswalk(sets: PkmnSet[]) {
  const byIdLc = new Map(sets.map((s) => [s.id.toLowerCase(), s.id]));
  const bySlug = new Map(sets.map((s) => [s.slug, s.id]));
  const byName = new Map(sets.map((s) => [norm(s.name), s.id]));
  return (ourSet: string, ourSlug?: string | null, ourName?: string | null): string | null => {
    if (OVERRIDE[ourSet]) return OVERRIDE[ourSet];
    // Trainer Gallery subsets: our swshN.5tg → pkmn swshNtg
    let m = /^swsh(\d+)\.5tg$/.exec(ourSet);
    if (m && byIdLc.has(`swsh${m[1]}tg`)) return byIdLc.get(`swsh${m[1]}tg`)!;
    // McDonald's year buckets: our 20YY<era> → pkmn mcdYY
    m = /^20(\d{2})/.exec(ourSet);
    if (m && byIdLc.has(`mcd${m[1]}`)) return byIdLc.get(`mcd${m[1]}`)!;
    if (byIdLc.has(ourSet.toLowerCase())) return byIdLc.get(ourSet.toLowerCase())!;
    const rev = REV_XWALK[ourSet];
    if (rev && byIdLc.has(rev.toLowerCase())) return byIdLc.get(rev.toLowerCase())!;
    if (ourSlug && bySlug.has(ourSlug)) return bySlug.get(ourSlug)!;
    if (ourName && byName.has(norm(ourName))) return byName.get(norm(ourName))!;
    const pt = ourSet.replace(/\./g, 'pt');
    if (byIdLc.has(pt.toLowerCase())) return byIdLc.get(pt.toLowerCase())!;
    return null;
  };
}

// Our local_id may be zero-padded / non-numeric; index pkmn cards under every form.
function keyForms(v: string): string[] {
  const out = new Set<string>();
  const raw = String(v);
  out.add(raw.toUpperCase());
  if (/^\d+$/.test(raw)) out.add(String(parseInt(raw, 10)));
  out.add(raw.replace(/^0+/, '').toUpperCase());
  return [...out];
}

interface PkmnCard {
  id?: string;
  number?: string;
  numberKey?: string;
  name?: string;
  largeImageUrl?: string;
  thumbImageUrl?: string;
}

// ── work-list: our cards, from the DB, that are missing art on disk ──────────
interface Gap {
  ref: CardRef;
  name: string;
  setSlug: string;
  setName: string;
  missing: Quality[];
}

async function findGaps(setFilter?: string): Promise<Gap[]> {
  const { rows } = await getPool().query<{
    local_id: string;
    name: string;
    set_id: string;
    set_slug: string;
    set_name: string;
    serie_id: string;
  }>(
    `SELECT c.local_id, c.name, s.tcgdex_id AS set_id, s.slug AS set_slug, s.name AS set_name,
            sr.tcgdex_id AS serie_id
       FROM card c
       JOIN card_set s ON s.id = c.set_id
       JOIN series  sr ON sr.id = s.series_id
      WHERE c.lang = $1
        AND ($2::text IS NULL OR s.tcgdex_id = $2)
      ORDER BY sr.tcgdex_id, s.tcgdex_id, c.local_id`,
    [LANG, setFilter ?? null],
  );
  const gaps: Gap[] = [];
  for (const r of rows) {
    const ref: CardRef = { serie: r.serie_id, set: r.set_id, localId: r.local_id };
    const missing = QUALITIES.filter((q) => !existsSync(cardAbsolutePath(ref, q)));
    if (missing.length) {
      gaps.push({ ref, name: r.name, setSlug: r.set_slug, setName: r.set_name, missing });
    }
  }
  return gaps;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Stats {
  setsMapped: number;
  setsUnmapped: string[];
  cardsConsidered: number;
  warmedHigh: number;
  warmedLow: number;
  noMatch: number;
  rejectedNonImage: number;
  errors: number;
  bytes: number;
}

/**
 * Download one image and hand it to the choke point. Validation mirrors fetch.ts:
 * a body that is not an image is REJECTED, never written — the trap that produced
 * 30 PNG-under-.webp files in the cache.
 */
async function warmOne(
  url: string,
  ref: CardRef,
  quality: Quality,
  st: Stats,
): Promise<boolean> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.pkmn.gg/' },
  });
  if (!res.ok) {
    st.errors++;
    return false;
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 800) {
    st.rejectedNonImage++;
    return false;
  }
  const sniffed = sniffContentType(bytes);
  if (!sniffed.startsWith('image/')) {
    st.rejectedNonImage++;
    process.stderr.write(`[warm:pkmn] REJECT ${url}: body is ${sniffed}, not an image\n`);
    return false;
  }
  if (!isWebp(bytes)) {
    // The cache path says `.webp`. Storing non-WebP bytes under that name is what
    // made the old script's output untrustworthy — refuse rather than mislabel.
    st.rejectedNonImage++;
    process.stderr.write(
      `[warm:pkmn] REJECT ${url}: ${sniffed} body would be stored under a .webp path\n`,
    );
    return false;
  }
  await putAsset({
    cacheKey: cardCacheKey(ref, quality),
    kind: 'card',
    relativePath: cardRelativePath(ref, quality),
    bytes,
    provenance: fromUrl(url), // the REAL per-card pkmn.gg URL, not a reconstruction
  });
  st.bytes += bytes.length;
  return true;
}

export interface WarmFromPkmnOptions {
  set?: string;
  dryRun?: boolean;
  limit?: number;
}

export async function warmFromPkmn(opts: WarmFromPkmnOptions = {}): Promise<Stats> {
  const st: Stats = {
    setsMapped: 0,
    setsUnmapped: [],
    cardsConsidered: 0,
    warmedHigh: 0,
    warmedLow: 0,
    noMatch: 0,
    rejectedNonImage: 0,
    errors: 0,
    bytes: 0,
  };

  const gaps = await findGaps(opts.set);
  if (gaps.length === 0) {
    process.stderr.write('[warm:pkmn] no gaps on disk — nothing to do\n');
    return st;
  }
  process.stderr.write(`[warm:pkmn] ${gaps.length} cards missing art\n`);
  if (opts.dryRun) {
    const sets = new Set(gaps.map((g) => g.ref.set));
    process.stderr.write(`[warm:pkmn] dry-run: ${sets.size} sets, ${gaps.length} cards\n`);
    return st;
  }

  const setsResp = await apiJson<{ value: PkmnSet[] }>('/v1/sets');
  if (!setsResp?.value) throw new Error('could not list pkmn sets (session expired?)');
  const resolve = buildCrosswalk(setsResp.value.filter((s) => s.category === 'EN'));

  // group gaps by our set
  const bySet = new Map<string, Gap[]>();
  for (const g of gaps) {
    const list = bySet.get(g.ref.set) ?? [];
    list.push(g);
    bySet.set(g.ref.set, list);
  }

  let processed = 0;
  for (const [ourSet, list] of bySet) {
    const first = list[0]!;
    const pk = resolve(ourSet, first.setSlug, first.setName);
    if (!pk) {
      st.setsUnmapped.push(ourSet);
      continue;
    }
    const data = await apiJson<{ value: Array<{ card?: PkmnCard } & PkmnCard> }>(
      `/v1/card/${encodeURIComponent(pk)}`,
    );
    if (!data?.value) {
      st.setsUnmapped.push(`${ourSet}(fetch-fail:${pk})`);
      continue;
    }
    st.setsMapped++;

    // index by every number form, plus by normalized name (pkmn `number` can be
    // non-numeric and differ from our local_id, e.g. MEW vs 001 for miscp)
    const byNum = new Map<string, PkmnCard>();
    const byName = new Map<string, PkmnCard>();
    for (const e of data.value) {
      const c = e.card ?? e;
      const num = c.number ?? c.numberKey ?? (c.id ?? '').split('-').slice(1).join('-');
      for (const k of keyForms(String(num))) if (!byNum.has(k)) byNum.set(k, c);
      for (const k of keyForms((c.id ?? '').split('-').slice(1).join('-'))) {
        if (!byNum.has(k)) byNum.set(k, c);
      }
      if (c.name && !byName.has(norm(c.name))) byName.set(norm(c.name), c);
    }

    for (const g of list) {
      if (opts.limit && processed >= opts.limit) break;
      st.cardsConsidered++;
      let card: PkmnCard | undefined;
      for (const k of keyForms(g.ref.localId)) {
        card = byNum.get(k);
        if (card) break;
      }
      card ??= byName.get(norm(g.name));
      if (!card?.largeImageUrl) {
        st.noMatch++;
        continue;
      }
      for (const q of g.missing) {
        const url = q === 'high' ? card.largeImageUrl : card.thumbImageUrl;
        if (!url) continue;
        try {
          if (await warmOne(url, g.ref, q, st)) {
            if (q === 'high') st.warmedHigh++;
            else st.warmedLow++;
          }
        } catch (err) {
          st.errors++;
          process.stderr.write(`[warm:pkmn] ERROR ${g.ref.set}-${g.ref.localId} ${q}: ${(err as Error).message}\n`);
        }
        await sleep(120); // ~8 rps, polite
      }
      processed++;
      if (processed % 100 === 0) {
        process.stderr.write(
          `[warm:pkmn] ${processed} cards · high=${st.warmedHigh} low=${st.warmedLow} · set ${ourSet}\n`,
        );
      }
    }
  }

  process.stderr.write(
    `[warm:pkmn] done. sets-mapped=${st.setsMapped} unmapped=${st.setsUnmapped.length} ` +
      `cards=${st.cardsConsidered} high=${st.warmedHigh} low=${st.warmedLow} ` +
      `no-match=${st.noMatch} rejected=${st.rejectedNonImage} errors=${st.errors} bytes=${st.bytes}\n`,
  );
  if (st.setsUnmapped.length) {
    process.stderr.write(`[warm:pkmn] unmapped sets: ${st.setsUnmapped.join(', ')}\n`);
  }
  return st;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function parseArgs(argv: string[]): WarmFromPkmnOptions {
  const o: WarmFromPkmnOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--set') o.set = argv[++i];
    else if (a === '--limit') o.limit = Number(argv[++i]);
    else if (a === '--dry-run') o.dryRun = true;
  }
  return o;
}

const entryPath = process.env.pm_exec_path ?? process.argv[1] ?? '';
const isMain = entryPath.endsWith('warmFromPkmn.js') || entryPath.endsWith('warmFromPkmn.ts');
if (isMain) {
  try {
    await warmFromPkmn(parseArgs(process.argv.slice(2)));
  } catch (err) {
    process.stderr.write(`[warm:pkmn] fatal: ${(err as Error).message}\n`);
    await closePool().catch(() => undefined);
    process.exit(1);
  }
  await closePool().catch(() => undefined);
  process.exit(0);
}
