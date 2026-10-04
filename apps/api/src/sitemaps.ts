/**
 * Search-engine sitemaps for the public catalog, at the bare origin:
 *
 *   /sitemap-pages.xml    the public top-level pages and every series
 *   /sitemap-sets.xml     every browsable set with cards
 *   /sitemap-cards.xml    every browsable card (about 21 000)
 *   /sitemap-pokedex.xml  every species with at least one browsable card
 *
 * `apps/web/public/sitemap.xml` is the static sitemap index that lists these,
 * and robots.txt points at it. They live at the root, not under /api, because
 * a sitemap may only list URLs at or below its own path.
 *
 * Cloud only, like the OAuth routes beside it: the URLs are deckpal.app's, and
 * a self-hosted DeckPal is private. Paths are built exactly as the web app's
 * links build them (series slug, set tcgdex id, card collector number;
 * components/CardLink.tsx), from the same browsable_* views the catalog reads,
 * so every listed URL is a page the app renders.
 *
 * No `lastmod`: prices change daily on every card, so any date would be either
 * always today or untrue, and search engines ignore a lastmod they cannot trust.
 */
import type { Express, Request, Response } from 'express';
import { q } from './db.js';
import { sitemapRateLimit } from './rateLimit.js';

const ORIGIN = (process.env.DECKPAL_PUBLIC_ORIGIN ?? 'https://deckpal.app').replace(/\/+$/, '');

/** The top-level public pages, in the order a reader would meet them. */
const PAGES = ['/', '/connect', '/series', '/pokedex', '/privacy'];

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const path = (...segments: string[]): string => '/' + segments.map(encodeURIComponent).join('/');

export function urlset(paths: readonly string[]): string {
  const body = paths.map((p) => `<url><loc>${esc(ORIGIN + p)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

const ENABLED_SERIES = `
  FROM series s
  JOIN catalogue cat ON cat.code = s.catalogue_code AND cat.is_enabled
 WHERE s.tcgdex_id <> 'tcgp'`;

const BUILDERS: Record<string, () => Promise<string[]>> = {
  async pages() {
    const series = await q<{ slug: string }>(`SELECT s.slug ${ENABLED_SERIES} ORDER BY s.sort_order, s.slug`);
    return [...PAGES, ...series.map((s) => path('series', s.slug))];
  },
  async sets() {
    const rows = await q<{ series: string; set: string }>(
      `SELECT s.slug AS series, cs.tcgdex_id AS set
         FROM browsable_set cs
         JOIN series s ON s.id = cs.series_id
         JOIN catalogue cat ON cat.code = s.catalogue_code AND cat.is_enabled
        WHERE EXISTS (SELECT 1 FROM card c WHERE c.set_id = cs.id)
        ORDER BY s.sort_order, cs.released_on NULLS LAST, cs.tcgdex_id`,
    );
    return rows.map((r) => path('series', r.series, r.set));
  },
  async cards() {
    const rows = await q<{ series: string; set: string; number: string }>(
      `SELECT s.slug AS series, cs.tcgdex_id AS set, c.local_id AS number
         FROM browsable_card c
         JOIN card_set cs ON cs.id = c.set_id
         JOIN series s ON s.id = cs.series_id
         JOIN catalogue cat ON cat.code = s.catalogue_code AND cat.is_enabled
        ORDER BY s.sort_order, cs.released_on NULLS LAST, cs.tcgdex_id, c.number_sort`,
    );
    return rows.map((r) => path('series', r.series, r.set, r.number));
  },
  async pokedex() {
    const rows = await q<{ id: number }>(
      `SELECT d.id FROM dex_species d
        WHERE EXISTS (SELECT 1 FROM card_species cx JOIN browsable_card bc ON bc.id = cx.card_id WHERE cx.dex_id = d.id)
        ORDER BY d.id`,
    );
    return rows.map((r) => path('pokedex', String(r.id)));
  },
};

/** The paths one sitemap lists, or null for a name that is not a sitemap. */
export async function sitemapPaths(name: string): Promise<string[] | null> {
  const build = Object.hasOwn(BUILDERS, name) ? BUILDERS[name] : undefined;
  return build ? build() : null;
}

async function serve(req: Request, res: Response): Promise<void> {
  // The query string is ignored, not redirected away: vercel.json's rewrite
  // passes its `:file` parameter to this function as `?file=…`, so a redirect
  // to the bare path answered every request with a 301 to itself (seen on the
  // PR #277 preview). Query variants that dodge the CDN cache are bounded by
  // sitemapRateLimit instead.
  const name = /^\/sitemap-([a-z]+)\.xml$/.exec(req.path)?.[1] ?? '';
  if (!Object.hasOwn(BUILDERS, name)) {
    res.status(404).type('text/plain').send('Not found');
    return;
  }
  try {
    const xml = urlset((await sitemapPaths(name)) ?? []);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400');
    res.send(xml);
  } catch (err) {
    console.error('[sitemaps]', name, err instanceof Error ? err.message : err);
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).type('text/plain').send('Sitemap temporarily unavailable');
  }
}

export function mountSitemaps(app: Express): void {
  app.get(/^\/sitemap-[a-z]+\.xml$/, sitemapRateLimit, (req, res) => {
    void serve(req, res);
  });
}
