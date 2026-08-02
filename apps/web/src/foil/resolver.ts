// foil/resolver.ts — v2 resolver:
//   (series, set, rarity, variant kind) → { patternId, scope, eraId, guess }
//
// v2 (2026-08-02): the base pattern guess now comes from the CITED usage table
// research/foil-pattern-usage.json (113 rows, 7 Ringer research lanes),
// bundled as the trimmed derived index `usage-index.json` (regenerate with
// tools/foil/build-usage-index.mjs). Matching is set-name-exact first, then
// era/series token fallback, then the era-default heuristics; the winning
// row's confidence + citations ride along in `guess` so the workbench can say
// WHY it picked a pattern. Mislabel corrections from the research are baked
// into the heuristics too: starlight is Base/Jungle/Fossil ONLY (Base Set 2 →
// Call of Legends holos are cosmos), and the SV-era default is the HORIZONTAL
// sheen, not the vertical one the old `sv-holo` slug rendered.
//
// The index is bundled with the (lazy-loaded) foil-lab chunk — resolution is
// synchronous, in-memory, and cached with the JS bundle.

import layouts from './era-layouts.json'
import usageIndex from './usage-index.json'
import { canonicalPatternId, patternById } from './patterns'

// Bumped whenever the resolver heuristics or era-layouts data change meaning.
// Recorded in every hand-mask sidecar's prior so the corpus states which rule
// version it was diffed against (mask-pipeline SKILL.md, "Sidecar v2").
// v2: usage-table-driven pattern guesses + vintage starlight/cosmos split.
// (Mask SCOPE semantics are unchanged from v1 — same rects, same zones.)
export const RESOLVER_VERSION = 2

export type FoilScope = 'window' | 'sheet' | 'full' | 'none'

/** Why the resolver guessed this pattern — surfaced in the workbench UI. */
export interface FoilGuess {
  /** 'set' = cited row names this exact set; 'series' = era-level row; 'heuristic' = era default. */
  match: 'set' | 'series' | 'heuristic'
  confidence: 'high' | 'medium' | 'low' | null
  /** Citation hostnames from the winning row (empty for heuristics). */
  sources: string[]
  era: string | null
  years: string | null
}

export interface FoilRecipeRef {
  patternId: string
  scope: FoilScope
  eraId: keyof typeof layouts.eras
  guess: FoilGuess
}

const ERA_BY_SERIES: Record<string, keyof typeof layouts.eras> = {}
for (const [eraId, era] of Object.entries(layouts.eras)) {
  for (const slug of era.seriesSlugs) ERA_BY_SERIES[slug] = eraId as keyof typeof layouts.eras
}

const FULL_FOIL_RARITIES = [
  'double rare', // ex
  'ultra rare',
  'illustration rare',
  'special illustration rare',
  'hyper rare',
  'secret rare',
  'rainbow rare',
  'shiny rare',
  'radiant rare',
  'amazing rare',
]

// ── Usage-table lookup ──────────────────────────────────────────────────────

interface UsageRow {
  p: string
  sets: string[]
  sk: string
  at: string[]
  conf: 'high' | 'medium' | 'low'
  era: string
  years: string
  src: string[]
}

const ROWS = usageIndex.rows as UsageRow[]

/** Same normalization tools/foil/build-usage-index.mjs applies to set names. */
const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

// setName(normalized) → rows claiming that set. Built once at module load.
const ROWS_BY_SET = new Map<string, UsageRow[]>()
for (const row of ROWS) {
  for (const s of row.sets) {
    const list = ROWS_BY_SET.get(s)
    if (list) list.push(row)
    else ROWS_BY_SET.set(s, [row])
  }
}

// Catalog series slug → tokens searched in each row's normalized series+era
// key (series-level fallback when no set-level row matches).
const SERIES_TOKENS: Record<string, string[]> = {
  base: ['wotc'],
  gym: ['gym', 'wotc'],
  neo: ['neo', 'wotc'],
  'e-card': ['e-card', 'wotc'],
  'legendary-collection': ['legendary collection', 'wotc'],
  ex: ['ex series'],
  pop: ['pop series'],
  'diamond-pearl': ['dp'],
  platinum: ['platinum'],
  'heartgold-soulsilver': ['hgss'],
  'call-of-legends': ['hgss', 'call of legends'],
  'black-white': ['bw'],
  xy: ['xy'],
  'sun-moon': ['sun & moon'],
  'sword-shield': ['sword & shield'],
  'scarlet-violet': ['scarlet & violet', 'sv/mega'],
  'mega-evolution': ['mega', 'sv/mega'],
  'mcdonald-s-collection': ['mcdonald'],
}

const CONF_RANK = { high: 2, medium: 1, low: 0 } as const

/**
 * The applies_to classes this variant could fall under, in preference order —
 * the research rows classify claims as standard-holo-rare / reverse-holo /
 * special-mechanic-card / promo / theme-deck-holo / energy / parallel-set /
 * box-topper / prototype.
 */
function applicableClasses(input: {
  kind: string
  rarity: string
  setName: string
  cardName: string
}): string[] {
  const promoSet = /promo|black star|mcdonald/.test(input.setName)
  if (input.kind.includes('reverse')) return ['reverse-holo', 'parallel-set']
  const classes: string[] = []
  if (/\benergy$/.test(input.cardName)) classes.push('energy')
  if (FULL_FOIL_RARITIES.some((r) => input.rarity.includes(r))) classes.push('special-mechanic-card')
  if (promoSet) classes.push('promo', 'standard-holo-rare', 'theme-deck-holo')
  else classes.push('standard-holo-rare', 'theme-deck-holo', 'promo')
  return classes
}

function lookupUsage(
  seriesSlug: string,
  setName: string | null,
  classes: string[],
  isReverse: boolean,
): { row: UsageRow; match: 'set' | 'series' } | null {
  type Hit = { row: UsageRow; match: 'set' | 'series'; classRank: number; penalty: number }
  const hits: Hit[] = []
  const classRank = (row: UsageRow): number => {
    let best = Infinity
    for (const at of row.at) {
      const i = classes.indexOf(at)
      if (i !== -1 && i < best) best = i
    }
    return best
  }
  // Research known-gap: lanes mapped several eras' reverses to 'mirror' where
  // the video's interlude shows the underlying FOIL is a sheen/rainbow-mirror
  // sheet with different ink masks — treat 'mirror' reverse rows as ink-design
  // evidence and let any non-mirror row of the same tier beat them.
  const penaltyOf = (row: UsageRow): number => (isReverse && row.p === 'mirror' ? 1 : 0)
  if (setName) {
    for (const row of ROWS_BY_SET.get(norm(setName)) ?? []) {
      const cr = classRank(row)
      if (cr !== Infinity) hits.push({ row, match: 'set', classRank: cr, penalty: penaltyOf(row) })
    }
  }
  if (hits.length === 0) {
    const tokens = SERIES_TOKENS[seriesSlug] ?? []
    if (tokens.length) {
      for (const row of ROWS) {
        if (!tokens.some((t) => row.sk.includes(t))) continue
        const cr = classRank(row)
        if (cr !== Infinity) hits.push({ row, match: 'series', classRank: cr, penalty: penaltyOf(row) })
      }
    }
  }
  if (hits.length === 0) return null
  hits.sort(
    (a, b) =>
      a.classRank - b.classRank ||
      a.penalty - b.penalty ||
      CONF_RANK[b.row.conf] - CONF_RANK[a.row.conf] ||
      b.row.src.length - a.row.src.length ||
      // narrower claims (fewer sets) beat era-wide ones on full ties
      a.row.sets.length - b.row.sets.length,
  )
  return { row: hits[0].row, match: hits[0].match }
}

// ── Era-default heuristics (fallback when no cited row matches) ─────────────

// Vintage correction (research/foil-patterns.md mislabels): starlight =
// Base Set / Jungle / Fossil ONLY; Base Set 2 → Call of Legends holos are cosmos.
const STARLIGHT_SET_IDS = new Set(['base1', 'base2', 'base3'])

// Default standard-holo pattern per catalog series (video-era defaults; the
// contested DP/HGSS cosmos-vs-vertical-sheen boundary follows the usage table
// when a row matches — this map only answers when none does).
const SERIES_DEFAULT_HOLO: Record<string, string> = {
  ex: 'cosmos',
  pop: 'cosmos',
  'diamond-pearl': 'cosmos',
  platinum: 'cosmos',
  'heartgold-soulsilver': 'vertical-sheen',
  'call-of-legends': 'vertical-sheen',
  'black-white': 'tinsel',
  xy: 'diagonal-sheen-right',
  'sun-moon': 'water-web',
  'sword-shield': 'striped-vertical-sheen',
  'scarlet-violet': 'horizontal-sheen',
  'mega-evolution': 'horizontal-sheen',
  'mcdonald-s-collection': 'confetti',
  'trainer-kits': 'cracked-ice',
}

function heuristicHolo(seriesSlug: string, setId: string | null, eraId: string): string {
  if (eraId === 'wotc') {
    return setId && STARLIGHT_SET_IDS.has(setId) ? 'starlight' : 'cosmos'
  }
  return SERIES_DEFAULT_HOLO[seriesSlug] ?? 'horizontal-sheen'
}

// ── The resolver ────────────────────────────────────────────────────────────

const NO_GUESS: FoilGuess = { match: 'heuristic', confidence: null, sources: [], era: null, years: null }

export function resolveFoil(input: {
  seriesSlug: string
  rarity: string | null
  variantKind: string | null
  /** Catalog set id (e.g. base1) — enables the vintage starlight/cosmos split. */
  setId?: string | null
  /** Catalog set display name — enables set-level usage-table matches. */
  setName?: string | null
  /** Card display name — energy-card detection for the usage table. */
  cardName?: string | null
}): FoilRecipeRef {
  const eraId = ERA_BY_SERIES[input.seriesSlug] ?? 'modern-sv'
  const kind = (input.variantKind ?? '').toLowerCase()
  const rarity = (input.rarity ?? '').toLowerCase()
  const setName = input.setName ?? null

  // Scope comes from the variant class alone (same rules as v1).
  const isReverse = kind.includes('reverse')
  const isFullFoil = FULL_FOIL_RARITIES.some((r) => rarity.includes(r))
  const isHolo = kind.includes('holo')
  const scope: FoilScope = isReverse ? 'sheet' : isFullFoil ? 'full' : isHolo ? 'window' : 'none'

  // Plain printing: no foil, no guess to make.
  if (scope === 'none') {
    return { patternId: 'none', scope, eraId, guess: NO_GUESS }
  }

  // 1) Cited usage table — highest-confidence matching row wins.
  const classes = applicableClasses({
    kind,
    rarity,
    setName: norm(setName ?? ''),
    cardName: norm(input.cardName ?? ''),
  })
  const hit = lookupUsage(input.seriesSlug, setName, classes, isReverse)
  if (hit && patternById(hit.row.p).id !== 'none') {
    return {
      patternId: canonicalPatternId(hit.row.p),
      scope,
      eraId,
      guess: {
        match: hit.match,
        confidence: hit.row.conf,
        sources: hit.row.src,
        era: hit.row.era,
        years: hit.row.years,
      },
    }
  }

  // 2) Era-default heuristics.
  const patternId = isReverse ? 'reverse-sheet' : heuristicHolo(input.seriesSlug, input.setId ?? null, eraId)
  return { patternId, scope, eraId, guess: NO_GUESS }
}

// Convert a resolved scope + era into shader mask uniforms. Layout rects are
// measured top-left-origin (image space); the shader works in UV (y up).
export function maskForScope(
  scope: FoilScope,
  eraId: keyof typeof layouts.eras,
): { rect: [number, number, number, number]; radius: number; invert: boolean } {
  const era = layouts.eras[eraId]
  const aw = era.artWindow
  const rectYUp: [number, number, number, number] = [aw.x, 1 - aw.y - aw.h, aw.w, aw.h]
  switch (scope) {
    case 'window':
      return { rect: rectYUp, radius: era.artWindowRadius, invert: false }
    case 'sheet':
      return { rect: rectYUp, radius: era.artWindowRadius, invert: true }
    case 'full':
    case 'none':
      return { rect: [0, 0, 1, 1], radius: layouts.cornerRadius, invert: false }
  }
}

export const ERAS = layouts.eras
