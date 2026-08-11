/**
 * Gallery for CardImage — fixed-aspect-ratio card-art box.
 */
import { CardImage } from './CardImage'
import type { GalleryMeta } from '../routes/design/galleryTypes'

// Use a placeholder that won't load (shows the skeleton behavior)
const PLACEHOLDER = { low: '', high: '' }

export default {
  name: 'CardImage',
  source: 'apps/web/src/components/CardImage.tsx',
  section: 'component',
  description: 'Fixed-aspect-ratio (245:337) card-art box with error-hide-to-skeleton behavior.',
  component: CardImage,
  defaults: { low: '', high: '', alt: 'Sample card', eager: false, radius: 8 },
  variants: [
    { label: 'skeleton (no url)', props: { ...PLACEHOLDER, alt: 'No image', eager: false } },
    { label: 'default radius', props: { ...PLACEHOLDER, alt: 'Card', radius: 8 } },
    { label: 'rounded', props: { ...PLACEHOLDER, alt: 'Card', radius: 16 } },
    { label: 'no radius', props: { ...PLACEHOLDER, alt: 'Card', radius: 0 } },
  ],
  knobs: {
    radius: { kind: 'number', min: 0, max: 24, step: 2 },
    eager: { kind: 'boolean' },
  },
} satisfies GalleryMeta<{
  low: string
  high: string
  alt: string
  eager?: boolean
  className?: string
  radius?: number
}>
