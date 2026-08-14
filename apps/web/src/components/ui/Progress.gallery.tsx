import { ProgressBar, ProgressRing, type ProgressBarProps, type ProgressRingProps } from './Progress'
import type { GalleryMeta } from '../../routes/design/galleryTypes'

export const progressBarGallery = {
  name: 'ProgressBar',
  source: 'apps/web/src/components/ui/Progress.tsx',
  section: 'primitive',
  description:
    'Linear progress bar with track, fill, and optional milestone dots. Default fill is the danger-to-primary gradient.',
  component: ProgressBar,
  defaults: { pct: 65, height: 6 },
  variants: [
    { label: 'default (65%)', props: { pct: 65 } },
    { label: 'empty', props: { pct: 0 } },
    { label: 'full', props: { pct: 100 } },
    { label: 'with milestones', props: { pct: 55, milestones: [25, 50, 75] } },
    { label: 'thin (2px)', props: { pct: 40, height: 2 } },
    { label: 'solid fill', props: { pct: 70, fill: 'var(--color-change-positive)' } },
  ],
  knobs: {
    pct: { kind: 'number', min: 0, max: 100, step: 1 },
    height: { kind: 'number', min: 1, max: 12, step: 1 },
  },
} satisfies GalleryMeta<ProgressBarProps>

export default {
  name: 'ProgressRing',
  source: 'apps/web/src/components/ui/Progress.tsx',
  section: 'primitive',
  description:
    'Circular progress ring with track, fill stroke, and optional centre content.',
  component: ProgressRing,
  defaults: { pct: 65, size: 56, stroke: 5, children: '65%' },
  variants: [
    { label: 'default (65%)', props: { pct: 65, children: '65%' } },
    { label: 'empty', props: { pct: 0, children: '0%' } },
    { label: 'full', props: { pct: 100, children: '100%' } },
    { label: 'small (36px)', props: { pct: 42, size: 36, stroke: 3, children: '42%' } },
    { label: 'custom colour', props: { pct: 80, fillColor: 'var(--color-completion-grandmaster)', children: '80%' } },
  ],
  knobs: {
    pct: { kind: 'number', min: 0, max: 100, step: 1 },
    size: { kind: 'number', min: 24, max: 120, step: 4 },
    stroke: { kind: 'number', min: 1, max: 10, step: 1 },
  },
} satisfies GalleryMeta<ProgressRingProps & { children?: React.ReactNode }>
