import type { SetImageKind } from './paths.js';

/**
 * Set-image fallback crosswalk — the 43 (setId, kind) pairs the catalog cannot
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
 * The remaining residue (`xya`, `2021swsh`, `2024sv`, `2023sv`, `exu`, `ex5.5`,
 * `miscp`, the `tk-*` symbol rows, and `mfb`'s symbol) has no approved source:
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
 * The 43 approved (setId, kind) → sourceUrl mappings. A literal table, never
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
