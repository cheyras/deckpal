/**
 * Gallery for ProgressCluster — set-completion progress bars.
 */
import { ProgressCluster } from './ProgressCluster'
import type { GalleryMeta } from '../routes/design/galleryTypes'

// Mock Progress object matching the domain type
const mockProgress = (completePct: number, masterPct: number, gmPct: number) => ({
  complete: { owned: Math.round(completePct * 2), total: 200, pct: completePct },
  master: { owned: Math.round(masterPct * 6), total: 600, pct: masterPct },
  grandmaster: { owned: Math.round(gmPct * 10), total: 1000, pct: gmPct },
})

type Goal = 'complete' | 'master' | 'grandmaster'

export default {
  name: 'ProgressCluster',
  source: 'apps/web/src/components/ProgressCluster.tsx',
  section: 'component',
  description: 'Two-bar set-completion cluster (Complete + Master/Grandmaster, milestone dots at 25/50/75/100).',
  component: ProgressCluster,
  defaults: { progress: mockProgress(72, 35, 12), goal: 'master' as Goal },
  variants: [
    { label: 'early (goal: complete)', props: { progress: mockProgress(15, 5, 1), goal: 'complete' as Goal } },
    { label: 'mid (goal: master)', props: { progress: mockProgress(72, 35, 12), goal: 'master' as Goal } },
    { label: 'near done (goal: grandmaster)', props: { progress: mockProgress(100, 88, 65), goal: 'grandmaster' as Goal } },
    { label: 'empty', props: { progress: mockProgress(0, 0, 0), goal: 'complete' as Goal } },
    { label: 'full', props: { progress: mockProgress(100, 100, 100), goal: 'grandmaster' as Goal } },
  ],
  knobs: {
    goal: { kind: 'select', options: ['complete', 'master', 'grandmaster'] as const },
  },
} satisfies GalleryMeta<{ progress: any; goal: Goal }>
