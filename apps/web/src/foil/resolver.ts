// foil/resolver.ts — v1 heuristic resolver:
//   (series, rarity, variant kind) → { patternId, scope, eraId }
// This is the seed of the E1 resolver table (set/rarity/variant_tier →
// layout/pattern/mask_ref + a foil_recipe MCP tool — a later sub-branch).
// v1 covers the eras Chey owns; unknowns fall back to sane defaults and the
// workbench dropdowns override everything anyway.

import layouts from './era-layouts.json'

export type FoilScope = 'window' | 'sheet' | 'full' | 'none'

export interface FoilRecipeRef {
  patternId: string
  scope: FoilScope
  eraId: keyof typeof layouts.eras
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

export function resolveFoil(input: {
  seriesSlug: string
  rarity: string | null
  variantKind: string | null
}): FoilRecipeRef {
  const eraId = ERA_BY_SERIES[input.seriesSlug] ?? 'modern-sv'
  const vintage = eraId === 'wotc'
  const kind = (input.variantKind ?? '').toLowerCase()
  const rarity = (input.rarity ?? '').toLowerCase()

  // Reverse holo: sheet scope, mirror pattern (any era that has reverses).
  if (kind.includes('reverse')) {
    return { patternId: 'reverse-sheet', scope: 'sheet', eraId }
  }
  // Full-face foil rarities (modern ex / IR / SIR / hyper …).
  if (FULL_FOIL_RARITIES.some((r) => rarity.includes(r))) {
    return { patternId: vintage ? 'starlight' : 'sv-holo', scope: 'full', eraId }
  }
  // Classic holo variants: foil fills the art window.
  if (kind.includes('holo')) {
    return { patternId: vintage ? 'starlight' : 'sv-holo', scope: 'window', eraId }
  }
  // Plain printing.
  return { patternId: 'none', scope: 'none', eraId }
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
