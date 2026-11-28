// Deck-box art: what a deck LOOKS like, derived from what is IN it.
//
// This module is the whole rulebook and nothing else — pure functions of a
// deck's card rows, a few catalog facts and (optionally) one colour sampled
// from card art. No fetching, no DOM, no randomness that isn't seeded from the
// deck. The same inputs always give the same `DeckArtSpec`, so a deck's box
// never changes colour between visits unless its cards did.
//
// It is deliberately shaped so it could move server-side unchanged: GET /decks
// already loads every deck's rows and Pokémon types to validate them, and an
// `art` field computed there would remove the client's per-deck fetch (see
// research/DECK-BOX-ART.md, "Where this should end up").
//
// The rules, in one paragraph: the FEATURED POKÉMON are the deck's main
// attackers — the evolution lines it invests the most copies in, weighted by
// stage, rule box, best printed damage and whether that attack is paid for by
// the energy the deck actually plays (which is what separates Charizard ex
// from the Pidgeot ex that searches for it). The ENERGY TYPES come from the
// energy cards and from the attack costs of those Pokémon. The deck's STYLE
// (power, engine, control, swarm, balanced) is read off the same facts. The
// box's generated PANEL ART is chosen by the leading energy type, the STUDIO
// by the style, each variant by the deck's hash; both are recoloured by
// gradient maps built from the palette — the box in its energy type's colour
// with the second type or the main attacker's art as the highlight, the
// studio lit in the art's own colour.

import { hexToOklch, hueDelta, oklchToHex, type Oklch } from './color'

/** Bump when a rule changes: every cached spec carries it and is re-derived on mismatch. */
export const DERIVE_VERSION = 2

export const ENERGY_TYPES = [
  'Grass',
  'Fire',
  'Water',
  'Lightning',
  'Psychic',
  'Fighting',
  'Darkness',
  'Metal',
  'Fairy',
  'Dragon',
  'Colorless',
] as const
export type EnergyType = (typeof ENERGY_TYPES)[number]

/** The subset of a deck-detail card row (`DeckCard` in lib/api.ts) the art reads. */
export interface ArtCardRow {
  cardId: string
  name: string
  section: 'pokemon' | 'trainer' | 'energy'
  stage: string | null
  quantity: number
  images: { low: string; high: string }
}

/** The subset of GET /cards/:id the art reads. `cost` arrives as "Fire,Fire" today; an array is accepted too. */
export interface ArtCardFacts {
  types: string[]
  evolvesFrom: string | null
  attacks: { cost: string | readonly string[] | null; damage: string | null }[]
  abilities?: readonly unknown[]
}

export interface FeaturedCard {
  cardId: string
  name: string
  low: string
  high: string
}

/**
 * How the deck plays, read off its list — it picks the studio the box is shot
 * in and the title treatment its name is printed in:
 *
 *   power     the main attacker is a rule-box Pokémon hitting for 200+
 *   engine    an evolution engine: the main attacker is a Stage 2
 *   control   barely any energy (≤ 4 energy cards): stall, mill, lock
 *   swarm     single-prize: nothing featured has a rule box
 *   balanced  everything else
 */
export type DeckStyle = 'power' | 'engine' | 'control' | 'swarm' | 'balanced'
export const DECK_STYLES: readonly DeckStyle[] = ['power', 'engine', 'control', 'swarm', 'balanced']

export interface DeckArtPalette {
  /** studio wall, top → just above the sweep */
  wall: string
  wallLow: string
  /** studio floor, front edge → back */
  floor: string
  floorLow: string
  /** the key light pooled behind the box */
  key: string
  /** box faces */
  box: string
  boxDeep: string
  boxLight: string
  /** the label band the energy icons sit on */
  band: string
  /** title and highlight colours */
  accent: string
  accent2: string
  /**
   * Gradient maps for the generated (grayscale) artwork, darkest stop first:
   * the box panel's luminance runs shadow → box colour → highlight, the
   * backdrop's runs near-black → tinted wall → the key light's colour.
   */
  boxMap: string[]
  backdropMap: string[]
}

export interface DeckArtSpec {
  v: number
  /** 0–2 cards, strongest first. Empty for a deck with no Pokémon. */
  featured: FeaturedCard[]
  /** 0–3 energy types, strongest first. */
  types: EnergyType[]
  palette: DeckArtPalette
  style: DeckStyle
  /** ids into the generated art library (art/MANIFEST.json); null = paint the plain box/studio */
  art: { box: string | null; backdrop: string | null }
  /** true when the spec was derived from the deck summary alone (no cards known yet). */
  provisional: boolean
}

// ── Seeded hashing ───────────────────────────────────────────────────────────

/** FNV-1a, 32-bit. Stable across engines (only integer maths). */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32: a tiny seeded PRNG, deterministic for a given seed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── Energy types ─────────────────────────────────────────────────────────────

const TYPE_WORD = /\b(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy|Dragon)\b/i

/** Canonical type for a free-text type name ("fire", "Dark", "Steel" …), or null. */
export function normalizeType(raw: string | null | undefined): EnergyType | null {
  if (!raw) return null
  const t = raw.trim().toLowerCase()
  if (t === 'steel') return 'Metal'
  if (t === 'dark') return 'Darkness'
  if (t === 'electric') return 'Lightning'
  if (t === 'normal') return 'Colorless'
  const hit = ENERGY_TYPES.find((e) => e.toLowerCase() === t)
  return hit ?? null
}

/**
 * The type an energy card PROVIDES, read off its name: "Fire Energy",
 * "Basic Fire Energy", "Hiding Darkness Energy" all say so in words. Special
 * energy that names no type (Jet, Double Turbo, Luminous, Reversal …) is
 * deliberately null: it says nothing about the deck's colours.
 */
export function energyTypeFromName(name: string): EnergyType | null {
  const m = TYPE_WORD.exec(name)
  return m ? normalizeType(m[1]) : null
}

/** Attack cost symbols, whatever shape the API sent them in. */
export function costSymbols(cost: string | readonly string[] | null | undefined): EnergyType[] {
  if (!cost) return []
  const parts = typeof cost === 'string' ? cost.split(',') : cost
  const out: EnergyType[] = []
  for (const p of parts) {
    const t = normalizeType(p)
    if (t) out.push(t)
  }
  return out
}

/** Printed damage → a comparable number. "180+" and "70×" scale up; "" is 0. */
export function damageValue(damage: string | null | undefined): number {
  if (!damage) return 0
  const m = /(\d+)/.exec(damage)
  if (!m) return 0
  const n = Number(m[1])
  if (/[×x*]/.test(damage)) return n * 2.5
  if (/\+/.test(damage)) return n * 1.25
  return n
}

// ── Featured Pokémon ─────────────────────────────────────────────────────────

const RULE_BOX_SUFFIX = /\s(ex|EX|GX|V|VMAX|VSTAR|V-UNION|BREAK|LV\.X|Prime|LEGEND|◇|☆)$/
const STAGE_WEIGHT: Record<string, number> = {
  basic: 1,
  stage1: 1.3,
  stage2: 1.6,
  vmax: 1.5,
  vstar: 1.5,
  'v-union': 1.4,
  break: 1.2,
  mega: 1.5,
  restored: 1.1,
}

export function stageWeight(stage: string | null | undefined): number {
  if (!stage) return 1
  return STAGE_WEIGHT[stage.replace(/\s+/g, '').toLowerCase()] ?? 1
}

export function ruleBoxWeight(name: string): number {
  if (RULE_BOX_SUFFIX.test(name) || /^Mega\s/.test(name)) return 1.4
  if (/^Radiant\s/.test(name)) return 1.15
  return 1
}

const nameKey = (name: string) => name.trim().toLowerCase()

/** How often a strategy guide names this card — a guide spends its words on the attackers. */
export function mentionCount(name: string, strategyMd: string | null | undefined): number {
  if (!strategyMd) return 0
  const esc = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${esc}(?=$|[^\\p{L}\\p{N}])`, 'giu')
  let n = 0
  while (re.exec(strategyMd)) n++
  return n
}

export interface Candidate {
  /** representative printing: the row with the most copies */
  cardId: string
  name: string
  stage: string | null
  images: { low: string; high: string }
  copies: number
  mentions: number
  /** cheap score from the deck rows alone — decides which candidates get catalog facts */
  preScore: number
}

/**
 * Every distinct Pokémon in the deck, ranked by what the deck rows alone say.
 * Printings are folded by NAME (two prints of Charizard ex are one line), the
 * representative print being the one the deck runs most of.
 */
export function rankCandidates(rows: readonly ArtCardRow[], strategyMd?: string | null): Candidate[] {
  const byName = new Map<string, { best: ArtCardRow; copies: number }>()
  for (const r of rows) {
    if (r.section !== 'pokemon' || r.quantity <= 0) continue
    const k = nameKey(r.name)
    const prev = byName.get(k)
    if (!prev) byName.set(k, { best: r, copies: r.quantity })
    else {
      prev.copies += r.quantity
      if (r.quantity > prev.best.quantity) prev.best = r
    }
  }
  const out: Candidate[] = []
  for (const { best, copies } of byName.values()) {
    const mentions = mentionCount(best.name, strategyMd)
    const preScore =
      copies * stageWeight(best.stage) * ruleBoxWeight(best.name) * (1 + 0.12 * Math.min(mentions, 5))
    out.push({
      cardId: best.cardId,
      name: best.name,
      stage: best.stage,
      images: best.images,
      copies,
      mentions,
      preScore,
    })
  }
  // Ties break on name so the order — and therefore the art — is stable.
  out.sort((a, b) => b.preScore - a.preScore || a.name.localeCompare(b.name))
  return out
}

/** How many of the top pre-ranked candidates are worth a catalog lookup. */
export const FACTS_FOR_TOP = 4

/** The deck's basic-energy weights by type (energy cards only). */
export function energyCardWeights(rows: readonly ArtCardRow[]): Map<EnergyType, number> {
  const w = new Map<EnergyType, number>()
  for (const r of rows) {
    if (r.section !== 'energy') continue
    const t = energyTypeFromName(r.name)
    if (t) w.set(t, (w.get(t) ?? 0) + r.quantity)
  }
  return w
}

export interface ScoredCandidate extends Candidate {
  score: number
  /** a pre-evolution of a stronger line in the deck — never featured over it */
  preEvolution: boolean
}

/**
 * Final attacker score. Candidates without facts keep neutral attack and
 * alignment factors, so a lookup that failed degrades to the pre-score order
 * rather than to nonsense.
 */
export function scoreCandidates(
  candidates: readonly Candidate[],
  facts: ReadonlyMap<string, ArtCardFacts>,
  deckEnergy: ReadonlyMap<EnergyType, number>,
): ScoredCandidate[] {
  const byName = new Map(candidates.map((c) => [nameKey(c.name), c]))
  // Evolution lines: fold a pre-evolution's copies into what it evolves into
  // (half weight — they are the same investment, counted once), and mark it so
  // a Charmander is never the deck's face while a Charizard ex is in it.
  const lineCopies = new Map(candidates.map((c) => [nameKey(c.name), c.copies]))
  const pre = new Set<string>()
  for (const c of candidates) {
    const f = facts.get(c.cardId)
    let from = f?.evolvesFrom ? nameKey(f.evolvesFrom) : null
    // Walk up the line as far as the facts we have go (Charizard ← Charmeleon ← Charmander).
    let depth = 0
    while (from && byName.has(from) && depth < 3) {
      pre.add(from)
      const prev = byName.get(from)!
      lineCopies.set(nameKey(c.name), (lineCopies.get(nameKey(c.name)) ?? 0) + prev.copies * 0.5)
      const pf = facts.get(prev.cardId)
      from = pf?.evolvesFrom ? nameKey(pf.evolvesFrom) : null
      depth++
    }
  }
  return candidates.map((c) => {
    const f = facts.get(c.cardId)
    let attack = 0.8
    let align = 1
    let support = 1
    if (f) {
      let best = 0
      let bestCost: EnergyType[] = []
      for (const a of f.attacks) {
        const d = damageValue(a.damage)
        if (d > best || (d === best && bestCost.length === 0)) {
          best = d
          bestCost = costSymbols(a.cost)
        }
      }
      // Compressed on purpose: damage separates attackers from support, but a
      // 3-3 VSTAR line whose attack copies others' (Regidrago's Apex Dragon
      // prints no damage at all) must still outrank a one-copy 200-damage tech.
      attack = 0.6 + Math.min(best, 280) / 350
      const paid = bestCost.filter((t) => t !== 'Colorless')
      const share = paid.length ? paid.filter((t) => deckEnergy.has(t)).length / paid.length : 0.5
      align = 0.8 + 0.4 * share
      // An Ability-led Pokémon with no real attack is engine, not attacker.
      if ((f.abilities?.length ?? 0) > 0 && best < 90) support = 0.55
    }
    const copies = lineCopies.get(nameKey(c.name)) ?? c.copies
    const score =
      Math.log2(1 + copies) *
      stageWeight(c.stage) *
      ruleBoxWeight(c.name) *
      attack *
      align *
      support *
      (1 + 0.12 * Math.min(c.mentions, 5))
    return { ...c, score, preEvolution: pre.has(nameKey(c.name)) }
  })
}

/** A second card is featured only if it is a real co-star, not a tech. */
export const SECOND_CARD_RATIO = 0.5

export function pickFeatured(scored: readonly ScoredCandidate[]): ScoredCandidate[] {
  const pool = scored
    .filter((c) => !c.preEvolution)
    .slice()
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  if (pool.length === 0) return []
  const [first, second] = pool
  return second && second.score >= first.score * SECOND_CARD_RATIO ? [first, second] : [first]
}

/**
 * The deck's energy types, strongest first. Energy cards count once per copy.
 * The FEATURED attackers' attack costs count twice per symbol (the main
 * attacker in full, a co-star at 60%), and the main attacker's best attack
 * counts again — it is the attack the deck is built to pay for, which is what
 * lets Raging Bolt's Lightning/Fighting lead a list that runs more Grass for
 * Ogerpon. Other Pokémon's costs are ignored: a one-copy tech's Water cost
 * does not make a Water deck. A GLC deck's declared type always leads. A deck
 * that pays for everything with Colorless shows Colorless — or, if its main
 * attacker has no costs at all, that Pokémon's own type.
 */
export function deriveTypes(
  deckEnergy: ReadonlyMap<EnergyType, number>,
  featured: readonly ScoredCandidate[],
  facts: ReadonlyMap<string, ArtCardFacts>,
  glcType?: string | null,
): EnergyType[] {
  const w = new Map<EnergyType, number>()
  const add = (t: EnergyType, n: number) => w.set(t, (w.get(t) ?? 0) + n)
  for (const [t, n] of deckEnergy) add(t, n)
  let sawColorless = false
  featured.slice(0, 2).forEach((c, i) => {
    const f = facts.get(c.cardId)
    if (!f) return
    // With no typed energy at all, the co-star's costs are a guess the deck
    // never pays; only the main attacker speaks for it.
    const role = i === 0 ? 1 : deckEnergy.size ? 0.6 : 0
    if (role === 0) return
    let best: EnergyType[] = []
    let bestDamage = -1
    for (const a of f.attacks) {
      const cost = costSymbols(a.cost)
      const d = damageValue(a.damage)
      if (d > bestDamage) {
        bestDamage = d
        best = cost
      }
      for (const t of cost) {
        if (t === 'Colorless') sawColorless = true
        else add(t, 2 * role)
      }
    }
    if (i === 0) for (const t of best) if (t !== 'Colorless') add(t, 2)
  })
  const glc = normalizeType(glcType)
  let ranked = [...w.entries()]
    .sort((a, b) => b[1] - a[1] || ENERGY_TYPES.indexOf(a[0]) - ENERGY_TYPES.indexOf(b[0]))
    .map(([t]) => t)
  if (ranked.length) {
    const top = w.get(ranked[0])!
    ranked = ranked.filter((t) => w.get(t)! >= top * 0.18)
  }
  if (glc) ranked = [glc, ...ranked.filter((t) => t !== glc)]
  if (ranked.length === 0 && featured.length) {
    const own = normalizeType(facts.get(featured[0].cardId)?.types[0])
    ranked = sawColorless || !own ? ['Colorless'] : [own]
  }
  return ranked.slice(0, 3)
}

// ── Palette ──────────────────────────────────────────────────────────────────

/**
 * Each type's colour, as the box paints it. These follow the energy tokens
 * (--color-energy-* in theme.css, matched to the symbols printed on the
 * cards), so the box and the energy tokens on its band agree. They are
 * written out rather than read from CSS because the palette maths needs
 * numbers. Fighting is pulled a little towards earth, so a Fighting box is not
 * mistaken for a Fire one at a glance. Darkness is a shade deeper, to read as
 * a dark box rather than a teal one. Metal is a shade deeper too, so it counts
 * as a mid-tone and can carry a light accent: gold on steel, not mud on
 * silver. If the tokens are retuned, update these with them.
 */
export const TYPE_COLORS: Record<EnergyType, string> = {
  Grass: '#4fa83b',
  Fire: '#e0472c',
  Water: '#2b9de0',
  Lightning: '#f5c41f',
  Psychic: '#a052b8',
  Fighting: '#b8642f',
  Darkness: '#1d5a6d',
  Metal: '#959794',
  Fairy: '#dc4c8c',
  Dragon: '#b09a2c',
  Colorless: '#ebe9e3',
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Snap a sampled colour to a coarse grid (15° hue, 0.02 chroma, 0.04
 * lightness). Two browsers can decode and downscale the same image to
 * slightly different pixels; the snap is what makes "same deck, same colours"
 * hold across devices, not just across visits.
 */
export function quantizeSwatch(c: Oklch): Oklch {
  const snap = (x: number, step: number) => Number((Math.round(x / step) * step).toFixed(4))
  return { l: snap(c.l, 0.04), c: snap(c.c, 0.02), h: snap(c.h, 15) % 360 }
}


export function derivePalette(types: readonly EnergyType[], art: Oklch | null): DeckArtPalette {
  const t1 = hexToOklch(TYPE_COLORS[types[0] ?? 'Colorless'])
  const t2 = types[1] ? hexToOklch(TYPE_COLORS[types[1]]) : null
  const artUsable = art && art.c >= 0.05 ? art : null
  const hex = oklchToHex

  // BOX — the leading energy type, as a lit printed surface.
  let box: Oklch = { l: clamp(t1.l, 0.46, 0.74), c: clamp(t1.c, 0.02, 0.17), h: t1.h }
  // A neutral grey's hue is rounding noise; give it a deliberate cool steel cast
  // instead of whatever tint the noise points at.
  if (t1.c < 0.02) box = { ...box, c: 0.015, h: 250 }
  // Colorless has no hue of its own, so it borrows a whisper of the art's —
  // a Lugia box and a Snorlax box should not be the same grey. (Metal keeps
  // its steel: that is a colour, and the art goes on the highlights instead.)
  if (types[0] === 'Colorless' && artUsable) box = { ...box, c: 0.03, h: artUsable.h }
  // Only the genuinely pale boxes (Lightning, Colorless, Fairy) take dark ink.
  const light = box.l > 0.72

  // ACCENTS — the deck's OTHER colours: the second energy type, then the main
  // attacker's art. A candidate is skipped if it would vanish into the box
  // (within 30° of its hue) or turn to mud: on a pale box the accents are
  // printed dark, and a dark orange or yellow is brown. With no usable
  // candidate the accent goes tonal — deeper shades on a pale box, a pale
  // glow on a strong one.
  const muddy = (h: number) => light && h >= 25 && h <= 115
  const usable = (h: number) => Math.abs(hueDelta(h, box.h)) >= 30 && !muddy(h)
  const candidates = [t2?.h, artUsable?.h].filter((h): h is number => h !== undefined && usable(h))
  const tonalDeep: Oklch = { l: box.l - 0.24, c: Math.min(0.17, Math.max(0.04, box.c * 1.5)), h: box.h }
  const accent: Oklch =
    candidates.length > 0
      ? { l: light ? 0.5 : 0.78, c: 0.14, h: candidates[0] }
      : light
        ? tonalDeep
        : { l: 0.9, c: 0.07, h: box.h }
  const second = candidates.find((h) => Math.abs(hueDelta(h, accent.h)) >= 25)
  const accent2: Oklch =
    second !== undefined
      ? { l: light ? 0.44 : 0.7, c: 0.14, h: second }
      : light
        ? { l: box.l - 0.12, c: Math.min(0.17, box.c * 1.25), h: box.h }
        : { l: 0.66, c: Math.min(0.12, Math.max(accent.c, 0.06)), h: accent.h }

  // STUDIO — a dark, nearly neutral sweep lit by a coloured key light. The
  // light takes the art's hue (the cards are lit in their own colours); the
  // wall only a trace of it, because a dark wall with real chroma reads as
  // brown for every warm hue.
  // (box.h, not t1.h: a neutral type's own hue is noise; the box has a chosen one.)
  const hb = artUsable ? artUsable.h : box.h
  const cb = artUsable ? clamp(artUsable.c * 0.3, 0.015, 0.035) : clamp(t1.c * 0.25, 0.01, 0.03)
  const keyC = artUsable ? clamp(artUsable.c * 1.1, 0.1, 0.16) : clamp(t1.c, 0.04, 0.13)

  // GRADIENT MAPS for the generated artwork. Stops must climb in lightness or
  // the map solarises; the box's run from a deep shadow through the box colour
  // to its highlight (the accent when the accent is the lighter colour, the
  // box's own light tint when it is not).
  const shadow: Oklch = { l: clamp(box.l - 0.34, 0.1, 0.3), c: box.c * 0.85, h: box.h }
  const highlight: Oklch = accent.l > box.l ? accent : { l: Math.min(0.92, box.l + 0.16), c: box.c * 0.7, h: box.h }
  const shine: Oklch = { l: Math.min(0.97, Math.max(highlight.l + 0.06, 0.9)), c: Math.min(highlight.c, 0.05), h: highlight.h }
  const boxMap = [shadow, { l: box.l - 0.15, c: box.c * 0.95, h: box.h }, box, highlight, shine]
    .sort((a, b) => a.l - b.l)
    .map(hex)
  const backdropMap = [
    { l: 0.1, c: cb * 0.5, h: hb },
    { l: 0.24, c: cb, h: hb },
    { l: 0.42, c: Math.min(0.09, keyC * 0.7), h: hb },
    { l: 0.7, c: keyC, h: hb },
    { l: 0.88, c: keyC * 0.4, h: hb },
  ].map(hex)

  return {
    wall: hex({ l: 0.3, c: cb, h: hb }),
    wallLow: hex({ l: 0.25, c: cb * 0.9, h: hb }),
    floor: hex({ l: 0.23, c: cb * 0.8, h: hb }),
    floorLow: hex({ l: 0.16, c: cb * 0.6, h: hb }),
    key: hex({ l: 0.64, c: keyC, h: hb }),
    box: hex(box),
    boxDeep: hex({ l: box.l - 0.16, c: box.c * 0.95, h: box.h }),
    boxLight: hex({ l: Math.min(0.93, box.l + 0.14), c: box.c * 0.7, h: box.h }),
    band: hex({ l: 0.2, c: Math.min(box.c, 0.035), h: box.h }),
    accent: hex(accent),
    accent2: hex(accent2),
    boxMap,
    backdropMap,
  }
}

// ── Style and art ────────────────────────────────────────────────────────────

/**
 * How the deck plays (see DeckStyle). Checked in this order, so a single-prize
 * stall deck is control and a rule-box Stage 2 hitting for 200 is power.
 */
export function deckStyle(
  rows: readonly ArtCardRow[],
  featured: readonly Candidate[],
  facts: ReadonlyMap<string, ArtCardFacts>,
): DeckStyle {
  const energyCards = rows.filter((r) => r.section === 'energy').reduce((n, r) => n + r.quantity, 0)
  const pokemon = rows.some((r) => r.section === 'pokemon')
  if (!pokemon || energyCards <= 4) return 'control'
  if (featured.length === 0 || featured.every((c) => ruleBoxWeight(c.name) <= 1.15)) return 'swarm'
  const main = featured[0]
  const f = facts.get(main.cardId)
  const best = f ? Math.max(0, ...f.attacks.map((a) => damageValue(a.damage))) : 0
  if (ruleBoxWeight(main.name) > 1.15 && best >= 200) return 'power'
  if (main.stage?.replace(/\s+/g, '').toLowerCase() === 'stage2') return 'engine'
  return 'balanced'
}

/** Variants per family in the art library (tools/deck-art/library.mjs). */
export const BOX_ART_VARIANTS = ['a', 'b', 'c'] as const
export const BACKDROP_VARIANTS = ['a', 'b', 'c', 'd'] as const

/**
 * The studio each style is shot in: a spotlight for the heavy hitters,
 * patterned (gobo) light for evolution engines, a calm painted canvas for
 * control, a field of bokeh for single-prize swarms, a plain sweep otherwise.
 */
export const STUDIO_FOR_STYLE: Record<DeckStyle, string> = {
  power: 'spotlight',
  engine: 'gobo',
  control: 'canvas',
  swarm: 'bokeh',
  balanced: 'sweep',
}

/**
 * The deck's two pieces of generated art. The FAMILY comes from the deck (its
 * leading energy type for the box, its style for the studio); the VARIANT from
 * the deck id's hash, so two Fire decks print different Fire panels but each
 * keeps its own for life.
 */
export function pickArt(deckId: string, type: EnergyType, style: DeckStyle): { box: string; backdrop: string } {
  const bv = BOX_ART_VARIANTS[hashString(`${deckId}:box`) % BOX_ART_VARIANTS.length]
  const sv = BACKDROP_VARIANTS[hashString(`${deckId}:studio`) % BACKDROP_VARIANTS.length]
  return { box: `box-${type.toLowerCase()}-${bv}`, backdrop: `backdrop-${STUDIO_FOR_STYLE[style]}-${sv}` }
}

// ── The whole spec ───────────────────────────────────────────────────────────

export interface DeriveInput {
  deckId: string
  glcType?: string | null
  rows: readonly ArtCardRow[]
  strategyMd?: string | null
  /** keyed by cardId; any subset (a failed lookup simply isn't here) */
  facts: ReadonlyMap<string, ArtCardFacts>
  /** colour sampled from the main attacker's art, if it could be read */
  artSwatch?: Oklch | null
}

export function deriveDeckArt(input: DeriveInput): DeckArtSpec {
  const candidates = rankCandidates(input.rows, input.strategyMd)
  const deckEnergy = energyCardWeights(input.rows)
  const scored = scoreCandidates(candidates, input.facts, deckEnergy)
  const featured = pickFeatured(scored)
  const types = deriveTypes(deckEnergy, featured, input.facts, input.glcType)
  const swatch = input.artSwatch ? quantizeSwatch(input.artSwatch) : null
  const style = deckStyle(input.rows, featured, input.facts)
  return {
    v: DERIVE_VERSION,
    featured: featured.map((c) => ({ cardId: c.cardId, name: c.name, low: c.images.low, high: c.images.high })),
    types,
    palette: derivePalette(types, swatch),
    style,
    art: pickArt(input.deckId, types[0] ?? 'Colorless', style),
    provisional: false,
  }
}

/**
 * What a tile shows before anything about its cards is known: the plain box
 * in the GLC type's colours if the deck declares one, else in a quiet
 * neutral, with no artwork yet (so nothing is fetched for a deck that is
 * about to be re-dressed). An EMPTY deck keeps this for good, but gets the
 * Colorless panel and a plain sweep in neutral tones — finished, not blank.
 */
export function provisionalDeckArt(deckId: string, glcType?: string | null, empty = false): DeckArtSpec {
  const t = normalizeType(glcType)
  const types: EnergyType[] = t ? [t] : []
  const palette = t ? derivePalette(types, null) : NEUTRAL_PALETTE
  const art = empty ? pickArt(deckId, t ?? 'Colorless', 'balanced') : { box: null, backdrop: null }
  return { v: DERIVE_VERSION, featured: [], types, palette, style: 'balanced', art, provisional: true }
}

/** Unopened stock: warm stone, matching the app's surfaces. */
export const NEUTRAL_PALETTE: DeckArtPalette = {
  wall: '#3a3532',
  wallLow: '#2f2b28',
  floor: '#292523',
  floorLow: '#1f1c1a',
  key: '#6b625b',
  box: '#6f6760',
  boxDeep: '#4c4541',
  boxLight: '#8d847c',
  band: '#2a2624',
  accent: '#857c74',
  accent2: '#5f5752',
  boxMap: ['#1f1c1a', '#4c4541', '#6f6760', '#8d847c', '#cfc8c0'],
  backdropMap: ['#141211', '#2a2624', '#433d39', '#6b625b', '#a39890'],
}
