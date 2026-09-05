/**
 * Design-system entries for the billing surfaces.
 *
 * Only the PRESENTATIONAL half is catalogued: the amount picker, the saved-card
 * chip, and the two trust blocks. `CardForm` and everything above it are
 * deliberately absent — mounting them would create a Stripe SetupIntent (and
 * therefore a Stripe CUSTOMER) for whoever happened to open `/design`, which is
 * a real object in a real account created by looking at a reference page.
 *
 * The states below are the ones that are hard to reach by hand and easy to get
 * wrong: an expired card, a custom amount that is out of range, $0 selected.
 */
import { AmountChooser } from './AmountChooser'
import { CardChip, StripeBadge, TrustPoints } from './StripeTrust'
import type { GalleryMeta } from '../../routes/design/galleryTypes'

const PRESETS = [0, 300, 500, 1000, 2500]

const amountChooserGallery = {
  name: 'AmountChooser',
  source: 'apps/web/src/components/billing/AmountChooser.tsx',
  section: 'component',
  description:
    'The pay-what-you-want control. $0 is the first preset and the same weight as the others — a "no thanks" link '
    + 'underneath would make this a price list rather than pay-what-you-want.',
  component: AmountChooser,
  defaults: {
    presetsCents: PRESETS,
    valueCents: 500,
    onChange: () => {},
    minCents: 100,
    maxCents: 50000,
  },
  variants: [
    { label: '$5 selected (most common)', props: { presetsCents: PRESETS, valueCents: 500, onChange: () => {}, minCents: 100, maxCents: 50000 } },
    { label: '$0 selected — a real answer', props: { presetsCents: PRESETS, valueCents: 0, onChange: () => {}, minCents: 100, maxCents: 50000 } },
    { label: 'custom amount', props: { presetsCents: PRESETS, valueCents: 700, onChange: () => {}, minCents: 100, maxCents: 50000 } },
    { label: 'disabled (a write in flight)', props: { presetsCents: PRESETS, valueCents: 1000, onChange: () => {}, minCents: 100, maxCents: 50000, disabled: true } },
  ],
  knobs: {
    valueCents: { kind: 'number', min: 0, max: 50000, step: 100 },
    disabled: { kind: 'boolean' },
  },
} satisfies GalleryMeta<React.ComponentProps<typeof AmountChooser>>

const cardChipGallery = {
  name: 'CardChip',
  source: 'apps/web/src/components/billing/StripeTrust.tsx',
  section: 'component',
  description:
    'The saved card: brand, four digits, expiry. Not drawn as a plastic rectangle — four digits is the entire number '
    + 'this app has ever had, and a card-shaped graphic invites the reader to look for the rest of it.',
  component: CardChip,
  defaults: { brand: 'visa', last4: '4242', expiry: '09 / 28', warning: null },
  variants: [
    { label: 'Visa, healthy', props: { brand: 'visa', last4: '4242', expiry: '09 / 28', warning: null } },
    { label: 'Amex (brand name, not the mark)', props: { brand: 'amex', last4: '0005', expiry: '01 / 30', warning: null } },
    { label: 'expiring soon', props: { brand: 'mastercard', last4: '4444', expiry: '10 / 26', warning: 'soon' as const } },
    { label: 'expired', props: { brand: 'discover', last4: '1117', expiry: '01 / 26', warning: 'expired' as const } },
    { label: 'unknown brand', props: { brand: null, last4: '9999', expiry: null, warning: null } },
  ],
  knobs: {
    brand: { kind: 'text' },
    last4: { kind: 'text' },
    expiry: { kind: 'text' },
    warning: { kind: 'select', options: [null, 'soon', 'expired'] as const },
  },
} satisfies GalleryMeta<React.ComponentProps<typeof CardChip>>

const trustPointsGallery = {
  name: 'TrustPoints',
  source: 'apps/web/src/components/billing/StripeTrust.tsx',
  section: 'component',
  description:
    'Three claims about how this software works. Every one is checkable in the code — see the header of StripeTrust.tsx '
    + 'for what makes each of them true.',
  component: TrustPoints,
  defaults: {},
  variants: [{ label: 'default', props: {} }],
} satisfies GalleryMeta<React.ComponentProps<typeof TrustPoints>>

const stripeBadgeGallery = {
  name: 'StripeBadge',
  source: 'apps/web/src/components/billing/StripeTrust.tsx',
  section: 'component',
  description:
    'The line under a card field. The test-mode pill is not decoration: without it, "I paid and nothing happened" has '
    + 'no visible explanation on a deployment pointed at test keys.',
  component: StripeBadge,
  defaults: { mode: 'live' as const },
  variants: [
    { label: 'live', props: { mode: 'live' as const } },
    { label: 'test mode', props: { mode: 'test' as const } },
    { label: 'unknown key prefix', props: { mode: 'unknown' as const } },
  ],
  knobs: { mode: { kind: 'select', options: ['live', 'test', 'unknown'] as const } },
} satisfies GalleryMeta<React.ComponentProps<typeof StripeBadge>>

export default amountChooserGallery
export { cardChipGallery, trustPointsGallery, stripeBadgeGallery }
