/**
 * Gallery for RarityMark — the inline-SVG printed rarity mark.
 *
 * Covers the classic three, the full SV star ladder (all three gold-star
 * tiers), Mega Hyper Rare, a legacy mark, the 'None' value, a null value, and
 * an unknown string.
 */
import { RarityMark } from './RarityMark'
import type { GalleryMeta } from '../routes/design/galleryTypes'

// Every catalog rarity the mark can resolve, so the gallery exercises the full
// table rather than a hand-picked subset. The strings are the verbatim catalog
// values (see inputs/rarities.json).
const ALL_RARITIES = [
  'Common',
  'Uncommon',
  'Rare',
  'Ultra Rare',
  'Promo',
  'Holo Rare',
  'Secret Rare',
  'None',
  'Illustration rare',
  'Double rare',
  'Shiny rare',
  'Holo Rare V',
  'Special illustration rare',
  'Rare Holo',
  'Holo Rare VMAX',
  'Hyper rare',
  'Rare Holo LV.X',
  'ACE SPEC Rare',
  'Holo Rare VSTAR',
  'Rare PRIME',
  'Classic Collection',
  'LEGEND',
  'Radiant Rare',
  'Shiny Ultra Rare',
  'Amazing Rare',
  'Shiny rare V',
  'Mega Hyper Rare',
  'Shiny rare VMAX',
  'Full Art Trainer',
  'Black White Rare',
] as const

/** A labelled grid of one mark per catalog rarity, at a given size. */
function RarityGrid({ size }: { size: number }) {
  return (
    <div className="flex flex-wrap gap-[8px]">
      {ALL_RARITIES.map((rarity) => (
        <div
          key={rarity}
          className="flex min-w-[120px] flex-col items-center gap-[4px] rounded-lg bg-surface-tertiary p-[8px]"
        >
          <div className="flex h-[24px] items-center text-text-primary">
            <RarityMark rarity={rarity} size={size} />
          </div>
          <span className="text-[12px] text-text-muted">{rarity}</span>
        </div>
      ))}
    </div>
  )
}

export const rarityGridGallery = {
  name: 'RarityMark (grid)',
  source: 'apps/web/src/components/RarityMark.tsx',
  section: 'primitive',
  description:
    'Inline-SVG printed rarity marks for every catalog value. The print is the source of truth — each mark was read off a real card scan (cited per entry in lib/rarity.ts). Gold, silver and white are real fills; black inherits currentColor. The SV star ladder (Common→Mega Hyper Rare) and the full Holo/Shiny/V/PRIME/LEGEND families are all deliberate, era-appropriate geometry; no invented letter badges.',
  component: RarityGrid,
  defaults: { size: 18 },
  variants: [
    { label: 'default (18px)', props: { size: 18 } },
    { label: 'tile size (14px)', props: { size: 14 } },
    { label: 'large (28px)', props: { size: 28 } },
  ],
  knobs: {
    size: { kind: 'number', min: 12, max: 40, step: 2 },
  },
} satisfies GalleryMeta<{ size: number }>

export const raritySingleGallery = {
  name: 'RarityMark (single)',
  source: 'apps/web/src/components/RarityMark.tsx',
  section: 'primitive',
  description:
    'A single rarity mark. Classic three, the full SV star ladder incl. all three gold-star tiers and Mega Hyper Rare, a legacy mark, None, null, and an unknown string.',
  component: RarityMark,
  defaults: { rarity: 'Hyper rare', size: 18 },
  variants: [
    { label: 'Common (circle)', props: { rarity: 'Common', size: 18 } },
    { label: 'Uncommon (diamond)', props: { rarity: 'Uncommon', size: 18 } },
    { label: 'Rare (one black star)', props: { rarity: 'Rare', size: 18 } },
    { label: 'Double rare (two black stars)', props: { rarity: 'Double rare', size: 18 } },
    { label: 'Ultra Rare (two silver stars)', props: { rarity: 'Ultra Rare', size: 18 } },
    { label: 'Illustration rare (one gold star)', props: { rarity: 'Illustration rare', size: 18 } },
    { label: 'Special illustration rare (two gold stars)', props: { rarity: 'Special illustration rare', size: 18 } },
    { label: 'Hyper rare (three gold stars)', props: { rarity: 'Hyper rare', size: 18 } },
    { label: 'Mega Hyper Rare (double-stroke)', props: { rarity: 'Mega Hyper Rare', size: 18 } },
    { label: 'Promo', props: { rarity: 'Promo', size: 18 } },
    { label: 'ACE SPEC Rare (magenta)', props: { rarity: 'ACE SPEC Rare', size: 18 } },
    { label: 'Amazing Rare (rainbow)', props: { rarity: 'Amazing Rare', size: 18 } },
    { label: 'legacy: Rare Holo', props: { rarity: 'Rare Holo', size: 18 } },
    { label: 'Rare PRIME (one black star)', props: { rarity: 'Rare PRIME', size: 18 } },
    { label: 'None (no mark)', props: { rarity: 'None', size: 18 } },
    { label: 'null (no mark)', props: { rarity: null, size: 18 } },
    { label: 'unknown string (neutral fallback)', props: { rarity: 'Hyper Rare Banana', size: 18 } },
  ],
  knobs: {
    rarity: { kind: 'text' },
    size: { kind: 'number', min: 12, max: 40, step: 2 },
  },
} satisfies GalleryMeta<{ rarity: string | null | undefined; size?: number }>

export default rarityGridGallery
