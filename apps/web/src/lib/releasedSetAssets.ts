/**
 * BUNDLED LOGO OVERRIDES — released sets whose upstream logo is absent.
 *
 * TCGdex occasionally publishes a set with empty `logo` / `symbol` fields.
 * When DeckPal already carries an approved logo in the bundle (e.g. from the
 * upcoming-set placeholder that preceded the catalog import), this table lets
 * `SetLogo` resolve that same asset instead of showing nothing.
 *
 * Entries here are a TEMPORARY bridge: once upstream populates the logo and the
 * next catalog refresh lands it, the image tier serves the real asset and the
 * fallback is never reached. Stale entries are harmless — the image tier wins
 * whenever it has an answer.
 *
 * Keys are TCGdex set ids (the `setId` that `SetLogo` receives).
 * Values are paths relative to `apps/web/public/`, root-relative so they work
 * with both the cloud build (`BASE_URL=/`) and the self-host build
 * (`BASE_URL=/deckpal/`) when prefixed by `import.meta.env.BASE_URL`.
 */
const BUNDLED_SET_LOGOS: Readonly<Record<string, string>> = {
  // 30th Celebration — approved official logo, used by the upcoming-set
  // placeholder before the set was published by TCGdex on 2026-09-16.
  // TCGdex set id: 30th; upstream logo/symbol fields are empty at launch.
  '30th': '/brand/pokemon-30th-celebration-logo.webp',
}

/**
 * Returns the bundled logo path for a released set, or `null` if the set
 * should use the normal image tier. The path is root-relative and must be
 * prefixed with `import.meta.env.BASE_URL` before use.
 */
export function bundledSetLogo(setId: string): string | null {
  return BUNDLED_SET_LOGOS[setId] ?? null
}
