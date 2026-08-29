/**
 * Gallery for CardImage — fixed-aspect-ratio card-art box.
 */
import { CardImage } from './CardImage'
import { CARD_RADIUS_CSS } from '../lib/cardGeometry'
import type { GalleryMeta } from '../routes/design/galleryTypes'

// Use a placeholder that won't load (shows the skeleton behavior)
const PLACEHOLDER = { low: '', high: '' }

export default {
  name: 'CardImage',
  source: 'apps/web/src/components/CardImage.tsx',
  section: 'component',
  description:
    'Fixed-aspect-ratio (63:88, the physical Pokémon-card footprint) card-art box with error-hide-to-skeleton behavior. The corner radius is proportional to the rendered width (~4.76% of it), so a thumbnail and a detail view share the same shape.',
  component: CardImage,
  defaults: { low: '', high: '', alt: 'Sample card', eager: false, radius: CARD_RADIUS_CSS },
  variants: [
    { label: 'skeleton (no url)', props: { ...PLACEHOLDER, alt: 'No image', eager: false } },
    { label: 'default (physical-card radius)', props: { ...PLACEHOLDER, alt: 'Card', radius: CARD_RADIUS_CSS } },
    { label: 'compact px override', props: { ...PLACEHOLDER, alt: 'Card', radius: 6 } },
    { label: 'no radius', props: { ...PLACEHOLDER, alt: 'Card', radius: 0 } },
  ],
  knobs: {
    radius: { kind: 'text' },
    eager: { kind: 'boolean' },
  },
} satisfies GalleryMeta<{
  low: string
  high: string
  alt: string
  eager?: boolean
  className?: string
  radius?: number | string
}>
