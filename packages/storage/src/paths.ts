/**
 * Path + cache-key algebra for cached image assets — THE one copy.
 *
 * This module was lifted out of `apps/images/src/layout.ts` (which now re-exports
 * it) so that both image tiers share a single definition:
 *
 *   - self-host  — `apps/images` serves these relative paths off local disk;
 *   - cloud      — the Vercel `/deckscout/images/*` function serves them out of
 *                  Supabase Storage, using the SAME relative path as the object
 *                  key. That equality is deliberate: a full backfill is then a
 *                  straight upload of the on-disk cache tree, no remapping.
 *
 * The whole point (DATA-LAYER §5.3) is that the stored path is a *pure function*
 * of the upstream image URL: no mapping table, and a plain rsync of the tree is a
 * full restore. So the read path never needs the DB to locate an asset.
 *
 * Upstream base URL:   https://assets.tcgdex.net/{lang}/{serie}/{set}/{localId}
 * Upstream asset URL:  …/{localId}/{quality}.webp
 * Stored relative path: images/{lang}/{serie}/{set}/{localId}.{quality}.webp
 *
 * Zero dependencies (not even `node:path`) — separators are always '/', which is
 * what both POSIX disk paths and object keys want.
 */

// English-only build (DATA-LAYER §3.5). One language; no server-side fallback.
export const LANG = 'en';

// The two real resolutions (DATA-LAYER §3.4). There is nothing above 600×825.
export const QUALITIES = ['low', 'high'] as const;
export type Quality = (typeof QUALITIES)[number];

export type SetImageKind = 'logo' | 'symbol';

export interface CardRef {
  serie: string; // e.g. 'sv'
  set: string; // e.g. 'sv03.5'
  localId: string; // e.g. '006'
}

export function isQuality(v: string): v is Quality {
  return (QUALITIES as readonly string[]).includes(v);
}

export function cardRelativePath(ref: CardRef, quality: Quality): string {
  return `images/${LANG}/${ref.serie}/${ref.set}/${ref.localId}.${quality}.webp`;
}

// image_asset.cache_key — deterministic, stable, matches the schema comment shape
// ('card:<setId>-<localId>:<quality>'). The card id is TCGdex's own `{set}-{localId}`.
export function cardCacheKey(ref: CardRef, quality: Quality): string {
  return `card:${ref.set}-${ref.localId}:${quality}`;
}

export function cardSourceUrl(ref: CardRef, quality: Quality): string {
  return `https://assets.tcgdex.net/${LANG}/${ref.serie}/${ref.set}/${ref.localId}/${quality}.webp`;
}

// ── Set imagery (logo + symbol) ──────────────────────────────────────────────
// Set logos/symbols are catalog imagery, warmed from the base URLs stored in
// card_set (logo_url / symbol_url). The correct TCGdex asset is the stored base
// URL + '.webp' (DATA-LAYER §3.4). We key/serve them by the set's tcgdex_id, the
// same id the API and SPA already route on, so the read path needs no DB lookup:
//   relative path: sets/{setId}/{logo|symbol}.webp
// These are tiny (~4 MB total across 218 sets) and are NOT eviction candidates —
// their cache_key never ends in ':high' (see apps/images assets.ts evictionCandidates).

export function setImageRelativePath(setId: string, kind: SetImageKind): string {
  return `sets/${setId}/${kind}.webp`;
}

export function setImageCacheKey(setId: string, kind: SetImageKind): string {
  return `set:${setId}:${kind}`;
}

// The upstream asset URL is the stored base URL with a '.webp' suffix. The base
// already encodes the correct origin path (…/en/{serie}/{set}/logo for logos,
// …/univ/{serie}/{set}/symbol for symbols), so we only append the extension.
export function setImageSourceUrl(baseUrl: string): string {
  return /\.webp$/i.test(baseUrl) ? baseUrl : `${baseUrl}.webp`;
}

// ── Pokédex species sprites ──────────────────────────────────────────────────
/**
 * Sprites are the one asset class with NO per-file manifest row, by an existing
 * project decision (`.claude/skills/add-tcg/image-slots.md`): the tree is
 * bulk-cloned from ONE pinned upstream commit, so its provenance is that SHA,
 * recorded in `scripts/fetch-sprites.sh`, rather than 4,100 rows saying the same
 * thing. `manifest:check` deliberately does not scan the sprite tree — and if we
 * *did* add rows, it would report every one of them as a missing file on the
 * self-host box, turning a clean tripwire into permanent false drift.
 *
 * The cloud tier therefore fetches sprites from that same pinned SHA. The URL is
 * fully determined by the request path plus the SHA, so provenance stays exact.
 *
 * KEEP IN SYNC with `SPRITES_SHA` in scripts/fetch-sprites.sh — bump both together.
 */
export const SPRITES_SHA = 'bf4c47ac82c33b330e33d98b8882d1cedb2f53e7';
const SPRITES_RAW_BASE = `https://raw.githubusercontent.com/PokeAPI/sprites/${SPRITES_SHA}/sprites/pokemon`;

export type SpriteStyle = 'pixel' | 'art';

/**
 * Sub-path under the sprite root, identical on disk (SPRITE_ROOT) and in the
 * bucket (under a `sprites/` prefix), so the same tree can be uploaded verbatim:
 *   pixel        → {id}.png
 *   pixel shiny  → shiny/{id}.png
 *   art          → other/official-artwork/{id}.png
 *   art shiny    → other/official-artwork/shiny/{id}.png
 */
export function spriteSubPath(style: SpriteStyle, id: string, shiny: boolean): string {
  const dir = style === 'art' ? 'other/official-artwork/' : '';
  return `${dir}${shiny ? 'shiny/' : ''}${id}.png`;
}

export function spriteRelativePath(style: SpriteStyle, id: string, shiny: boolean): string {
  return `sprites/${spriteSubPath(style, id, shiny)}`;
}

export function spriteSourceUrl(style: SpriteStyle, id: string, shiny: boolean): string {
  return `${SPRITES_RAW_BASE}/${spriteSubPath(style, id, shiny)}`;
}

// ── Request parsing ──────────────────────────────────────────────────────────
/**
 * The URL prefix every image request carries, self-host and cloud alike. Kept
 * here so the Vercel rewrite, the Express routes and the tests all agree.
 */
export const IMAGE_URL_PREFIX = '/deckscout/images/';

/**
 * A TCGdex path segment. Ids are `[A-Za-z0-9.-]` after a leading alphanumeric —
 * `base1`, `sv03.5`, `A1a`, `P-A`, `tk-bw-e`, `TG05`, `006`. Anything else is
 * rejected outright, which (with the explicit '..' check below) makes traversal
 * impossible: no '/', no '\', no leading dot, no percent-escapes left to decode.
 */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;

function safeSegment(seg: string): boolean {
  return SEGMENT.test(seg) && !seg.includes('..');
}

export type ParsedImage =
  | {
      kind: 'card';
      ref: CardRef;
      quality: Quality;
      relativePath: string;
      cacheKey: string;
      /**
       * The canonical upstream URL this path is derived FROM (DATA-LAYER §5.3).
       * It is a derivation, not a guess — but it is still only a fallback for when
       * the manifest has no recorded `source_url`, and it is never written to the
       * manifest unless a fetch from it actually succeeded.
       */
      canonicalSourceUrl: string;
      assetKind: 'card';
    }
  | {
      kind: 'set';
      setId: string;
      image: SetImageKind;
      relativePath: string;
      cacheKey: string;
      assetKind: 'set-logo' | 'set-symbol';
    }
  | {
      kind: 'sprite';
      style: SpriteStyle;
      id: string;
      shiny: boolean;
      relativePath: string;
      /** Pinned-SHA upstream. Deterministic from the path — see SPRITES_SHA. */
      canonicalSourceUrl: string;
      assetKind: 'sprite';
    };

export type ParseImagePathResult =
  | { ok: true; asset: ParsedImage }
  /**
   * `bad-request` — the shape is a card path but the language or quality is not
   * one we serve. `not-found` — anything else (bad segment, traversal attempt,
   * unknown route shape such as the sprite paths the cloud tier does not carry).
   * apps/images draws exactly this line: 400 + placeholder vs 404.
   */
  | { ok: false; reason: 'bad-request' | 'not-found' };

/**
 * Parse the part of the URL AFTER `/deckscout/images/` into a concrete asset.
 *
 * Percent-escapes are decoded FIRST and validated after, so `%2e%2e%2f` is
 * rejected exactly like a literal `../`. A path is only ever accepted when every
 * segment matches `SEGMENT`, which contains no separator characters at all — the
 * returned `relativePath` therefore cannot escape its subtree.
 */
export function parseImagePath(subPath: string): ParseImagePathResult {
  if (typeof subPath !== 'string' || subPath.length === 0) return { ok: false, reason: 'not-found' };
  // Query/fragment are the caller's to strip; refuse them rather than guess.
  if (subPath.includes('?') || subPath.includes('#')) return { ok: false, reason: 'not-found' };

  let decoded: string;
  try {
    decoded = decodeURIComponent(subPath);
  } catch {
    return { ok: false, reason: 'not-found' }; // malformed %-escape
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return { ok: false, reason: 'not-found' };

  const segments = decoded.split('/');
  if (segments.some((s) => s.length === 0)) return { ok: false, reason: 'not-found' }; // '', '//', trailing '/'

  // Species sprites: sprites/{pixel|art}[/shiny]/{id}.png — 3 or 4 segments, so
  // they never collide with the 3-segment set route (which starts 'sets') or the
  // 5-segment card route. The id is digits-only, which is the whole traversal
  // defence for this shape.
  if ((segments.length === 3 || segments.length === 4) && segments[0] === 'sprites') {
    const style = segments[1]!;
    const shiny = segments.length === 4;
    if (shiny && segments[2] !== 'shiny') return { ok: false, reason: 'not-found' };
    const file = segments[segments.length - 1]!;
    const m = /^(\d{1,6})\.png$/.exec(file);
    if ((style !== 'pixel' && style !== 'art') || !m) return { ok: false, reason: 'not-found' };
    const id = m[1]!;
    return {
      ok: true,
      asset: {
        kind: 'sprite',
        style,
        id,
        shiny,
        relativePath: spriteRelativePath(style, id, shiny),
        canonicalSourceUrl: spriteSourceUrl(style, id, shiny),
        assetKind: 'sprite',
      },
    };
  }

  // Set imagery: sets/{setId}/{logo|symbol}.webp
  if (segments.length === 3 && segments[0] === 'sets') {
    const setId = segments[1]!;
    const file = segments[2]!;
    if (!safeSegment(setId)) return { ok: false, reason: 'not-found' };
    const m = /^(logo|symbol)\.webp$/.exec(file);
    if (!m) return { ok: false, reason: 'not-found' };
    const image = m[1] as SetImageKind;
    return {
      ok: true,
      asset: {
        kind: 'set',
        setId,
        image,
        relativePath: setImageRelativePath(setId, image),
        cacheKey: setImageCacheKey(setId, image),
        assetKind: image === 'logo' ? 'set-logo' : 'set-symbol',
      },
    };
  }

  // Card art: {lang}/{serie}/{set}/{localId}/{low|high}.webp
  if (segments.length === 5) {
    const [lang, serie, set, localId, file] = segments as [string, string, string, string, string];
    if (!safeSegment(serie) || !safeSegment(set) || !safeSegment(localId)) {
      return { ok: false, reason: 'not-found' };
    }
    const m = /^(low|high)\.webp$/.exec(file);
    const qual = m?.[1];
    // Structurally a card path, but not one we serve → 400 (apps/images parity).
    if (!qual || !isQuality(qual) || lang !== LANG) return { ok: false, reason: 'bad-request' };
    const ref: CardRef = { serie, set, localId };
    return {
      ok: true,
      asset: {
        kind: 'card',
        ref,
        quality: qual,
        relativePath: cardRelativePath(ref, qual),
        cacheKey: cardCacheKey(ref, qual),
        canonicalSourceUrl: cardSourceUrl(ref, qual),
        assetKind: 'card',
      },
    };
  }

  return { ok: false, reason: 'not-found' };
}

/**
 * Pull the image sub-path out of a request.
 *
 * Two shapes are accepted, because Vercel's rewrite hands us the capture group as
 * `?p=` while a direct/self-host request carries the original URL:
 *   1. `?p=en/sv/sv03.5/102/low.webp`  (the rewrite's capture group)
 *   2. `/deckscout/images/en/sv/sv03.5/102/low.webp` (the literal URL)
 * Anything else returns null — and null is a 404, never the SPA shell.
 */
export function imageSubPathFromUrl(rawUrl: string | undefined | null): string | null {
  if (!rawUrl) return null;
  const qIndex = rawUrl.indexOf('?');
  const pathname = qIndex === -1 ? rawUrl : rawUrl.slice(0, qIndex);

  if (qIndex !== -1) {
    // Read `p` RAW (no URLSearchParams) so the value is decoded exactly once, by
    // parseImagePath. Decoding twice is how allow-lists get walked past.
    for (const pair of rawUrl.slice(qIndex + 1).split('&')) {
      if (!pair.startsWith('p=')) continue;
      const raw = pair.slice(2).replace(/\+/g, '%20').replace(/^\/+/, '');
      if (raw.length > 0) return raw;
    }
  }

  if (!pathname.startsWith(IMAGE_URL_PREFIX)) return null;
  const sub = pathname.slice(IMAGE_URL_PREFIX.length);
  return sub.length > 0 ? sub : null;
}
