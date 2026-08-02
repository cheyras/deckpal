// foil/canon.ts — the canon-vs-override layering model (2026-08-02 workbench
// split, issues/foil/…_4aq756).
//
// Uniform baseline layering, lowest to highest:
//   1. GLOBAL_DEFAULTS + pattern.defaults + pattern.params  (code — patterns.ts,
//      the R0 re-tune lane)
//   2. canon file  data/foil-canon/<patternId>.json         (surface A saves a
//      FULL snapshot; when present it replaces the code defaults as the
//      baseline — "locked down")
//   3. per-card override  data/foil-overrides/<card>/<variant>.json (surface B
//      saves a SPARSE diff vs the canon baseline; untouched uniforms keep
//      tracking canon as it evolves)
//   4. live sliders (ephemeral)
//
// MIGRATION DISCIPLINE: canon files and overrides are keyed by canonical
// pattern ids — resolve through canonicalPatternId() on read so PATTERN_ALIASES
// entries (e.g. sv-holo) never orphan a saved file.

import { GLOBAL_DEFAULTS } from './shader'
import { canonicalPatternId, type FoilPattern } from './patterns'
import type { FoilCanonEntry } from './api'

/** Code-default uniform seed for a pattern (layer 1). */
export function seedUniforms(pattern: FoilPattern): Record<string, number> {
  const u: Record<string, number> = { ...GLOBAL_DEFAULTS }
  for (const [k, v] of Object.entries(pattern.defaults)) u[k] = v as number
  for (const p of pattern.params) u[p.key] = p.default
  return u
}

/** Canon-effective baseline (layers 1+2): code seed overlaid with the canon snapshot. */
export function canonBaseline(pattern: FoilPattern, canon: FoilCanonEntry | undefined): Record<string, number> {
  const u = seedUniforms(pattern)
  if (canon) for (const [k, v] of Object.entries(canon.uniforms)) u[k] = v
  return u
}

/** Sparse diff: uniforms in `current` that differ from `baseline` (slider epsilon). */
export function sparseDiff(
  current: Record<string, number>,
  baseline: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(current)) {
    if (Math.abs(v - (baseline[k] ?? 0)) > 1e-6) out[k] = v
  }
  return out
}

/** Canon entry for a (possibly aliased) pattern id out of the GET /canon map. */
export function canonFor(
  canonMap: Record<string, FoilCanonEntry> | undefined,
  patternId: string,
): FoilCanonEntry | undefined {
  return canonMap?.[canonicalPatternId(patternId)]
}

// ── Reference corpus mapping ────────────────────────────────────────────────
// Pattern ids match research/foil-video-reference/<slug>/ dirs 1:1 except:
//   none          — no physical foil, no reference
//   reverse-sheet — models the stamped emblem sheet ≈ video #30 (patterns.ts
//                   taxonomy note), so it borrows that chapter's clip.
const REFERENCE_ALIAS: Record<string, string | null> = {
  none: null,
  'reverse-sheet': 'pokeball-masterball',
}

/** Video-reference dir slug for a pattern id, or null when none exists. */
export function referenceSlug(patternId: string): string | null {
  const canonical = canonicalPatternId(patternId)
  return canonical in REFERENCE_ALIAS ? (REFERENCE_ALIAS[canonical] ?? null) : canonical
}
