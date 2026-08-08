// foil/resolver.ts — v3 resolver:
//   (series, set, card, rarity, variant kind) → { patternId, scope, eraId, guess }
//
// v3 (2026-08-02): per-card/per-set ASSIGNMENTS from the cited research file
// research/foil-card-assignments.json (Ringer swarm `foil-card-assignments`,
// bundled as the trimmed `assignments-index.json`, regenerate with
// tools/foil/build-assignments-index.mjs) now outrank the v2 era usage table.
// Highest-specificity wins: explicit cardIds row > catalog-declared variant
// foil facet (e.g. `holo-foil-cosmos` → cosmos) > set+kind/rarity row > set
// row > v2 usage table (set-name match, then era/series token) > era-default
// heuristics. The winning row's confidence + citations ride along in `guess`
// so the workbench can say WHY it picked a pattern.
//
// v2 semantics kept underneath: starlight is Base/Jungle/Fossil ONLY (Base
// Set 2 → Call of Legends holos are cosmos), SV default is the HORIZONTAL
// sheen, 'mirror' reverse rows are penalized as ink-design evidence.
//
// The indexes are bundled with the (lazy-loaded) foil-lab chunk — resolution
// is synchronous, in-memory, and cached with the JS bundle.

import layouts from './era-layouts.json'
import usageIndex from './usage-index.json'
import assignIndex from './assignments-index.json'
import { canonicalPatternId, patternById } from './patterns'

// Bumped whenever the resolver heuristics or era-layouts data change meaning.
// Recorded in every hand-mask sidecar's prior so the corpus states which rule
// version it was diffed against (mask-pipeline SKILL.md, "Sidecar v2").
// v5 (2026-08-02 R2b): assignment rows may carry a per-row `sc` scope
//     override ('window' | 'full' | 'sheet') applied when the row wins —
//     treatments whose physical extent kind/rarity cannot express: baby
//     shinies are window-scope despite full-foil rarities, VSTAR pearls are
//     full-face despite plain holo kinds, det1 holos are window-scope
//     despite 'ultra rare'. The cls-'normal' tier honors it too (falls back
//     to 'full' as in v4). Also: the four §40–43 vocabulary slugs
//     (gold-secret / vstar-pearl / shiny-vault / detective-pikachu) are now
//     wired via facet rows (gold, gold-jumbo) + set/card rows.
// v4 (2026-08-02 R2): card-level assignment rows with cls 'normal' are
//     consulted BEFORE the scope-none early return — subset cards the
//     catalog declares as plain prints but which physically carry a foil
//     treatment (Radiant Collection commons: dot overprint, no aluminum)
//     now resolve their subset's pattern with scope 'full' instead of
//     rendering flat. Data-gated: only rows that name the exact cardId.
// v3: assignment-table tier (card/facet/set rows) above the v2 usage table;
//     variants whose kind declares a foil facet on a NORMAL print (e.g.
//     normal-foil-galaxy) are now scope 'window' instead of 'none';
//     era-layouts: 'e-card'/'legendary-collection' correctly map to the wotc
//     frame (they previously fell through to modern-sv rects + heuristics).
// v2: usage-table-driven pattern guesses + vintage starlight/cosmos split.
export const RESOLVER_VERSION = 5

export type FoilScope = 'window' | 'sheet' | 'full' | 'none'

/** Why the resolver guessed this pattern — surfaced in the workbench UI. */
export interface FoilGuess {
  /**
   * 'card' = cited row names this exact card; 'facet' = the catalog variant
   * kind itself declares the foil (cited mapping); 'set' = cited row names
   * this exact set; 'series' = era-level row; 'heuristic' = era default.
   */
  match: 'card' | 'facet' | 'set' | 'series' | 'heuristic'
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

// ── Assignment-table lookup (v3 — research/foil-card-assignments.json) ──────

type AssignCls = 'holo' | 'reverse' | 'full-foil' | 'normal+facet'

interface AssignRow {
  p: string
  setIds: string[]
  cls: string
  rar: string[] | null
  kinds: string[] | null
  cards: string[] | null
  /** v5: per-row scope override — null keeps the computed scope. */
  sc: FoilScope | null
  conf: 'high' | 'medium' | 'low'
  src: string[]
}

const ASSIGN_ROWS = assignIndex.rows as AssignRow[]
const ASSIGN_FACETS = assignIndex.facets as Record<
  string,
  { p: string; conf: 'high' | 'medium' | 'low'; src: string[] }
>

const ASSIGN_BY_SET = new Map<string, AssignRow[]>()
for (const row of ASSIGN_ROWS) {
  for (const s of row.setIds) {
    const list = ASSIGN_BY_SET.get(s)
    if (list) list.push(row)
    else ASSIGN_BY_SET.set(s, [row])
  }
}

/**
 * The explicit foil facet a catalog variant kind declares, if any —
 * `holo-foil-cosmos` → 'cosmos', `normal-foil-galaxy-stamp-1st-edition` →
 * 'galaxy', plain `holo`/`reverse` → null. Same rule the assignment research
 * clustering used.
 */
function kindFacet(kind: string): string | null {
  return kind.match(/foil-([a-z0-9-]+?)(?:-stamp-.*)?$/)?.[1] ?? null
}

/** The assignment class of a variant — mirrors the scope rules. */
function assignCls(input: { isReverse: boolean; isFullFoil: boolean; isHolo: boolean; facet: string | null }): AssignCls | null {
  if (input.isReverse) return 'reverse'
  if (input.isFullFoil) return 'full-foil'
  if (input.isHolo) return 'holo'
  if (input.facet) return 'normal+facet'
  return null
}

function lookupAssignment(input: {
  setId: string | null
  cardId: string | null
  kind: string
  rarity: string
  cls: AssignCls
  facet: string | null
}): {
  row: { p: string; conf: 'high' | 'medium' | 'low'; src: string[] }
  match: 'card' | 'facet' | 'set'
  sc: FoilScope | null
} | null {
  type Hit = {
    p: string
    conf: 'high' | 'medium' | 'low'
    src: string[]
    match: 'card' | 'facet' | 'set'
    sc: FoilScope | null
    score: number
    penalty: number
    breadth: number
  }
  const hits: Hit[] = []
  // Same research known-gap as the v2 tier: 'mirror' claims about REVERSES are
  // often ink-design (not foil-sheet) evidence — any non-mirror row of the
  // same specificity beats them.
  const penaltyOf = (p: string): number => (input.cls === 'reverse' && p === 'mirror' ? 1 : 0)
  if (input.setId) {
    for (const row of ASSIGN_BY_SET.get(input.setId) ?? []) {
      if (row.cls !== input.cls) continue
      if (row.rar && !row.rar.some((r) => input.rarity.includes(r))) continue
      if (row.kinds && !row.kinds.includes(input.kind)) continue
      if (row.cards && !(input.cardId && row.cards.includes(input.cardId))) continue
      // Specificity: explicit card list (9) > explicit kind list (7) > facet (6) > rarity filter (3) > bare set (1).
      const score = (row.cards ? 8 : 0) + (row.kinds ? 6 : 0) + (row.rar ? 2 : 0) + 1
      hits.push({
        p: row.p,
        conf: row.conf,
        src: row.src,
        match: row.cards ? 'card' : 'set',
        sc: row.sc ?? null,
        score,
        penalty: penaltyOf(row.p),
        breadth: row.setIds.length,
      })
    }
  }
  // Catalog-declared facet mapping: beats set/rarity rows, loses to explicit
  // card rows and explicit kind selectors (score 6, between rar's 3 and kinds' 7).
  if (input.facet) {
    const f = ASSIGN_FACETS[input.facet]
    if (f)
      hits.push({ p: f.p, conf: f.conf, src: f.src, match: 'facet', sc: null, score: 6, penalty: penaltyOf(f.p), breadth: 1 })
  }
  if (hits.length === 0) return null
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      a.penalty - b.penalty ||
      CONF_RANK[b.conf] - CONF_RANK[a.conf] ||
      b.src.length - a.src.length ||
      // narrower claims (fewer sets) beat era-wide ones on full ties
      a.breadth - b.breadth,
  )
  const best = hits[0]
  return { row: { p: best.p, conf: best.conf, src: best.src }, match: best.match, sc: best.sc }
}

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
  /** Catalog set id (e.g. base1) — enables assignment rows + the vintage starlight/cosmos split. */
  setId?: string | null
  /** Catalog set display name — enables set-level usage-table matches. */
  setName?: string | null
  /** Card display name — energy-card detection for the usage table. */
  cardName?: string | null
  /** Catalog card id (e.g. base4-2) — enables card-level assignment rows. */
  cardId?: string | null
}): FoilRecipeRef {
  const eraId = ERA_BY_SERIES[input.seriesSlug] ?? 'modern-sv'
  const kind = (input.variantKind ?? '').toLowerCase()
  const rarity = (input.rarity ?? '').toLowerCase()
  const setName = input.setName ?? null

  // Scope comes from the variant class alone (v3: a foil facet on an
  // otherwise-normal print — e.g. normal-foil-galaxy theme-deck prints —
  // is a real art-window foil, not 'none' as in v1/v2).
  const facet = kindFacet(kind)
  const isReverse = kind.includes('reverse')
  const isFullFoil = FULL_FOIL_RARITIES.some((r) => rarity.includes(r))
  const isHolo = kind.includes('holo')
  const scope: FoilScope = isReverse ? 'sheet' : isFullFoil ? 'full' : isHolo || facet ? 'window' : 'none'

  // Plain printing: no foil — UNLESS a card-level 'normal'-class assignment
  // row overrides the catalog's declaration (v4: subset cards like Radiant
  // Collection commons carry a physical overprint the catalog can't express;
  // the builder guarantees these rows name explicit cardIds).
  if (scope === 'none') {
    if (input.setId && input.cardId) {
      for (const row of ASSIGN_BY_SET.get(input.setId) ?? []) {
        if (row.cls !== 'normal') continue
        if (!row.cards || !row.cards.includes(input.cardId)) continue
        if (patternById(row.p).id === 'none') continue
        return {
          patternId: canonicalPatternId(row.p),
          scope: row.sc ?? 'full',
          eraId,
          guess: { match: 'card', confidence: row.conf, sources: row.src, era: null, years: null },
        }
      }
    }
    return { patternId: 'none', scope, eraId, guess: NO_GUESS }
  }

  // 1) Assignment table (v3) — per-card, per-facet, and per-set cited rows.
  const cls = assignCls({ isReverse, isFullFoil, isHolo, facet })
  if (cls) {
    const hit = lookupAssignment({
      setId: input.setId ?? null,
      cardId: input.cardId ?? null,
      kind,
      rarity,
      cls,
      facet,
    })
    if (hit && patternById(hit.row.p).id !== 'none') {
      return {
        patternId: canonicalPatternId(hit.row.p),
        // v5: a winning row may override the computed scope (baby shinies
        // window despite full-foil rarity, VSTAR full despite holo kind).
        scope: hit.sc ?? scope,
        eraId,
        guess: { match: hit.match, confidence: hit.row.conf, sources: hit.row.src, era: null, years: null },
      }
    }
  }

  // 2) Cited usage table (v2) — highest-confidence matching row wins.
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

  // 3) Era-default heuristics.
  const patternId = isReverse ? 'reverse-sheet' : heuristicHolo(input.seriesSlug, input.setId ?? null, eraId)
  return { patternId, scope, eraId, guess: NO_GUESS }
}

/**
 * Every pattern a CITED row claims for this variant — winners AND runners-up
 * (R7 2026-08-08, Chey 9vt98k / v6hz1k / 1rdrlt / h4uap7: "Why are there no
 * catalog cards for this one?").
 *
 * `resolveFoil` is a single-winner contest, but the corpus is not: several
 * cited rows describe DIFFERENT PHYSICAL LAYERS of the same card and are true
 * simultaneously. The Sun & Moon reverses are the exemplar — the usage table
 * carries both `energy-symbols` (Collexy, high confidence: the embossed
 * type-symbol layer you SEE) and `diagonal-sheen-left` (the video, medium: the
 * underlying foil sheet's rotation), and the research row says so in its own
 * `conflicts` field. Confidence decides the winner, so diagonal-sheen-left
 * resolves for zero cards even though ~2,000 catalog printings physically
 * carry it.
 *
 * This returns the whole claimed set so the canon lab's card preview can offer
 * a SECONDARY pool ("cards the research names for this pattern, on a card
 * another layer wins") instead of an empty picker. It is diagnostic/preview
 * only — nothing in the render path consults it.
 */
export function citedFoilPatterns(input: {
  seriesSlug: string
  rarity: string | null
  variantKind: string | null
  setId?: string | null
  setName?: string | null
  cardName?: string | null
  cardId?: string | null
}): string[] {
  const kind = (input.variantKind ?? '').toLowerCase()
  const rarity = (input.rarity ?? '').toLowerCase()
  const facet = kindFacet(kind)
  const isReverse = kind.includes('reverse')
  const isFullFoil = FULL_FOIL_RARITIES.some((r) => rarity.includes(r))
  const isHolo = kind.includes('holo')
  const scope: FoilScope = isReverse ? 'sheet' : isFullFoil ? 'full' : isHolo || facet ? 'window' : 'none'
  const out = new Set<string>()
  const add = (p: string): void => {
    if (patternById(p).id !== 'none') out.add(canonicalPatternId(p))
  }
  if (scope === 'none') {
    // Only the card-level 'normal' tier can reach a plain print.
    if (input.setId && input.cardId) {
      for (const row of ASSIGN_BY_SET.get(input.setId) ?? []) {
        if (row.cls === 'normal' && row.cards?.includes(input.cardId)) add(row.p)
      }
    }
    return [...out]
  }
  const cls = assignCls({ isReverse, isFullFoil, isHolo, facet })
  if (cls && input.setId) {
    for (const row of ASSIGN_BY_SET.get(input.setId) ?? []) {
      if (row.cls !== cls) continue
      if (row.rar && !row.rar.some((r) => rarity.includes(r))) continue
      if (row.kinds && !row.kinds.includes(kind)) continue
      if (row.cards && !(input.cardId && row.cards.includes(input.cardId))) continue
      add(row.p)
    }
  }
  if (facet && ASSIGN_FACETS[facet]) add(ASSIGN_FACETS[facet]!.p)
  const classes = applicableClasses({
    kind,
    rarity,
    setName: norm(input.setName ?? ''),
    cardName: norm(input.cardName ?? ''),
  })
  const seen = new Set<UsageRow>()
  for (const row of ROWS_BY_SET.get(norm(input.setName ?? '')) ?? []) seen.add(row)
  if (seen.size === 0) {
    // Same fallback order the resolver uses: series tokens only when no
    // set-level row matched, so we never inflate the pool with era-wide rows
    // for a set that has its own citation.
    for (const t of SERIES_TOKENS[input.seriesSlug] ?? []) {
      for (const row of ROWS) if (row.sk.includes(t)) seen.add(row)
    }
  }
  for (const row of seen) {
    if (row.at.some((at) => classes.includes(at))) add(row.p)
  }
  return [...out]
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
