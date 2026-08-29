import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * warm:cloud — fill the CLOUD object tier for every card and set image in the
 * catalog.
 *
 * WHY THIS EXISTS. The cloud tier had no bulk warm path at all, and the gap was
 * invisible because each individual miss still "worked":
 *
 *   - `warm` / `warm:gaps` / `warm:pkmn` fill the SELF-HOST DISK cache. They write
 *     through `store.ts putAsset` to `IMAGE_CACHE_ROOT`, which a Vercel deployment
 *     does not have and cannot read.
 *   - `storage:backfill` mirrors an EXISTING disk cache into the bucket. It is a
 *     copy, not a fetch — on a box with no disk cache (every CI box, every fresh
 *     clone, this machine) its work-list is empty.
 *   - which left the deployed handler's own lazy fill as the only thing that ever
 *     put card art in the bucket, one card per page view.
 *
 * So the bucket only ever held what someone had happened to look at. Swept on
 * 2026-08-26: 18,840 of 21,066 cards — 89% of the catalog — had no object at all,
 * and every first view of one paid a ~1.5-2.5s fill (upstream fetch + upload)
 * inside the image function before a single byte reached the page. That is what
 * "the art loads slowly and unevenly, and some tiles never load" actually was.
 *
 * WHAT IT DOES. It drives the deployed image tier's OWN lazy fill over a work-list
 * of every card the catalog has, plus a logo and a symbol for every set it
 * reports. It writes nothing itself: each GET makes the handler resolve the
 * asset's source, fetch it, and write bytes+row together
 * through `putStorageAsset` — the B1 choke point — exactly as a page view would.
 * That is deliberate. A second fetch-and-upload implementation here would be a
 * second thing to keep in step with the handler's provenance rules, and the class
 * of bug that produces is precisely what B1 exists to prevent.
 *
 * NO CREDENTIALS. The catalog endpoints (`/api/series`, `/api/sets/:id`) and the
 * image route are public, so this runs against any deployment with nothing but a
 * base URL. It needs no database, no service-role key and no session.
 *
 *   pnpm --filter deckpal-images warm:cloud -- --dry-run
 *   pnpm --filter deckpal-images warm:cloud                        # cards + sets, low + high
 *   pnpm --filter deckpal-images warm:cloud -- --qualities low
 *   pnpm --filter deckpal-images warm:cloud -- --set sv10 --concurrency 6
 *   pnpm --filter deckpal-images warm:cloud -- --base https://staging.example.com
 *   pnpm --filter deckpal-images warm:cloud -- --warm-edge   # also fill the CDN
 *   pnpm --filter deckpal-images warm:cloud -- --assets sets        # set logos + symbols only
 *   pnpm --filter deckpal-images warm:cloud -- --assets cards       # card art only
 *
 * DEFAULT warms BOTH cards and sets (--assets both). Set imagery (logos +
 * symbols) was added 2026-08-29: before that the work-list was card art only,
 * so set logos/symbols were left to per-page-view lazy fill. `--qualities`
 * applies to cards only; set images are one file per kind (logo.webp /
 * symbol.webp), so the qualities flag is ignored for set jobs.
 *
 * IDEMPOTENT AND RESUMABLE. A warm asset answers `302 X-Cache: HIT` and costs one
 * cheap request; only a miss fills. Progress is written to `--state` as it goes,
 * so an interrupted run resumes rather than restarting. Run it after a set
 * releases and after any catalog import.
 *
 * REPORTS THE RESIDUE, NEVER INVENTS AN ASSET. A card whose art upstream genuinely
 * does not have answers the placeholder; those are written to the residue file
 * with the tier's own `X-Image-Reason`, broken down by set, rather than being
 * counted as success. Do not "fix" a residue by pointing it at a plausible URL —
 * see the fill-missing-assets skill.
 */

interface Args {
  base: string;
  qualities: string[];
  assets: 'cards' | 'sets' | 'both';
  concurrency: number;
  set: string | null;
  limit: number;
  state: string;
  residue: string;
  dryRun: boolean;
  warmEdge: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string, fallback?: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? fallback : (argv[i + 1] ?? fallback);
  };
  const qualities = (get('qualities', 'low,high') as string)
    .split(',')
    .map((q) => q.trim())
    .filter((q) => q === 'low' || q === 'high');
  if (qualities.length === 0) throw new Error('--qualities must name at least one of low,high');
  const assets = (get('assets', 'both') as string);
  if (assets !== 'cards' && assets !== 'sets' && assets !== 'both') {
    throw new Error('--assets must be one of cards, sets, both');
  }
  return {
    base: (get('base', 'https://deckpal.app') as string).replace(/\/+$/, ''),
    qualities,
    assets,
    concurrency: Math.max(1, Number(get('concurrency', '8'))),
    set: get('set') ?? null,
    limit: Number(get('limit', '0')),
    state: get('state', '.cache/warm-cloud-state.json') as string,
    residue: get('residue', '.cache/warm-cloud-residue.json') as string,
    dryRun: argv.includes('--dry-run'),
    warmEdge: argv.includes('--warm-edge'),
  };
}

interface Job {
  category: 'card' | 'set';
  setId: string;
  cardId: string;
  url: string;
  key: string;
}

interface SeriesRow {
  slug: string;
}
interface SetRow {
  setId: string;
}
interface CardRow {
  cardId: string;
  images: { low: string; high: string };
}

async function getJson<T>(url: string, tries = 5): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) return (await res.json()) as T;
      // 4xx that is not rate limiting is a real answer, not a blip.
      if (res.status < 500 && res.status !== 429) throw new Error(`HTTP ${res.status} ${url}`);
      last = new Error(`HTTP ${res.status} ${url}`);
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/**
 * The work-list comes from OUR catalog, never from the upstream manifest — the
 * rule from the fill-missing-assets skill, and the reason `warm:gaps` exists at
 * all: TCGdex's compiled datas.json omits whole classes of set (promos, energy,
 * trainer kits) that our catalog carries and its CDN may still serve.
 */
async function buildWorkList(args: Args): Promise<Job[]> {
  const { series } = await getJson<{ series: SeriesRow[] }>(`${args.base}/api/series`);
  const setIds: string[] = [];
  for (const s of series) {
    const detail = await getJson<{ sets: SetRow[] }>(
      `${args.base}/api/series/${encodeURIComponent(s.slug)}`,
    );
    for (const set of detail.sets) setIds.push(set.setId);
  }

  const jobs: Job[] = [];
  for (const setId of setIds) {
    if (args.set && setId !== args.set) continue;
    // Set imagery: logo + symbol for every set the catalog reports. The handler
    // resolves each through the approved crosswalk when the catalog column is
    // NULL (see handler.ts resolveSourceFromManifest / setImageFallbackUrl).
    if (args.assets === 'sets' || args.assets === 'both') {
      for (const image of ['logo', 'symbol'] as const) {
        const path = `/deckpal/images/sets/${setId}/${image}.webp`;
        jobs.push({ category: 'set', setId, cardId: image, url: `${args.base}${path}`, key: path });
      }
    }
    if (args.assets === 'cards' || args.assets === 'both') {
      let page = 1;
      for (;;) {
        const url =
          `${args.base}/api/sets/${encodeURIComponent(setId)}` +
          `?pageSize=250&page=${page}&own=all&goal=complete`;
        const body = await getJson<{
          cards: CardRow[];
          pagination: { pageCount: number };
        }>(url);
        for (const card of body.cards) {
          for (const q of args.qualities) {
            const path = q === 'low' ? card.images.low : card.images.high;
            if (path) jobs.push({ category: 'card', setId, cardId: card.cardId, url: `${args.base}${path}`, key: path });
          }
        }
        if (page >= body.pagination.pageCount || body.cards.length === 0) break;
        page++;
      }
    }
  }
  return jobs;
}

type Outcome = 'filled' | 'hit' | 'placeholder' | 'failed';

async function warmOne(job: Job, warmEdge: boolean): Promise<{ outcome: Outcome; reason?: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // `manual` so a HIT is one cheap request: we read the tier's answer without
      // following it to the object.
      //
      // THAT IS ALSO THIS COMMAND'S BLIND SPOT, and it is worth stating plainly
      // because the original version of this comment called following the
      // redirect "downloading the whole image for no reason". There is a reason.
      // Putting an object in the bucket does not put it in the CDN: Supabase
      // Storage is fronted by Cloudflare, which caches per data centre, on first
      // request. So a fully warmed bucket can still serve every card slowly the
      // first time anyone looks at it — measured on production 2026-08-26 against
      // sets nobody had opened since the warm: first view p50 **1215 ms** with 61
      // blank-tile-steps while scrolling, second view of the same set p50
      // **151 ms** and 6. `CF-Cache-Status` goes MISS then HIT. That is an 8x
      // difference that the bucket-only warm cannot touch.
      //
      // `--warm-edge` therefore follows the redirect and reads the body, purely
      // so the CDN keeps a copy. The bytes are discarded. It costs real bandwidth
      // (~1.3 GB for the English corpus at both resolutions), so it is opt-in.
      //
      // IT WARMS THE DATA CENTRE THAT SERVES THE MACHINE IT RUNS ON, not the
      // world. Run it from somewhere that shares an edge with the people who will
      // read the pages; running it in CI warms CI's edge and nobody else's.
      const res = await fetch(job.url, { redirect: 'manual', signal: AbortSignal.timeout(45_000) });
      if (res.status === 302) {
        if (warmEdge) {
          const object = res.headers.get('location');
          if (object) {
            try {
              const obj = await fetch(object, { signal: AbortSignal.timeout(45_000) });
              // Read to completion — a cache only stores what was actually served.
              await obj.arrayBuffer();
            } catch {
              /* the bucket has it; a failed edge fill is a slow read, not a gap */
            }
          }
        }
        return { outcome: res.headers.get('x-cache') === 'FILLED' ? 'filled' : 'hit' };
      }
      if (res.headers.get('x-placeholder') === '1') {
        return { outcome: 'placeholder', reason: res.headers.get('x-image-reason') ?? 'placeholder' };
      }
      if (res.status === 404) return { outcome: 'failed', reason: 'not found' };
    } catch {
      /* retried below */
    }
    await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
  }
  return { outcome: 'failed', reason: 'exhausted retries' };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[warm:cloud] ${args.base} — assets ${args.assets}, qualities ${args.qualities.join('+')}, concurrency ${args.concurrency}` +
      `${args.set ? `, set ${args.set}` : ''}${args.dryRun ? ' (dry run)' : ''}`,
  );

  let jobs = await buildWorkList(args);
  const done: Set<string> = existsSync(args.state)
    ? new Set(JSON.parse(await readFile(args.state, 'utf-8')) as string[])
    : new Set();
  jobs = jobs.filter((j) => !done.has(j.key));
  if (args.limit > 0) jobs = jobs.slice(0, args.limit);

  console.log(`[warm:cloud] ${jobs.length} assets to check`);
  if (args.dryRun) {
    const bySet = new Map<string, number>();
    for (const j of jobs) bySet.set(j.setId, (bySet.get(j.setId) ?? 0) + 1);
    for (const [setId, n] of [...bySet].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      console.log(`  ${setId.padEnd(14)} ${n}`);
    }
    return;
  }

  await mkdir(dirname(args.state), { recursive: true }).catch(() => undefined);

  const cardCounts: Record<Outcome, number> = { filled: 0, hit: 0, placeholder: 0, failed: 0 };
  const setCounts: Record<Outcome, number> = { filled: 0, hit: 0, placeholder: 0, failed: 0 };
  const residue: Array<{ category: 'card' | 'set'; setId: string; cardId: string; key: string; reason: string }> = [];
  const started = Date.now();
  let index = 0;
  let processed = 0;

  const flush = async (): Promise<void> => {
    await writeFile(args.state, JSON.stringify([...done]));
  };

  await Promise.all(
    Array.from({ length: args.concurrency }, async () => {
      for (;;) {
        const i = index++;
        if (i >= jobs.length) return;
        const job = jobs[i]!;
        const { outcome, reason } = await warmOne(job, args.warmEdge);
        const counts = job.category === 'set' ? setCounts : cardCounts;
        counts[outcome]++;
        if (outcome === 'placeholder' || outcome === 'failed') {
          residue.push({ category: job.category, setId: job.setId, cardId: job.cardId, key: job.key, reason: reason ?? '' });
        }
        // A failure is recorded too: re-running should not re-hammer upstream for
        // art it has already told us it does not have. Delete the state file to
        // force a full re-check once upstream may have changed.
        done.add(job.key);
        if (++processed % 250 === 0) {
          const rate = processed / ((Date.now() - started) / 1000);
          const eta = (jobs.length - processed) / rate / 60;
          const total = (k: Outcome) => cardCounts[k] + setCounts[k];
          console.log(
            `[warm:cloud] ${processed}/${jobs.length}  filled=${total('filled')} hit=${total('hit')} ` +
              `placeholder=${total('placeholder')} failed=${total('failed')}  ${rate.toFixed(1)}/s  eta ${eta.toFixed(0)}min`,
          );
          await flush();
        }
      }
    }),
  );

  await flush();
  await writeFile(args.residue, JSON.stringify(residue, null, 2));

  const secs = (Date.now() - started) / 1000;
  console.log(
    `\n[warm:cloud] done in ${secs.toFixed(0)}s — ` +
      `cards: filled=${cardCounts.filled} hit=${cardCounts.hit} placeholder=${cardCounts.placeholder} failed=${cardCounts.failed} | ` +
      `sets: filled=${setCounts.filled} hit=${setCounts.hit} placeholder=${setCounts.placeholder} failed=${setCounts.failed}`,
  );

  if (residue.length > 0) {
    const bySet = new Map<string, number>();
    for (const r of residue) bySet.set(r.setId, (bySet.get(r.setId) ?? 0) + 1);
    console.log(
      `[warm:cloud] ${residue.length} asset(s) upstream could not serve — written to ${args.residue}.\n` +
        `             These are REAL gaps, not a bug to route around: the placeholder is the honest\n` +
        `             answer until a source for them exists (see warm:pkmn, and the fill-missing-assets skill).`,
    );
    for (const [setId, n] of [...bySet].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      console.log(`  ${setId.padEnd(14)} ${n}`);
    }
  }
}

main().catch((err: unknown) => {
  console.error('[warm:cloud]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
