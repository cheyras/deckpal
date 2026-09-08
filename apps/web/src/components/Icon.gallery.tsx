/**
 * Gallery for Icon.tsx — the 42-glyph hand-authored line-icon set.
 */
import { Icon, BrandLogo, BrandD, type IconName } from './Icon'
import type { GalleryMeta } from '../routes/design/galleryTypes'

const ALL_ICONS: IconName[] = [
  'cards', 'lists', 'deck', 'pokedex', 'discord', 'merch', 'pro', 'search',
  'sliders', 'grid', 'table', 'binder', 'chevron-down', 'chevron-left',
  'chevron-right', 'star-outline', 'star-filled', 'external', 'menu', 'close',
  'link', 'minus', 'plus', 'check', 'check-circle', 'alert', 'copy', 'shuffle',
  'download', 'cart', 'chart', 'user', 'gear', 'sparkle', 'camera', 'printer',
  'bug', 'book', 'history', 'logout', 'mail', 'key',
]

/** Grid display of all 42 icons — one variant per icon, shown as a grid. */
function IconGrid({ size, strokeWidth }: { size: number; strokeWidth: number }) {
  return (
    <div className="flex flex-wrap gap-[8px]">
      {ALL_ICONS.map((name) => (
        <div
          key={name}
          className="flex flex-col items-center gap-[4px] rounded-lg bg-surface-tertiary p-[8px] min-w-[60px]"
          title={name}
        >
          <Icon name={name} size={size} strokeWidth={strokeWidth} />
          <span className="text-[14px] text-text-muted">{name}</span>
        </div>
      ))}
    </div>
  )
}

export const iconGridGallery = {
  name: 'Icon (grid)',
  source: 'apps/web/src/components/Icon.tsx',
  section: 'primitive',
  description: '42 hand-authored line icons. 24x24 viewBox, stroke="currentColor".',
  component: IconGrid,
  defaults: { size: 24, strokeWidth: 1.75 },
  variants: [
    { label: 'default (24px)', props: { size: 24, strokeWidth: 1.75 } },
    { label: 'small (16px)', props: { size: 16, strokeWidth: 2 } },
    { label: 'large (32px)', props: { size: 32, strokeWidth: 1.5 } },
  ],
  knobs: {
    size: { kind: 'number', min: 12, max: 64, step: 2 },
    strokeWidth: { kind: 'number', min: 0.5, max: 4, step: 0.25 },
  },
} satisfies GalleryMeta<{ size: number; strokeWidth: number }>

export const iconSingleGallery = {
  name: 'Icon (single)',
  source: 'apps/web/src/components/Icon.tsx',
  section: 'primitive',
  description: 'Individual icon component with name, size, and strokeWidth props.',
  component: Icon,
  defaults: { name: 'cards' as IconName, size: 24, strokeWidth: 1.75 },
  variants: [
    { label: 'cards', props: { name: 'cards' as IconName, size: 24 } },
    { label: 'search', props: { name: 'search' as IconName, size: 24 } },
    { label: 'star-filled', props: { name: 'star-filled' as IconName, size: 24 } },
    { label: 'alert', props: { name: 'alert' as IconName, size: 24 } },
    { label: 'sparkle', props: { name: 'sparkle' as IconName, size: 24 } },
  ],
  knobs: {
    name: { kind: 'select', options: ALL_ICONS },
    size: { kind: 'number', min: 12, max: 64, step: 2 },
    strokeWidth: { kind: 'number', min: 0.5, max: 4, step: 0.25 },
  },
} satisfies GalleryMeta<{ name: IconName; size?: number; strokeWidth?: number }>

export const brandLogoGallery = {
  name: 'BrandLogo',
  source: 'apps/web/src/components/Icon.tsx',
  section: 'primitive',
  description:
    'The full DeckPal wordmark (public/logo/deckpal-logo-white.svg). Sized by height; the width follows the artwork. White because the app is dark-only — the dark-on-light variant ships alongside it for the README.',
  component: BrandLogo,
  defaults: { height: 30 },
  variants: [
    { label: 'sidebar (30)', props: { height: 30 } },
    { label: 'mobile header (22)', props: { height: 22 } },
    { label: 'auth (32)', props: { height: 32 } },
    { label: 'large (64)', props: { height: 64 } },
  ],
  knobs: {
    height: { kind: 'number', min: 12, max: 120, step: 2 },
  },
} satisfies GalleryMeta<{ height?: number }>

export const brandDGallery = {
  name: 'BrandD',
  source: 'apps/web/src/components/Icon.tsx',
  section: 'primitive',
  description:
    'The D monogram (public/logo/deckpal-d-white.svg), for rails too narrow for the wordmark. Today that is the collapsed sidebar and nothing else.',
  component: BrandD,
  defaults: { size: 33 },
  variants: [
    { label: 'collapsed rail (33)', props: { size: 33 } },
    { label: 'small (20)', props: { size: 20 } },
    { label: 'large (64)', props: { size: 64 } },
  ],
  knobs: {
    size: { kind: 'number', min: 12, max: 120, step: 4 },
  },
} satisfies GalleryMeta<{ size?: number }>

export default iconGridGallery
