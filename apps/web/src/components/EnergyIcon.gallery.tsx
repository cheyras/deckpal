/**
 * Gallery for EnergyIcon.tsx — the 11 energy tokens.
 *
 * The token (disc, colour, raised treatment) and the glyph (energyGlyphs.tsx)
 * are separate; these entries show the token at every size the app uses it,
 * alone and in the places it actually sits.
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
  description:
    '11 energy tokens: a raised disc in the card-printed energy colour carrying the type glyph, traced from the printed cards (ENERGY-ICONS-NOTICE.md). Glyphs live in energyGlyphs.tsx (swap there). At 14px and below, grass and psychic draw a simplified glyph. Unknown types get a neutral token.',
  component: EnergyGrid,
  defaults: { size: 24 },
  variants: [
    { label: 'default (24px)', props: { size: 24 } },
    { label: 'chip (18px)', props: { size: 18 } },
    { label: 'deck row (16px)', props: { size: 16 } },
    { label: 'small (13px, simplified glyphs)', props: { size: 13 } },
    { label: 'large (40px)', props: { size: 40 } },
  ],
  knobs: {
    size: { kind: 'number', min: 11, max: 64, step: 1 },
  },
} satisfies GalleryMeta<{ size: number }>

const SAMPLE_TYPES = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Fairy', 'Dragon', 'Colorless']

/**
 * The token where it lives: card-detail type/weakness chips, an attack cost
 * and a retreat cost, on both the sheet's surface and the page's. These are
 * the pairings the colours were tuned against — a pale token on a stone chip,
 * a dark one on the sheet. Last, a light ground (deck art behind the deck-list
 * pill), where a pale token can be lighter than what it sits on.
 */
function EnergyInContext({ size }: { size: number }) {
  return (
    <div className="flex flex-col gap-[12px]">
      {['bg-surface-secondary', 'bg-surface-primary'].map((bg) => (
        <div key={bg} className={`${bg} flex flex-col gap-[12px] rounded-xl p-[12px]`}>
          <div className="flex flex-wrap gap-[8px]">
            {SAMPLE_TYPES.map((t) => (
              <span
                key={t}
                className="inline-flex h-[34px] items-center rounded-lg bg-surface-tertiary px-[12px] text-[14px] text-text-primary"
              >
                <EnergyIcon type={t} size={size} className="mr-[6px]" />
                {t}
              </span>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-[8px]">
              <span className="flex gap-[2px]">
                <EnergyIcon type="grass" size={size} />
                <EnergyIcon type="colorless" size={size} />
              </span>
              <span className="font-display text-[16px] font-semibold text-text-primary">Solar Beam</span>
            </div>
            <span className="inline-flex h-[34px] items-center rounded-lg bg-surface-tertiary px-[12px]">
              <span className="flex gap-[2px]">
                {[0, 1, 2].map((i) => (
                  <EnergyIcon key={i} type="colorless" size={size} />
                ))}
              </span>
            </span>
          </div>
        </div>
      ))}
      {/* A light ground: the DecksIndex pill sits over deck art, which can be a
          pale card scan. This is where colorless needs its rim. */}
      <div
        className="flex flex-col gap-[12px] rounded-xl p-[12px]"
        style={{ background: 'linear-gradient(135deg, #f6f1e4 0%, #e9e2cf 45%, #d8cfb8 100%)' }}
      >
        <div className="flex flex-wrap gap-[8px]">
          {SAMPLE_TYPES.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-[4px] rounded-full bg-surface-primary/80 px-[10px] py-[3px] text-[14px] font-bold text-text-secondary backdrop-blur-sm"
            >
              GLC<span>·</span>
              <EnergyIcon type={t} size={size} />
              {t}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-[6px]">
          {SAMPLE_TYPES.map((t) => (
            <EnergyIcon key={t} type={t} size={size} />
          ))}
        </div>
      </div>
    </div>
  )
}

export const energyInContextGallery = {
  name: 'EnergyIcon (in context)',
  source: 'apps/web/src/components/EnergyIcon.tsx',
  section: 'primitive',
  description:
    'Energy tokens in type/weakness chips, an attack cost and a retreat cost, on the sheet surface and the page surface; then the deck-list pill and bare tokens on light deck art, where colorless shows its rim.',
  component: EnergyInContext,
  defaults: { size: 18 },
  variants: [
    { label: 'card detail (18px)', props: { size: 18 } },
    { label: 'deck list (13px)', props: { size: 13 } },
  ],
  knobs: {
    size: { kind: 'number', min: 11, max: 40, step: 1 },
  },
} satisfies GalleryMeta<{ size: number }>

export const energySingleGallery = {
  name: 'EnergyIcon (single)',
  source: 'apps/web/src/components/EnergyIcon.tsx',
  section: 'primitive',
  description: 'Individual energy token.',
  component: EnergyIcon,
  defaults: { type: 'fire', size: 24 },
  variants: [
    { label: 'fire', props: { type: 'fire', size: 24 } },
    { label: 'water', props: { type: 'water', size: 24 } },
    { label: 'grass', props: { type: 'grass', size: 24 } },
    { label: 'lightning', props: { type: 'lightning', size: 24 } },
    { label: 'psychic', props: { type: 'psychic', size: 24 } },
    { label: 'darkness (light ink)', props: { type: 'darkness', size: 24 } },
    { label: 'colorless', props: { type: 'colorless', size: 24 } },
    { label: 'unknown', props: { type: 'mystical', size: 24 } },
  ],
  knobs: {
    type: { kind: 'select', options: [...ENERGY_TYPES, 'unknown'] },
    size: { kind: 'number', min: 11, max: 64, step: 1 },
  },
} satisfies GalleryMeta<{ type: string; size?: number }>

export default energyGridGallery
