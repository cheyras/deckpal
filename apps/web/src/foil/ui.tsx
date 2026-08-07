// foil/ui.tsx — small UI atoms shared by the two workbench surfaces
// (CanonLab + FoilLab). Self-contained; no imports from ../components
// (quarantine rule, roadmap/plans/foil-main.md). Moved verbatim out of
// FoilLab.tsx for the 2026-08-02 workbench split (issues/foil/…_4aq756).

import { Link } from '@tanstack/react-router'
import type { CoreUniform } from './shader'

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border-default bg-surface-secondary p-[12px]">
      <h2 className="mb-[10px] text-[11px] font-bold uppercase tracking-[0.08em] text-text-muted">
        {title}
      </h2>
      {children}
    </section>
  )
}

export function Chip({
  active,
  onClick,
  disabled = false,
  children,
}: {
  active: boolean
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`shrink-0 rounded-full border px-[10px] py-[4px] text-[12px] transition-colors disabled:opacity-40 ${
        active
          ? 'border-action-primary bg-action-primary/15 text-action-primary'
          : 'border-border-default bg-surface-tertiary text-text-muted hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  marked = false,
  dimmed = false,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  /** Show an override dot: this value differs from the canon baseline. */
  marked?: boolean
  /** The dial is inert under the current law — shown, but visibly so. */
  dimmed?: boolean
}) {
  return (
    <label className={`mb-[8px] block${dimmed ? ' opacity-40' : ''}`}>
      <span className="mb-[2px] flex justify-between text-[12px]">
        <span className="text-text-muted">
          {label}
          {marked && (
            <span className="ml-[5px] inline-block h-[6px] w-[6px] rounded-full bg-action-primary align-middle" title="differs from canon" />
          )}
        </span>
        <span className="tabular-nums text-text-primary">{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-action-primary)]"
      />
    </label>
  )
}

// ── The core-uniform slider table (R6 2026-08-07) ───────────────────────────
// ONE definition, rendered identically by both surfaces. It used to be two
// hand-kept copies of the same nineteen <Slider> lines in CanonLab.tsx and
// FoilLab.tsx, which is exactly the kind of thing that drifts.
//
// Chey: "On anything i maxed out, please adjust the ranges on the sliders so
// that i can actually go further in the direction i maxed out (except ones that
// seem to be more 'all the way on or all the way off' like ink guard)."
// So `max` here is the audited number. Four dials in his four hand-tuned canons
// sat exactly ON their cap; the ones that are genuine AMOUNTS were extended,
// and the ones that are 0..1 mix weights / law selectors were not, because
// past 1 they stop meaning anything (a mix weight of 1.4 extrapolates rather
// than intensifies, and the shader clamps most of them anyway):
//
//   uIntensity  2   -> 4    at cap (cracked-ice). Linear gain, no internal
//                           clamp — 4 does exactly twice what 2 does.
//   uSheen      3   -> 6    at cap TWICE (cracked-ice, tinsel-ii). Needed a
//                           shader change to mean anything: the additive
//                           budget's ceiling used to flatten at uSheen 2.0.
//                           It now resumes climbing above 3, so every stored
//                           value <= 3 is untouched and the new range bites.
//   uSat        1   -> 2    at cap on all three non-mirror canons. Past 1 the
//                           hue ramp extrapolates away from grey — a real
//                           super-saturate, and his baseline is full spectrum.
//   uHueSpread  1.5 -> 3    tinsel-ii at 1.25 was leaning on it. Pure
//                           multiplier on the hue argument, no clamp.
//
//   NOT extended, and why: uInkGuard (his explicit carve-out — and after the
//   R6 glyph split it should simply stay at 1), uMetal (a LAW SELECTOR, not an
//   amount), uSheenTint / uGrain / uTint / uArtGate (0..1 mix weights, all
//   clamped or extrapolating), uDarken and uDepth (fractions of the scan that
//   are ALREADY fully spent at 1 — uDepth 1 takes the unlit field to black,
//   there is nothing past it). uScale, uSpecular and uInkPop were audited and
//   nobody is near their cap.
//
// `group` splits the dials by what they change, which is a real architectural
// line rather than cosmetics:
//   'truth'     — visible on the blank canon base; this is pattern truth, and a
//                 saved canon freezes it.
//   'composite' — provably zero effect on a blank base (the ink estimates are
//                 exactly 0 on a flat tone), so these only shape how the
//                 pattern lands on a real card scan. This is the set that
//                 "apply to family" propagates.
export interface CoreSliderDef {
  key: CoreUniform
  label: string
  min: number
  max: number
  step: number
  fallback: number
  group: 'truth' | 'composite'
  /** Metalness-law only — inert while uMetal is 0 (every non-mirror recipe). */
  metalOnly?: boolean
}

export const CORE_SLIDERS: CoreSliderDef[] = [
  { key: 'uIntensity', label: 'Intensity', min: 0, max: 4, step: 0.02, fallback: 1, group: 'truth' },
  { key: 'uScale', label: 'Pattern scale', min: 0.25, max: 3, step: 0.05, fallback: 1, group: 'truth' },
  { key: 'uHueShift', label: 'Hue shift', min: 0, max: 1, step: 0.01, fallback: 0.5, group: 'truth' },
  { key: 'uHueSpread', label: 'Hue spread', min: 0, max: 3, step: 0.01, fallback: 0.5, group: 'truth' },
  { key: 'uSat', label: 'Color saturation', min: 0, max: 2, step: 0.01, fallback: 0.8, group: 'truth' },
  { key: 'uArtGate', label: 'Art gate (dark areas)', min: 0, max: 1, step: 0.01, fallback: 0, group: 'truth' },
  { key: 'uSpecular', label: 'Specular sheen', min: 0, max: 1.5, step: 0.02, fallback: 0.4, group: 'truth' },
  { key: 'uDarken', label: 'Mirror darken (substrate)', min: 0, max: 1, step: 0.01, fallback: 0, group: 'truth' },
  { key: 'uTint', label: 'Ink tint (art metallic)', min: 0, max: 1, step: 0.01, fallback: 0, group: 'composite' },
  { key: 'uInkGuard', label: 'Ink guard (legibility)', min: 0, max: 1, step: 0.01, fallback: 1, group: 'composite' },
  { key: 'uInkPop', label: 'Ink pop (chroma boost)', min: 0, max: 1.5, step: 0.02, fallback: 0.5, group: 'composite' },
  { key: 'uMetal', label: "Metallic (mirror law; 0 = pattern's own light)", min: 0, max: 1, step: 0.01, fallback: 0, group: 'composite' },
  { key: 'uSheen', label: 'Sheen strength (pattern light)', min: 0, max: 6, step: 0.02, fallback: 1, group: 'composite' },
  { key: 'uSheenTint', label: 'Sheen tint (own color→ink color)', min: 0, max: 1, step: 0.01, fallback: 0, group: 'composite' },
  { key: 'uDepth', label: 'Depth (substrate darks)', min: 0, max: 1, step: 0.01, fallback: 0.5, group: 'composite' },
  { key: 'uGrain', label: 'Texture (structure vs sheen)', min: 0, max: 1, step: 0.01, fallback: 1, group: 'composite', metalOnly: true },
]

/** The composite dials, in order — the set "apply to family" copies. */
export const COMPOSITE_KEYS = CORE_SLIDERS.filter((d) => d.group === 'composite').map((d) => d.key)

/**
 * Render the whole core-uniform block. `dirty` is the set of keys that differ
 * from the surface's baseline (canon, or canon+override on the card surface).
 * A metal-only dial is shown disabled while uMetal is 0 rather than hidden, so
 * it is obvious WHY it does nothing instead of silently eating a tuning pass.
 */
export function CoreSliders({
  uniforms,
  dirty,
  onChange,
}: {
  uniforms: Partial<Record<CoreUniform, number>>
  dirty: string[]
  onChange: (key: CoreUniform, value: number) => void
}) {
  const metalOff = (uniforms.uMetal ?? 0) <= 0.001
  return (
    <>
      {CORE_SLIDERS.map((d) => {
        const inert = d.metalOnly === true && metalOff
        return (
          <Slider
            key={d.key}
            label={inert ? `${d.label} — metal law only` : d.label}
            value={uniforms[d.key] ?? d.fallback}
            min={d.min}
            max={d.max}
            step={d.step}
            marked={dirty.includes(d.key)}
            dimmed={inert}
            onChange={(v) => onChange(d.key, v)}
          />
        )
      })}
    </>
  )
}

export function Select({
  value,
  onChange,
  children,
}: {
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-border-default bg-surface-tertiary px-[8px] py-[6px] text-[13px] text-text-primary"
    >
      {children}
    </select>
  )
}

export function ActionBtn({
  onClick,
  active = false,
  disabled = false,
  children,
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-[10px] py-[6px] text-[12px] disabled:opacity-40 ${
        active
          ? 'border-action-primary bg-action-primary/15 text-action-primary'
          : 'border-border-default bg-surface-tertiary text-text-primary hover:border-action-primary'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * The two-surface switcher (obvious navigation, per the split comment):
 *   Canon patterns — /foil-lab/canon — pattern-truth room, no card ink.
 *   Card adjust    — /foil-lab       — per-card masks + overrides + comments.
 */
export function SurfaceTabs({ active }: { active: 'canon' | 'card' }) {
  const tab = (isActive: boolean) =>
    `flex-1 rounded-md border px-[10px] py-[7px] text-center text-[13px] font-medium ${
      isActive
        ? 'border-action-primary bg-action-primary/15 text-action-primary'
        : 'border-border-default bg-surface-secondary text-text-muted hover:text-text-primary'
    }`
  return (
    <nav className="flex gap-[8px]">
      <Link to="/foil-lab/canon" className={tab(active === 'canon')}>
        Canon patterns
      </Link>
      <Link to="/foil-lab" className={tab(active === 'card')}>
        Card adjust
      </Link>
    </nav>
  )
}
