/**
 * Gallery for EnergyIcon.tsx — 11 energy-type glyphs.
 */
import { EnergyIcon, ENERGY_TYPES } from './EnergyIcon'
import type { GalleryMeta } from '../routes/design/galleryTypes'

/** Grid of all energy types + unknown-type fallback. */
function EnergyGrid({ size }: { size: number }) {
  return (
    <div className="flex flex-wrap gap-[8px]">
      {[...ENERGY_TYPES, 'unknown'].map((type) => (
        <div
          key={type}
          className="flex flex-col items-center gap-[4px] rounded-lg bg-surface-tertiary p-[8px] min-w-[60px]"
        >
          <EnergyIcon type={type} size={size} />
          <span className="text-[14px] text-text-muted capitalize">{type}</span>
        </div>
      ))}
    </div>
  )
}

export const energyGridGallery = {
  name: 'EnergyIcon (grid)',
  source: 'apps/web/src/components/EnergyIcon.tsx',
  section: 'primitive',
  description: '11 energy-type SVG glyphs with colored discs. Unknown types get a neutral fallback.',
  component: EnergyGrid,
  defaults: { size: 24 },
  variants: [
    { label: 'default (24px)', props: { size: 24 } },
    { label: 'small (16px)', props: { size: 16 } },
    { label: 'large (40px)', props: { size: 40 } },
  ],
  knobs: {
    size: { kind: 'number', min: 12, max: 64, step: 2 },
  },
} satisfies GalleryMeta<{ size: number }>

export const energySingleGallery = {
  name: 'EnergyIcon (single)',
  source: 'apps/web/src/components/EnergyIcon.tsx',
  section: 'primitive',
  description: 'Individual energy-type glyph.',
  component: EnergyIcon,
  defaults: { type: 'fire', size: 24 },
  variants: [
    { label: 'fire', props: { type: 'fire', size: 24 } },
    { label: 'water', props: { type: 'water', size: 24 } },
    { label: 'grass', props: { type: 'grass', size: 24 } },
    { label: 'lightning', props: { type: 'lightning', size: 24 } },
    { label: 'psychic', props: { type: 'psychic', size: 24 } },
    { label: 'colorless', props: { type: 'colorless', size: 24 } },
    { label: 'unknown', props: { type: 'mystical', size: 24 } },
  ],
  knobs: {
    type: { kind: 'select', options: [...ENERGY_TYPES, 'unknown'] },
    size: { kind: 'number', min: 12, max: 64, step: 2 },
  },
} satisfies GalleryMeta<{ type: string; size?: number }>

export default energyGridGallery
