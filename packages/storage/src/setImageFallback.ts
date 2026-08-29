import type { SetImageKind } from './paths.js';

/**
 * Set-image fallback crosswalk — the 50 (setId, kind) pairs the catalog cannot
 * source (`card_set.logo_url` / `card_set.symbol_url` are NULL for them) but for
 * which an approved image EXISTS upstream and has been fetched + confirmed.
 *
 * The set warmer (`apps/images/src/setWarmer.ts`) still prefers a non-null
 * catalog column; this table is consulted only when that column is NULL. A set
 * we already serve (a row whose column is populated) is NOT in this table, so
 * `setImageFallbackUrl` returns null for it — the catalog URL wins.
 *
 * Source: `inputs/fill-worklist.json` (generated 2026-08-29). Every URL below
 * has been fetched and confirmed to return an image. DO NOT re-derive this list,
 * DO NOT add to it, DO NOT drop from it — the owner approved it on 2026-08-29.
 *
 * ── Why classes are EXCLUDED (do not helpfully "complete" the table) ──────────
 *
 * McDonald's Collection LOGOS (12): excluded on a standing trademark ruling
 * (DECISIONS.md 2026-08-10). Nine of the twelve pokemontcg.io `mcd*` logo files
 * are the byte-identical corporate Golden Arches wordmark, not a set logo —
 * reproducing them is the same third-party-trademark exposure the Poké Ball /
 * POKÉMON wordmark icons were replaced for. The McDonald's SYMBOLS are a
 * different file: a genuine printed expansion mark, so they ARE included
 * (owner decision 2026-08-29).
 *
 * EX Trainer Kit LOGOS (the `tk-*` / `tk-ex-*` logo rows): excluded by the
 * owner's 2026-08-29 Trainer Kit decision — the four EX Trainer Kit sets share
 * one byte-identical generic wordmark that would show the SAME logo on four
 * different sets, which reads as a bug rather than a real set identity.
 *
 * TRAINER KIT LOGOS ARE A SETTLED DEAD END (2026-08-29, with byte evidence):
 * pokemontcg.io serves ONE logo for all four EX kits (md5
 * 5ee8b8810dc52db8faaf04eefc337bf9) and Bulbagarden Archives holds no Trainer
 * Kit logo files at all — only per-half-deck SYMBOLS. Real per-kit logos do
 * not exist in any approved source, so all 20 keep their text treatment.
 * Eight further pairs (mfb symbol, miscp symbol+logo, mee logo, mep logo, xya
 * logo, exu logo, ex5.5 logo) returned nothing across TCGdex in all languages,
 * Bulbagarden and Wikimedia Commons: they are promo aggregates, energy subsets
 * and variant groupings that have no logo as a concept.
 * no confirmed image upstream, or the only candidate is one of the excluded
 * classes above. These stay blank; the UI's derived acronym tag is the correct
 * rendering for them.
 */

export interface SetImageFallbackEntry {
  setId: string;
  kind: SetImageKind;
  sourceUrl: string;
}

/**
 * The 50 approved (setId, kind) → sourceUrl mappings. A literal table, never
 * read from a file at runtime. Exported so tests and tooling can enumerate it.
 */
export const SET_IMAGE_FALLBACK_TABLE: readonly SetImageFallbackEntry[] = [
  // ── symbols (28) ──────────────────────────────────────────────────────────
  { setId: 'me02', kind: 'symbol', sourceUrl: 'https://images.pokemontcg.io/me2/symbol.png' },
  { setId: 'sv08.5', kind: 'symbol', sourceUrl: 'https://images.pokemontcg.io/sv8pt5/symbol.png' },
  { setId: 'sv07', kind: 'symbol', sourceUrl: 'https://images.pokemontcg.io/sv7/symbol.png' },
  { setId: 'sv08', kind: 'symbol', sourceUrl: 'https://images.pokemontcg.io/sv8/symbol.png' },
  { setId: 'swsh12.5gg', kind: 'symbol', sourceUrl: 'https://images.pokemontcg.io/swsh12pt5gg/symbol.png' },
  { setId: 'swsh12tg', kind: 'symbol', sourceUrl: 'https://images.pokemontcg.io/swsh12tg/symbol.png' },
  { setId: 'svp', kind: 'symbol', sourceUrl: 'https://images.pokemontcg.io/svp/symbol.png' },
  { setId: 'sve', kind: 'symbol', sourceUrl: 'https://images.pokemontcg.io/sve/symbol.png' },
  { setId: 'swsh11tg', kind: 'symbol', sourceUrl: 'https://images.pokemontcg.io/swsh11tg/symbol.png' },
  { setId: 'swsh10tg', kind: 'symbol', sourceUrl: 'https://images.pokemontcg.io/swsh10tg/symbol.png' },
  { setId: 'swsh9tg', kind: 'symbol', sourceUrl: 'https://images.pokemontcg.io/swsh9tg/symbol.png' },
  { setId: 'cel25cc', kind: 'symbol', sourceUrl: 'https://images.pokemontcg.io/cel25c/symbol.png' },
  { setId: 'swsh4.5sv', kind: 'symbol', sourceUrl: 'https://images.pokemontcg.io/swsh45sv/symbol.png' },
  { setId: 'sm3.5', kind: 'symbol', sourceUrl: 'https://images.pokemontcg.io/sm35/symbol.png' },
  { setId: 'sm7.5', kind: 'symbol', sourceUrl: 'https://images.pokemontcg.io/sm75/symbol.png' },
  { setId: '2016xy', kind: 'symbol', sourceUrl: 'https://images.pokemontcg.io/mcd16/symbol.png' },
  { setId: '2022swsh', kind: 'symbol', sourceUrl: 'https://images.pokemontcg.io/mcd22/symbol.png' },
  { setId: '2014xy', kind: 'symbol', sourceUrl: 'https://images.pokemontcg.io/mcd14/symbol.png' },
  { setId: '2012bw', kind: 'symbol', sourceUrl: 'https://images.pokemontcg.io/mcd12/symbol.png' },
  { setId: '2019sm', kind: 'symbol', sourceUrl: 'https://images.pokemontcg.io/mcd19/symbol.png' },
  { setId: '2017sm', kind: 'symbol', sourceUrl: 'https://images.pokemontcg.io/mcd17/symbol.png' },
  { setId: '2018sm', kind: 'symbol', sourceUrl: 'https://images.pokemontcg.io/mcd18/symbol.png' },
  { setId: '2011bw', kind: 'symbol', sourceUrl: 'https://images.pokemontcg.io/mcd11/symbol.png' },
  { setId: '2015xy', kind: 'symbol', sourceUrl: 'https://images.pokemontcg.io/mcd15/symbol.png' },
  { setId: 'tk-ex-m', kind: 'symbol', sourceUrl: 'https://images.pokemontcg.io/tk2b/symbol.png' },
  { setId: 'base1', kind: 'symbol', sourceUrl: 'https://images.pokemontcg.io/base1/symbol.png' },
  { setId: 'mee', kind: 'symbol', sourceUrl: 'https://archives.bulbagarden.net/media/upload/f/fb/SetSymbolMEE_Basic_Energies.png' },
  { setId: 'mep', kind: 'symbol', sourceUrl: 'https://archives.bulbagarden.net/media/upload/0/0c/SetSymbolMEP_Black_Star_Promos.png' },
  // ── logos (15) ────────────────────────────────────────────────────────────
  { setId: 'sv05', kind: 'logo', sourceUrl: 'https://images.pokemontcg.io/sv5/logo.png' },
  { setId: 'swsh12.5gg', kind: 'logo', sourceUrl: 'https://images.pokemontcg.io/swsh12pt5gg/logo.png' },
  { setId: 'swsh12tg', kind: 'logo', sourceUrl: 'https://images.pokemontcg.io/swsh12tg/logo.png' },
  { setId: 'svp', kind: 'logo', sourceUrl: 'https://images.pokemontcg.io/svp/logo.png' },
  { setId: 'sve', kind: 'logo', sourceUrl: 'https://images.pokemontcg.io/sve/logo.png' },
  { setId: 'swsh11tg', kind: 'logo', sourceUrl: 'https://images.pokemontcg.io/swsh11tg/logo.png' },
  { setId: 'swsh10tg', kind: 'logo', sourceUrl: 'https://images.pokemontcg.io/swsh10tg/logo.png' },
  { setId: 'swsh9tg', kind: 'logo', sourceUrl: 'https://images.pokemontcg.io/swsh9tg/logo.png' },
  { setId: 'cel25cc', kind: 'logo', sourceUrl: 'https://images.pokemontcg.io/cel25c/logo.png' },
  { setId: 'swsh4.5sv', kind: 'logo', sourceUrl: 'https://images.pokemontcg.io/swsh45sv/logo.png' },
  { setId: 'sma', kind: 'logo', sourceUrl: 'https://images.pokemontcg.io/sma/logo.png' },
  { setId: 'sm3.5', kind: 'logo', sourceUrl: 'https://images.pokemontcg.io/sm35/logo.png' },
  { setId: 'sm7.5', kind: 'logo', sourceUrl: 'https://images.pokemontcg.io/sm75/logo.png' },
  { setId: 'bog', kind: 'logo', sourceUrl: 'https://images.pokemontcg.io/bp/logo.png' },
  { setId: 'mfb', kind: 'logo', sourceUrl: 'https://archives.bulbagarden.net/media/upload/1/1d/My_First_Battle_logo.png' },

  // ── Added 2026-08-29 (second sourcing pass) ────────────────────────────────
  // Found only after sweeping TCGdex across ALL languages and Bulbagarden's
  // MediaWiki category listings; a set-name search finds none of them. The two
  // BW Trainer Kit half-deck symbols were previously reported as genuine
  // upstream gaps — they exist, under "<Pokemon> Half Deck" rather than under
  // the kit's name, which is why the first pass missed them.
  { setId: 'tk-bw-e', kind: 'symbol', sourceUrl: 'https://archives.bulbagarden.net/media/upload/1/1f/SetSymbolExcadrill_Half_Deck.png' },
  { setId: 'tk-bw-z', kind: 'symbol', sourceUrl: 'https://archives.bulbagarden.net/media/upload/0/01/SetSymbolZoroark_Half_Deck.png' },
  { setId: 'exu', kind: 'symbol', sourceUrl: 'https://archives.bulbagarden.net/media/upload/6/63/SetSymbolUnseen_Forces.png' },
  { setId: 'xya', kind: 'symbol', sourceUrl: 'https://archives.bulbagarden.net/media/upload/e/ed/Yellow_A_symbol.png' },
  // McDonald's SYMBOLS only. The 12 McDonald's LOGOS remain excluded on
  // trademark grounds (DECISIONS 2026-08-10, reconfirmed 2026-08-29: nine are
  // one byte-identical 76,597-byte corporate mark). These symbols are distinct
  // files and are the genuine printed expansion marks.
  { setId: '2023sv', kind: 'symbol', sourceUrl: 'https://archives.bulbagarden.net/media/upload/9/91/SetSymbolMcDonalds_Collection_2023.png' },
  { setId: '2024sv', kind: 'symbol', sourceUrl: 'https://archives.bulbagarden.net/media/upload/7/71/SetSymbolMcDonalds_Collection_2024.png' },
  // TCGdex has this one under `en` after all; the first pass only ever asked
  // the catalog, which stores NULL for it.
  { setId: 'ex5.5', kind: 'symbol', sourceUrl: 'https://assets.tcgdex.net/en/ex/ex5.5/symbol.webp' },
];

const FALLBACK_BY_KEY: ReadonlyMap<string, string> = new Map(
  SET_IMAGE_FALLBACK_TABLE.map((e) => [`${e.setId}|${e.kind}`, e.sourceUrl] as [string, string]),
);

/**
 * The approved source URL for an approved (setId, kind) pair, or null for
 * everything else: unknown ids, empty strings, residue pairs, and any set we
 * already serve from the catalog (those are not in this table). Pure and
 * dependency-free; the table is a literal, never read from a file at runtime.
 */
export function setImageFallbackUrl(setId: string, kind: SetImageKind): string | null {
  if (typeof setId !== 'string' || setId.length === 0) return null;
  return FALLBACK_BY_KEY.get(`${setId}|${kind}`) ?? null;
}

/** Every URL in the table, for an exact-membership check. */
const FALLBACK_URLS: ReadonlySet<string> = new Set(SET_IMAGE_FALLBACK_TABLE.map((e) => e.sourceUrl));

/** True only for a URL that is literally in the table above. */
export function isSetImageFallbackUrl(url: string): boolean {
  return FALLBACK_URLS.has(url);
}

/**
 * The upstream policy for fetching a crosswalk asset — and ONLY for that.
 *
 * The cloud tier's default `IMAGE_SOURCE_POLICY` allow-lists two hosts
 * (assets.tcgdex.net, raw.githubusercontent.com) because those are the only
 * origins a CARD path can derive. 49 of the 50 entries here live on two other
 * hosts, so under that policy every crosswalk fetch is refused and the whole
 * table is inert on the cloud tier — the third failure of exactly that class in
 * this feature, caught in review rather than in production.
 *
 * This does NOT widen the global control. It is a SEPARATE policy, used only on
 * the set-fallback path, and it is strictly tighter than a host allow-list:
 * callers must ALSO pass `isSetImageFallbackUrl()`, so the only fetchable URLs
 * are the ~50 literals compiled into this file. No user input reaches it, there
 * is no derivable URL space, and adding a host here is impossible without also
 * adding a table row that review would see.
 *
 * The hosts are DERIVED from the table so the two can never drift apart.
 */
const FALLBACK_ORIGINS: ReadonlyMap<string, string> = new Map(
  SET_IMAGE_FALLBACK_TABLE.map((e) => {
    const u = new URL(e.sourceUrl);
    return [u.host, `${u.protocol}//${u.host}`] as [string, string];
  }),
);

export const SET_IMAGE_FALLBACK_POLICY = {
  originFor(host: string): string | null {
    return FALLBACK_ORIGINS.get(host) ?? null;
  },
  allowPrivateAddresses: false,
};
