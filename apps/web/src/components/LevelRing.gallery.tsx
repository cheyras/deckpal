/**
 * Gallery for LevelRing — segmented trainer-level ring.
 */
import { LevelRing } from './LevelRing'
import type { GalleryMeta } from '../routes/design/galleryTypes'

export default {
  name: 'LevelRing',
  source: 'apps/web/src/components/LevelRing.tsx',
  section: 'component',
  description:
    'Segmented trainer-level ring (10 arcs, action-primary-filled by progress). Holds the avatar disc, with the level badge overlaid on its lower edge.',
  component: LevelRing,
  defaults: { level: 5, intoLevel: 65, size: 96, stroke: 6, showBadge: true },
  variants: [
    { label: 'level 0', props: { level: 0, intoLevel: 0, size: 96, stroke: 6, showBadge: true } },
    { label: 'level 3 (40%)', props: { level: 3, intoLevel: 40, size: 96, stroke: 6, showBadge: true } },
    { label: 'level 7 (80%)', props: { level: 7, intoLevel: 80, size: 96, stroke: 6, showBadge: true } },
    { label: 'level 10 (max)', props: { level: 10, intoLevel: 100, size: 96, stroke: 6, showBadge: true } },
    { label: 'no badge', props: { level: 5, intoLevel: 50, size: 96, stroke: 6, showBadge: false } },
    { label: 'small (64px)', props: { level: 5, intoLevel: 50, size: 64, stroke: 4, showBadge: true } },
    { label: 'large (128px)', props: { level: 8, intoLevel: 75, size: 128, stroke: 8, showBadge: true } },
  ],
  knobs: {
    level: { kind: 'number', min: 0, max: 10, step: 1 },
    intoLevel: { kind: 'number', min: 0, max: 100, step: 5 },
    size: { kind: 'number', min: 32, max: 200, step: 8 },
    stroke: { kind: 'number', min: 2, max: 16, step: 1 },
    showBadge: { kind: 'boolean' },
  },
} satisfies GalleryMeta<{
  level: number
  intoLevel: number
  size?: number
  stroke?: number
  children?: React.ReactNode
  showBadge?: boolean
}>
