/**
 * Gallery for SpriteTile — species sprite box with captured/uncaptured dimming.
 */
import { SpriteTile } from './SpriteTile'
import type { GalleryMeta } from '../routes/design/galleryTypes'

export default {
  name: 'SpriteTile',
  source: 'apps/web/src/components/SpriteTile.tsx',
  section: 'component',
  description: 'Fixed-geometry species-sprite box with captured/uncaptured dimming and Poke-ball-outline placeholder on 404.',
  component: SpriteTile,
  defaults: { src: '', alt: 'Pikachu', captured: true, pixelated: true },
  variants: [
    { label: 'captured', props: { src: '', alt: 'Pikachu', captured: true, pixelated: true } },
    { label: 'uncaptured', props: { src: '', alt: 'Unknown', captured: false, pixelated: true } },
    { label: 'smooth', props: { src: '', alt: 'Pikachu', captured: true, pixelated: false } },
  ],
  knobs: {
    captured: { kind: 'boolean' },
    pixelated: { kind: 'boolean' },
  },
} satisfies GalleryMeta<{
  src: string
  alt: string
  captured: boolean
  pixelated?: boolean
  className?: string
}>
