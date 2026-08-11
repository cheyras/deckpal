/**
 * Gallery types — type-checked against real component prop surfaces.
 *
 * `satisfies GalleryMeta<MyComponentProps>` in each gallery file ensures
 * that knob keys and variant props are compile-time-checked against the
 * component's actual TypeScript interface. When a prop is renamed,
 * `tsc --noEmit` fails on the gallery file — no runtime docgen machinery.
 */
import type { ComponentType } from 'react'

export type KnobDef<V> =
  | { kind: 'boolean' }
  | { kind: 'text' }
  | { kind: 'number'; min?: number; max?: number; step?: number }
  | { kind: 'select'; options: readonly V[] }

export interface GalleryMeta<P> {
  name: string
  /** repo-relative source path — this is what the agent lane edits */
  source: string
  section: 'primitive' | 'component'
  description?: string
  component: ComponentType<P>
  /** the states grid: each entry renders once, labeled */
  variants: ReadonlyArray<{ label: string; props: P }>
  /** knob keys are constrained to REAL prop names — a typo or a removed prop is a tsc error */
  knobs?: { [K in keyof P]?: KnobDef<P[K]> }
  /** starting props for the interactive knob instance */
  defaults: P
  /**
   * Set this when `component` renders full-viewport overlay UI — anything
   * `position: fixed` covering the page (modals, sheets, popovers with a
   * backdrop). CatalogSection never mounts an overlay entry inline in the
   * grid (a fixed/full-viewport element renders relative to the *viewport*,
   * not its card, so an eagerly-mounted one covers the whole catalog page and
   * traps pointer events). Instead each variant — and the knob-driven
   * interactive preview — renders as a "click to open" trigger card; opening
   * mounts the component with a real `onClose` wired to per-entry React
   * state that flips it back closed. Any `onClose` supplied in `variants[].props`
   * or `defaults` is a placeholder only (needed to satisfy the prop type) —
   * CatalogSection always overrides it with the real closer when mounting.
   */
  overlay?: boolean
}
