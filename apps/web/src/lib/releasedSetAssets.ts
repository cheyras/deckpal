/**
 * SET LOGOS THE WEB BUNDLE CARRIES ITSELF — two kinds, with opposite precedence.
 *
 * 1. OFFICIAL (`BUNDLED_SET_LOGOS`): a set's own published logo that the image
 *    tier has no catalog source for. TCGdex occasionally publishes a set with
 *    empty `logo` / `symbol` fields; when DeckPal already carries an approved
 *    copy of the real logo, `SetLogo` falls back to it AFTER the image tier.
 *    Stale entries are harmless — the tier wins whenever it has an answer.
 *
 * 2. TEMPLATE (`TEMPLATE_SET_LOGOS`): DeckPal's own logo for a set that has NO
 *    official logo anywhere — promo pools, energy sets, subsets, trainer kits,
 *    McDonald's collections, one-off packs. Each is composited by
 *    `tools/set-logo-templates/` (PhotoCraft templates fed only from the app's
 *    own image tier; its README has the provenance) and shipped from
 *    `apps/web/public/set-logos/`. Owner-approved for all 59 sets on 2026-11-27
 *    ("let's get all of it in, and … let's make that our go to for those").
 *
 *    A template OUTRANKS the image tier, but only over the placeholder it was
 *    made to replace. For some of these sets the tier serves something that is
 *    not the set's own logo — the shared generic PROMO star, the generic
 *    "Pokémon Trading Card Game" wordmark, or the parent set's wordmark — and
 *    the API reports that file's upstream URL as `logoUrl`. `replaces` lists
 *    exactly those URLs, as the live API reported them on 2026-11-27. So:
 *
 *      logoUrl null              → nothing upstream: the template shows.
 *      logoUrl in `replaces`     → a known placeholder: the template shows.
 *      logoUrl anything else     → upstream now has a logo of its own for this
 *                                  set: IT wins, and the template steps aside
 *                                  (it stays the last-resort fallback).
 *      logoUrl unknown (omitted) → the caller cannot say, so the tier goes first.
 *
 *    That is how "a set's own official logo always wins" stays true without
 *    anyone remembering to delete a row here.
 *
 * Keys are TCGdex set ids (the `setId` that `SetLogo` receives). Paths are
 * relative to `apps/web/public/` and root-relative, so they work under both the
 * cloud build (`BASE_URL=/`) and the self-host build (`BASE_URL=/deckpal/`)
 * once prefixed with `import.meta.env.BASE_URL`. Every path here is a literal:
 * `scripts/check-precache.mjs` reads them out of this file and fails the build
 * if one is missing from `dist/` (the blanket `**\/*.webp` ignore rules in
 * `.gitignore` and `.vercelignore` have swallowed bundled assets before).
 */
const BUNDLED_SET_LOGOS: ReadonlyMap<string, string> = new Map([
  // 30th Celebration — approved official logo, used by the upcoming-set
  // placeholder before the set was published by TCGdex on 2026-09-16.
  // TCGdex set id: 30th; upstream logo/symbol fields are empty at launch.
  ['30th', '/brand/pokemon-30th-celebration-logo.webp'],
  // (30th-c, its Classic Collection, borrowed this parent logo until
  // 2026-11-27; it now has a template logo of its own, below.)
])

export type SetLogoTemplate = 'promo-stack' | 'energy-row' | 'subset-tag' | 'product-plate'

export interface TemplateSetLogo {
  /** The shipped file, `/set-logos/<setId>.webp`. */
  path: string
  /** Which template in `tools/set-logo-templates/templates/` drew it. */
  template: SetLogoTemplate
  /**
   * The placeholder `logoUrl`s this template outranks (see the header). Absent
   * when the API reported no logo at all for the set.
   */
  replaces?: readonly string[]
}

// The placeholders, by upstream file. TCGdex's promo-pool logos are one shared
// generic PROMO star (seven byte-identical files, md5 a4eb9afd…, plus xyp's
// own copy); pokemontcg.io's svp file is the same star, its sve and bp files
// the generic Pokémon TCG wordmark, and its subset files the parent set's
// wordmark (2026-11-27 logo audit).
const tcgdex = (serie: string, set: string) => `https://assets.tcgdex.net/en/${serie}/${set}/logo`
const ptcgio = (set: string) => `https://images.pokemontcg.io/${set}/logo.png`

const TEMPLATE_SET_LOGOS: ReadonlyMap<string, TemplateSetLogo> = new Map<string, TemplateSetLogo>([
  // ── promo-stack: series wordmark over the Black Star Promo mark ─────────────
  ['mep', { path: '/set-logos/mep.webp', template: 'promo-stack' }],
  ['svp', { path: '/set-logos/svp.webp', template: 'promo-stack', replaces: [ptcgio('svp')] }],
  ['swshp', { path: '/set-logos/swshp.webp', template: 'promo-stack', replaces: [tcgdex('swsh', 'swshp')] }],
  ['smp', { path: '/set-logos/smp.webp', template: 'promo-stack', replaces: [tcgdex('sm', 'smp')] }],
  ['xyp', { path: '/set-logos/xyp.webp', template: 'promo-stack', replaces: [tcgdex('xy', 'xyp')] }],
  ['bwp', { path: '/set-logos/bwp.webp', template: 'promo-stack', replaces: [tcgdex('bw', 'bwp')] }],
  ['hgssp', { path: '/set-logos/hgssp.webp', template: 'promo-stack', replaces: [tcgdex('hgss', 'hgssp')] }],
  ['dpp', { path: '/set-logos/dpp.webp', template: 'promo-stack', replaces: [tcgdex('dp', 'dpp')] }],
  ['np', { path: '/set-logos/np.webp', template: 'promo-stack', replaces: [tcgdex('pop', 'np')] }],
  ['basep', { path: '/set-logos/basep.webp', template: 'promo-stack', replaces: [tcgdex('base', 'basep')] }],
  ['miscp', { path: '/set-logos/miscp.webp', template: 'promo-stack' }],
  // ── energy-row: series wordmark over a tray of energy symbols ───────────────
  ['mee', { path: '/set-logos/mee.webp', template: 'energy-row' }],
  ['sve', { path: '/set-logos/sve.webp', template: 'energy-row', replaces: [ptcgio('sve')] }],
  // ── subset-tag: parent set logo with a subset ribbon ────────────────────────
  ['swsh12tg', { path: '/set-logos/swsh12tg.webp', template: 'subset-tag', replaces: [ptcgio('swsh12tg')] }],
  ['swsh11tg', { path: '/set-logos/swsh11tg.webp', template: 'subset-tag', replaces: [ptcgio('swsh11tg')] }],
  ['swsh10tg', { path: '/set-logos/swsh10tg.webp', template: 'subset-tag', replaces: [ptcgio('swsh10tg')] }],
  ['swsh9tg', { path: '/set-logos/swsh9tg.webp', template: 'subset-tag', replaces: [ptcgio('swsh9tg')] }],
  ['swsh12.5gg', { path: '/set-logos/swsh12.5gg.webp', template: 'subset-tag', replaces: [ptcgio('swsh12pt5gg')] }],
  ['swsh4.5sv', { path: '/set-logos/swsh4.5sv.webp', template: 'subset-tag', replaces: [ptcgio('swsh45sv')] }],
  ['sma', { path: '/set-logos/sma.webp', template: 'subset-tag', replaces: [ptcgio('sma')] }],
  ['cel25cc', { path: '/set-logos/cel25cc.webp', template: 'subset-tag', replaces: [ptcgio('cel25c')] }],
  ['30th-c', { path: '/set-logos/30th-c.webp', template: 'subset-tag' }],
  ['exu', { path: '/set-logos/exu.webp', template: 'subset-tag' }],
  ['xya', { path: '/set-logos/xya.webp', template: 'subset-tag' }],
  // ── product-plate: era wordmark over a name plate ───────────────────────────
  // Trainer kits: each plate carries the kit's own Pokémon, so no two rows look
  // alike (the 2026-08-29 objection to one shared "Trainer Kit" wordmark).
  ['tk-ex-latia', { path: '/set-logos/tk-ex-latia.webp', template: 'product-plate' }],
  ['tk-ex-latio', { path: '/set-logos/tk-ex-latio.webp', template: 'product-plate' }],
  ['tk-ex-p', { path: '/set-logos/tk-ex-p.webp', template: 'product-plate' }],
  ['tk-ex-m', { path: '/set-logos/tk-ex-m.webp', template: 'product-plate' }],
  ['tk-dp-l', { path: '/set-logos/tk-dp-l.webp', template: 'product-plate' }],
  ['tk-dp-m', { path: '/set-logos/tk-dp-m.webp', template: 'product-plate' }],
  ['tk-hs-g', { path: '/set-logos/tk-hs-g.webp', template: 'product-plate' }],
  ['tk-hs-r', { path: '/set-logos/tk-hs-r.webp', template: 'product-plate' }],
  ['tk-bw-e', { path: '/set-logos/tk-bw-e.webp', template: 'product-plate' }],
  ['tk-bw-z', { path: '/set-logos/tk-bw-z.webp', template: 'product-plate' }],
  ['tk-xy-sy', { path: '/set-logos/tk-xy-sy.webp', template: 'product-plate' }],
  ['tk-xy-n', { path: '/set-logos/tk-xy-n.webp', template: 'product-plate' }],
  ['tk-xy-b', { path: '/set-logos/tk-xy-b.webp', template: 'product-plate' }],
  ['tk-xy-w', { path: '/set-logos/tk-xy-w.webp', template: 'product-plate' }],
  ['tk-xy-latia', { path: '/set-logos/tk-xy-latia.webp', template: 'product-plate' }],
  ['tk-xy-latio', { path: '/set-logos/tk-xy-latio.webp', template: 'product-plate' }],
  ['tk-xy-p', { path: '/set-logos/tk-xy-p.webp', template: 'product-plate' }],
  ['tk-xy-su', { path: '/set-logos/tk-xy-su.webp', template: 'product-plate' }],
  ['tk-sm-l', { path: '/set-logos/tk-sm-l.webp', template: 'product-plate' }],
  ['tk-sm-r', { path: '/set-logos/tk-sm-r.webp', template: 'product-plate' }],
  // McDonald's: the product named in plain type over the era's TCG wordmark.
  // Never the Golden Arches or any McDonald's artwork (2026-08-10 ruling).
  ['2011bw', { path: '/set-logos/2011bw.webp', template: 'product-plate' }],
  ['2012bw', { path: '/set-logos/2012bw.webp', template: 'product-plate' }],
  ['2014xy', { path: '/set-logos/2014xy.webp', template: 'product-plate' }],
  ['2015xy', { path: '/set-logos/2015xy.webp', template: 'product-plate' }],
  ['2016xy', { path: '/set-logos/2016xy.webp', template: 'product-plate' }],
  ['2017sm', { path: '/set-logos/2017sm.webp', template: 'product-plate' }],
  ['2018sm', { path: '/set-logos/2018sm.webp', template: 'product-plate' }],
  ['2019sm', { path: '/set-logos/2019sm.webp', template: 'product-plate' }],
  ['2021swsh', { path: '/set-logos/2021swsh.webp', template: 'product-plate' }],
  ['2022swsh', { path: '/set-logos/2022swsh.webp', template: 'product-plate' }],
  ['2023sv', { path: '/set-logos/2023sv.webp', template: 'product-plate' }],
  ['2024sv', { path: '/set-logos/2024sv.webp', template: 'product-plate' }],
  ['2026me', { path: '/set-logos/2026me.webp', template: 'product-plate' }],
  ['ex5.5', { path: '/set-logos/ex5.5.webp', template: 'product-plate' }],
  ['bog', { path: '/set-logos/bog.webp', template: 'product-plate', replaces: [ptcgio('bp')] }],
])

/**
 * Any logo the bundle carries for this set — official or template — or `null`.
 * Call sites use it to decide whether a set has a logo at all (alongside the
 * API's `logoUrl`), and `SetLogo` uses it as the last resort after the image
 * tier fails. The path is root-relative; prefix it with `import.meta.env.BASE_URL`.
 */
export function bundledSetLogo(setId: string): string | null {
  return BUNDLED_SET_LOGOS.get(setId) ?? TEMPLATE_SET_LOGOS.get(setId)?.path ?? null
}

/**
 * The template logo to show INSTEAD of the image tier, or `null` to let the tier
 * go first. `logoUrl` is the API's `logoUrl` for the set (`undefined` when the
 * caller does not have it). See the header for the rule.
 */
export function templateSetLogo(setId: string, logoUrl: string | null | undefined): string | null {
  const entry = TEMPLATE_SET_LOGOS.get(setId)
  if (!entry || logoUrl === undefined) return null
  if (logoUrl === null || entry.replaces?.includes(logoUrl)) return entry.path
  return null
}

/** Every template entry, for tests and tooling. */
export function templateSetLogoEntries(): ReadonlyArray<readonly [string, TemplateSetLogo]> {
  return [...TEMPLATE_SET_LOGOS]
}
