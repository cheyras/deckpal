/**
 * build-crosswalk.mts — build the TCGdex ↔ pokemontcg.io set-id + numbering
 * crosswalk that `research/card-art-residue.json` names as "still to build".
 *
 * UNTRACKED (Holo 2c PREP). Read-only against two public APIs; touches no
 * database, no bucket, no .env. Run it from the repo root:
 *
 *     pnpm --filter deckpal-api exec tsx ../../tools/card-art/build-crosswalk.mts
 *     # or, with no workspace at all:
 *     npx tsx tools/card-art/build-crosswalk.mts
 *
 * Flags:
 *   --out <path>     where to write the crosswalk (default tools/card-art/crosswalk.json)
 *   --cache <dir>    raw upstream JSON cache (default tools/card-art/.raw). Delete
 *                    it to force a refetch; keeping it makes re-runs free.
 *   --refresh        ignore the cache
 *
 * ── What it produces, and what it deliberately refuses to produce ────────────
 *
 * A mapping is only useful if a wrong entry is impossible rather than unlikely.
 * The failure mode this whole file is shaped around is the one
 * `.claude/skills/fill-missing-assets` warns about and `CARD-ART-SOURCES.md`
 * §2.2 records concretely: `ecard2` has a single card numbered `50` where TCGdex
 * splits `50a` / `50b`, so mapping either of ours onto it is GUESSING AT WHICH
 * ART IT IS. Silently wrong art is worse than no art, so:
 *
 *   - a localId that maps to more than one candidate number is UNMATCHED, with
 *     reason 'ambiguous', never resolved by picking the first;
 *   - every matched pair is name-checked against both catalogs, and a name
 *     disagreement demotes the pair to UNMATCHED with reason 'name-mismatch';
 *   - a set with no confident counterpart is `ptcgioSetId: null`, which the
 *     pipeline turns into a no-art-list entry rather than a fetch.
 *
 * Set matching runs a ladder, most-trustworthy first, and records WHICH rung
 * each set landed on so a reviewer can audit the weak ones:
 *   1. `manual`  — a pair already confirmed by fetching bytes. Seeded from
 *                  `packages/storage/src/setImageFallback.ts`, the 50-entry table
 *                  the owner approved on 2026-08-29; every id pair in it was
 *                  fetched and confirmed at that time.
 *   2. `id`      — the two catalogs use the same id string (base1, swsh9tg, …).
 *   3. `name+count` — normalised set names agree AND the card counts agree.
 *   4. `name`    — normalised set names agree, counts differ (a reprint/secret
 *                  count difference). Recorded, but flagged `review: true`.
 *   Anything else → null.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { getJson } from './http.mts';

// ── CLI ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function flag(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1]! : fallback;
}
const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const OUT = resolve(flag('out', resolve(HERE, 'crosswalk.json')));
const CACHE = resolve(flag('cache', resolve(HERE, '.raw')));
const REFRESH = argv.includes('--refresh');

// ── Cached fetch ─────────────────────────────────────────────────────────────
async function cachedJson<T>(name: string, url: string): Promise<T> {
  const file = resolve(CACHE, `${name}.json`);
  if (!REFRESH && existsSync(file)) {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as T;
    } catch {
      /* fall through and refetch */
    }
  }
  const data = await getJson<T>(url);
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, JSON.stringify(data), 'utf8');
  return data;
}

// ── Upstream shapes ──────────────────────────────────────────────────────────
interface TcgdexSet {
  id: string;
  name: string;
  cardCount?: { total?: number; official?: number };
}
interface TcgdexCard {
  id: string;
  localId: string;
  name: string;
}
interface PtcgioSet {
  id: string;
  name: string;
  series: string;
  printedTotal: number;
  total: number;
  releaseDate: string;
  ptcgoCode?: string;
}
interface PtcgioCard {
  id: string;
  name: string;
  number: string;
  images?: { small?: string; large?: string };
}

// ── Normalisation ────────────────────────────────────────────────────────────
/** Fold a set or card name to a comparison key. Aggressive on purpose. */
function foldName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // Pokemon accents folded
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Card-name folding is looser than set-name folding, because the two catalogs
 * genuinely spell the same printing differently: TCGdex writes `Charizard ex`
 * where pokemontcg.io writes `Charizard EX`, and one of them keeps the
 * `(Delta Species)` / `[Team Rocket's]` qualifier the other drops. So the check
 * is "one folded name is a prefix of the other", which still catches the failure
 * we care about (Flareon vs Vaporeon) and does not fire on a spelling variant.
 */
function cardNamesAgree(a: string, b: string): boolean {
  const x = foldName(a);
  const y = foldName(b);
  if (x === y) return true;
  if (x.length === 0 || y.length === 0) return false;
  return x.startsWith(y) || y.startsWith(x);
}

/** Numbering keys, cheapest first. Order matters: earlier = more trustworthy. */
function numberKeys(raw: string): string[] {
  const keys: string[] = [raw];
  const lower = raw.toLowerCase();
  if (lower !== raw) keys.push(lower);
  // '001' -> '1'; 'TG01' -> 'tg1'; 'SV001' -> 'sv1'
  const stripped = lower.replace(/(^|[a-z])0+(\d)/g, '$1$2');
  if (!keys.includes(stripped)) keys.push(stripped);
  return keys;
}

// ── Manual, already-confirmed set pairs ──────────────────────────────────────
/**
 * Seeded from `packages/storage/src/setImageFallback.ts` (owner-approved
 * 2026-08-29; every URL in it was fetched and confirmed) plus the three cases
 * `research/CARD-ART-SOURCES.md` §2.2 measured by hand. These are the only
 * hand-written pairs; everything else is derived and labelled with how.
 */
const MANUAL_SET_MAP: Record<string, string | null> = {
  // from setImageFallback.ts — confirmed by a successful byte fetch
  me02: 'me2',
  'sv08.5': 'sv8pt5',
  sv07: 'sv7',
  sv08: 'sv8',
  sv05: 'sv5',
  'swsh12.5gg': 'swsh12pt5gg',
  swsh12tg: 'swsh12tg',
  swsh11tg: 'swsh11tg',
  swsh10tg: 'swsh10tg',
  swsh9tg: 'swsh9tg',
  svp: 'svp',
  sve: 'sve',
  cel25cc: 'cel25c',
  'swsh4.5sv': 'swsh45sv',
  'sm3.5': 'sm35',
  'sm7.5': 'sm75',
  sma: 'sma',
  '2016xy': 'mcd16',
  '2022swsh': 'mcd22',
  '2014xy': 'mcd14',
  '2012bw': 'mcd12',
  '2019sm': 'mcd19',
  '2017sm': 'mcd17',
  '2018sm': 'mcd18',
  '2011bw': 'mcd11',
  '2015xy': 'mcd15',
  '2023sv': 'mcd23',
  '2024sv': 'mcd24',
  base1: 'base1',
  bog: 'bp',
  // EX-era Trainer Kits — CARD-ART-SOURCES §2.2: pokemontcg.io carries these four
  // and none of the XY / HS / BW / DP / SM kits.
  'tk-ex-m': 'tk2b',
};

/**
 * Sets pokemontcg.io is MEASURED not to carry (CARD-ART-SOURCES §2.2). Pinned so
 * a fuzzy name match can never invent a counterpart for them. Anything here goes
 * straight onto the no-art list.
 */
const KNOWN_ABSENT = new Set<string>(['mfb', 'xya']);

// ── Build ────────────────────────────────────────────────────────────────────
/**
 * One TCGdex card's resolved counterpart.
 *
 * `low` / `high` are the URLs pokemontcg.io ITSELF reports for the card, copied
 * verbatim — NEVER a template of the form `{setId}/{number}`. The Celebrations
 * Classic Collection is the counterexample that settles it: `cel25c` contains
 * four different cards all numbered `15`, whose ids are `15_A1`…`15_A4` and
 * whose images are `15_A`, `15_B`, `15_C`, `15_D`. Neither the number nor the id
 * yields the image path, so composing one would fetch the wrong card's art for
 * three of the four — silently, which is the exact failure the whole crosswalk
 * exists to make impossible.
 */
export interface CardLink {
  /** pokemontcg.io card id, e.g. 'swsh9tg-TG01' or 'cel25c-15_A2'. */
  id: string;
  /** Its printed collector number. Informational; NOT used to build a URL. */
  number: string;
  name: string;
  /** `images.small` — 245×342 class, fills our `low` slot. */
  low: string | null;
  /** `images.large` — 600×825 or better, fills our `high` slot. */
  high: string | null;
  /** Which rung matched this card. */
  via: 'number' | 'number-normalised' | 'name';
}

export interface NumberingEntry {
  /** TCGdex localId -> the pokemontcg.io card it resolves to. */
  map: Record<string, CardLink>;
  /** Every pokemontcg.io number in the set, for auditing. */
  numbers: string[];
  matchedByNumber: number;
  matchedByName: number;
  unmatched: Array<{ localId: string; reason: string; detail?: string }>;
}

export interface CrosswalkSet {
  tcgdexSetId: string;
  tcgdexName: string;
  tcgdexCards: number;
  ptcgioSetId: string | null;
  ptcgioName: string | null;
  ptcgioCards: number | null;
  match: 'manual' | 'id' | 'name+count' | 'name' | 'known-absent' | 'none';
  review: boolean;
  numbering: NumberingEntry | null;
}

export interface Crosswalk {
  generated: string;
  builtBy: string;
  source: {
    tcgdex: string;
    pokemontcgio: string;
    imageNote: string;
  };
  policy: string;
  counts: {
    tcgdexSets: number;
    ptcgioSets: number;
    setsMapped: number;
    setsUnmapped: number;
    cardsMapped: number;
    cardsUnmatched: number;
  };
  sets: Record<string, CrosswalkSet>;
}

async function main(): Promise<void> {
  const tSets = await cachedJson<TcgdexSet[]>('tcgdex-sets', 'https://api.tcgdex.net/v2/en/sets');
  const tCards = await cachedJson<TcgdexCard[]>(
    'tcgdex-cards',
    'https://api.tcgdex.net/v2/en/cards',
  );
  const pSetsRaw = await cachedJson<{ data: PtcgioSet[] }>(
    'ptcgio-sets',
    'https://api.pokemontcg.io/v2/sets?pageSize=500',
  );
  const pSets = pSetsRaw.data;

  // ── Group TCGdex cards by set via longest-id-prefix, because the catalog uses
  //    `{setId}-{localId}` and BOTH set ids and local ids may contain hyphens
  //    (`tk-bw-e-1`, `exu-!`). Splitting on a hyphen is wrong; prefix-matching
  //    against the known set-id list is not.
  const tSetIdsByLength = tSets.map((s) => s.id).sort((a, b) => b.length - a.length);
  const tBySet = new Map<string, TcgdexCard[]>();
  for (const c of tCards) {
    const set = tSetIdsByLength.find((id) => c.id.startsWith(`${id}-`));
    if (!set) continue;
    (tBySet.get(set) ?? tBySet.set(set, []).get(set)!).push(c);
  }

  /**
   * pokemontcg.io cards, fetched ONE SET AT A TIME.
   *
   * The obvious alternative — page the whole `/v2/cards` collection — was tried
   * first and DOES NOT WORK: `page=8&orderBy=id&pageSize=250` answers HTTP 500
   * deterministically, ten attempts over four minutes, while its neighbours
   * answer fine. A deep-offset sort failure on their side is not something a
   * retry ladder can fix, and a paging walk that silently skipped page 8 would
   * drop 250 cards out of the crosswalk without ever failing. Per-set queries
   * are bounded (the largest set is under 250 cards), individually cached, and a
   * failure names exactly which set is missing.
   */
  const pBySet = new Map<string, PtcgioCard[]>();
  async function ptcgioCardsForSet(setId: string): Promise<PtcgioCard[]> {
    const cached = pBySet.get(setId);
    if (cached) return cached;
    const all: PtcgioCard[] = [];
    for (let page = 1; ; page++) {
      const chunk = await cachedJson<{ data: PtcgioCard[]; totalCount: number }>(
        `ptcgio-set-${setId}-${page}`,
        `https://api.pokemontcg.io/v2/cards?q=set.id:${encodeURIComponent(setId)}` +
          `&select=id,name,number,images&pageSize=250&page=${page}`,
      );
      all.push(...chunk.data);
      if (chunk.data.length < 250) break;
      if (page > 20) throw new Error(`paging did not terminate for set ${setId}`);
    }
    pBySet.set(setId, all);
    return all;
  }

  // ── Set matching ladder ────────────────────────────────────────────────────
  const pById = new Map(pSets.map((s) => [s.id, s]));
  const pByName = new Map<string, PtcgioSet[]>();
  for (const s of pSets) {
    const k = foldName(s.name);
    (pByName.get(k) ?? pByName.set(k, []).get(k)!).push(s);
  }

  const sets: Record<string, CrosswalkSet> = {};
  let cardsMapped = 0;
  let cardsUnmatched = 0;

  for (const ts of tSets) {
    const tCardsOfSet = tBySet.get(ts.id) ?? [];
    const entry: CrosswalkSet = {
      tcgdexSetId: ts.id,
      tcgdexName: ts.name,
      tcgdexCards: tCardsOfSet.length,
      ptcgioSetId: null,
      ptcgioName: null,
      ptcgioCards: null,
      match: 'none',
      review: false,
      numbering: null,
    };

    let ps: PtcgioSet | undefined;
    if (KNOWN_ABSENT.has(ts.id)) {
      entry.match = 'known-absent';
    } else if (Object.prototype.hasOwnProperty.call(MANUAL_SET_MAP, ts.id)) {
      const manual = MANUAL_SET_MAP[ts.id];
      ps = manual ? pById.get(manual) : undefined;
      if (ps) entry.match = 'manual';
    } else if (pById.has(ts.id)) {
      ps = pById.get(ts.id)!;
      entry.match = 'id';
    } else {
      const cands = pByName.get(foldName(ts.name)) ?? [];
      const byCount = cands.filter(
        (c) => c.total === tCardsOfSet.length || c.printedTotal === tCardsOfSet.length,
      );
      if (byCount.length === 1) {
        ps = byCount[0]!;
        entry.match = 'name+count';
      } else if (cands.length === 1) {
        ps = cands[0]!;
        entry.match = 'name';
        entry.review = true;
      }
    }

    if (ps) {
      entry.ptcgioSetId = ps.id;
      entry.ptcgioName = ps.name;
      const pOfSet = await ptcgioCardsForSet(ps.id);
      console.log(
        `[crosswalk] ${ts.id} -> ${ps.id} (${entry.match}) ${tCardsOfSet.length} tcgdex / ${pOfSet.length} ptcgio`,
      );
      entry.ptcgioCards = pOfSet.length;
      entry.numbering = buildNumbering(tCardsOfSet, pOfSet);
      cardsMapped += entry.numbering.matchedByNumber + entry.numbering.matchedByName;
      cardsUnmatched += entry.numbering.unmatched.length;
    } else {
      cardsUnmatched += tCardsOfSet.length;
    }
    sets[ts.id] = entry;
  }

  const mapped = Object.values(sets).filter((s) => s.ptcgioSetId !== null).length;
  const out: Crosswalk = {
    generated: new Date().toISOString().slice(0, 10),
    builtBy: 'tools/card-art/build-crosswalk.mts (Holo 2c PREP, untracked)',
    source: {
      tcgdex: 'https://api.tcgdex.net/v2/en',
      pokemontcgio: 'https://api.pokemontcg.io/v2',
      imageNote:
        'Image URLs are copied verbatim from pokemontcg.io per card (sets[].numbering.map[].low/high). ' +
        'They are NOT composable from {setId}/{number}: cel25c holds four cards numbered 15 whose images ' +
        'are 15_A/15_B/15_C/15_D, so a template would serve the wrong art for three of them.',
    },
    policy:
      'pokemontcg.io is the approved card-art fallback (research/CARD-ART-SOURCES.md §2.2 / §7). ' +
      'TCGdex remains primary. TCGplayer is ruled out (§2.3). No other host may be added ' +
      'without a DECISIONS.md entry and an IMAGE_SOURCE_HOSTS change.',
    counts: {
      tcgdexSets: tSets.length,
      ptcgioSets: pSets.length,
      setsMapped: mapped,
      setsUnmapped: tSets.length - mapped,
      cardsMapped,
      cardsUnmatched,
    },
    sets,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(
    `[crosswalk] wrote ${OUT}\n` +
      `  sets: ${mapped} mapped / ${tSets.length - mapped} unmapped (of ${tSets.length})\n` +
      `  cards: ${cardsMapped} mapped / ${cardsUnmatched} unmatched`,
  );
}

function buildNumbering(tCards: TcgdexCard[], pCards: PtcgioCard[]): NumberingEntry {
  // Index by every number key form, and separately by folded card name. Both
  // track collisions, because a collision is the signal to REFUSE.
  const byNumber = new Map<string, PtcgioCard[]>();
  for (const c of pCards) {
    for (const k of numberKeys(c.number)) {
      (byNumber.get(k) ?? byNumber.set(k, []).get(k)!).push(c);
    }
  }
  const byCardName = new Map<string, PtcgioCard[]>();
  for (const c of pCards) {
    const k = foldName(c.name);
    (byCardName.get(k) ?? byCardName.set(k, []).get(k)!).push(c);
  }

  const map: Record<string, CardLink> = {};
  const unmatched: NumberingEntry['unmatched'] = [];
  let matchedByNumber = 0;
  let matchedByName = 0;

  const uniq = (cards: PtcgioCard[]): PtcgioCard[] => [
    ...new Map(cards.map((c) => [c.id, c])).values(),
  ];

  for (const t of tCards) {
    let hit: PtcgioCard | null = null;
    let via: CardLink['via'] = 'number';
    let ambiguous = false;

    // ── Rung 1: the collector number ─────────────────────────────────────────
    const keys = numberKeys(t.localId);
    for (let i = 0; i < keys.length; i++) {
      const cands = byNumber.get(keys[i]!);
      if (!cands || cands.length === 0) continue;
      const unique = uniq(cands);
      if (unique.length > 1) {
        // One number, several printings — the `ecard2` 50a/50b shape and the
        // `cel25c` four-cards-at-#15 shape. Refuse; do not pick.
        ambiguous = true;
        break;
      }
      hit = unique[0]!;
      via = i === 0 ? 'number' : 'number-normalised';
      break;
    }

    // ── Rung 2: the card name, but only when it is unambiguous BOTH ways ─────
    // This is what recovers the Celebrations Classic Collection, where our
    // `CC001`-style local ids share no number space with the original-set
    // numbers upstream reprints them under. It is only safe when exactly one
    // upstream card carries the name AND our own set has exactly one card with
    // it — otherwise a set with two Pikachus would resolve both to one image.
    if (!hit && !ambiguous) {
      const key = foldName(t.name);
      const cands = uniq(byCardName.get(key) ?? []);
      const ownWithName = tCards.filter((x) => foldName(x.name) === key);
      if (cands.length === 1 && ownWithName.length === 1) {
        hit = cands[0]!;
        via = 'name';
      } else if (cands.length > 1 || ownWithName.length > 1) {
        ambiguous = true;
      }
    }

    if (ambiguous) {
      unmatched.push({
        localId: t.localId,
        reason: 'ambiguous',
        detail: `'${t.name}' — more than one candidate printing; refusing to guess which art it is`,
      });
      continue;
    }
    if (!hit) {
      unmatched.push({ localId: t.localId, reason: 'no-such-number' });
      continue;
    }
    if (!cardNamesAgree(t.name, hit.name)) {
      unmatched.push({
        localId: t.localId,
        reason: 'name-mismatch',
        detail: `tcgdex='${t.name}' ptcgio='${hit.name}' (${hit.id})`,
      });
      continue;
    }
    if (!hit.images?.large && !hit.images?.small) {
      unmatched.push({
        localId: t.localId,
        reason: 'no-image-url',
        detail: `${hit.id} matched but pokemontcg.io reports no image for it`,
      });
      continue;
    }

    map[t.localId] = {
      id: hit.id,
      number: hit.number,
      name: hit.name,
      low: hit.images?.small ?? null,
      high: hit.images?.large ?? null,
      via,
    };
    if (via === 'name') matchedByName++;
    else matchedByNumber++;
  }

  return {
    map,
    numbers: pCards.map((c) => c.number),
    matchedByNumber,
    matchedByName,
    unmatched,
  };
}

await main();
