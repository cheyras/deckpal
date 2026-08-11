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
}
