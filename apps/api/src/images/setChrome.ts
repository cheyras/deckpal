import { setImageFallbackUrl, type SetImageKind } from '@deckpal/storage';

/**
 * The upstream URL a set's logo or symbol is filled from, as the API reports it
 * (`logoUrl` / `symbolUrl` on the series, set and card payloads): the catalog's
 * own column, else the approved crosswalk entry the image tier falls back to
 * (`resolveSourceFromManifest` in `handler.ts`), else null.
 *
 * WHY THE CROSSWALK IS REPORTED HERE TOO. The SPA decides whether to ask for a
 * set's logo at all from `logoUrl`: a set with no logo anywhere renders its name
 * instead, with no wasted request and no layout shift when the request fails.
 * But `card_set.logo_url` is NULL for exactly the sets the crosswalk fills —
 * that is what makes them crosswalk entries — so reporting only the column hid
 * 15 approved logos the image tier was serving (Temporal Forces, the Trainer and
 * Galarian Galleries, My First Battle and eight more), and the series page and
 * set header showed their names instead (found 2026-11-27).
 *
 * Reporting the URL the tier will actually fetch keeps the two in step: a pair
 * the crosswalk does not know still reports null, and a catalog column, when
 * present, always wins — the same order the image tier resolves in.
 */
export function setChromeUrl(setId: string, kind: SetImageKind, catalogUrl: string | null): string | null {
  return catalogUrl ?? setImageFallbackUrl(setId, kind);
}
