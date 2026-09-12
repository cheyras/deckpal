/**
 * Gallery for UpcomingSetRow — the non-clickable "Coming Soon" row.
 *
 * This is also the only place the row can be LOOKED at without a catalog: it
 * renders from `UPCOMING_SETS` in the API, so on a dev machine pointed at the
 * live backend the real series page shows it only once the change is deployed.
 * The fixtures below are the shapes that reach it.
 */
import { UpcomingSetRow } from './UpcomingSetRow'
import type { SetSummary } from '../lib/api'
import type { GalleryMeta } from '../routes/design/galleryTypes'

const BASE: SetSummary = {
  setId: 'upcoming-pokemon-30th-celebration',
  slug: 'upcoming-pokemon-30th-celebration',
  name: '30th Celebration',
  releasedOn: '2026-09-16',
  isPromo: false,
  printedCount: 128,
  secretCount: 0,
  cardCountTotal: 128,
  logoUrl: null,
  symbolUrl: null,
  upcoming: true,
  logoAssetPath: '/brand/pokemon-30th-celebration-logo.webp',
}

export default {
  name: 'UpcomingSetRow',
  source: 'apps/web/src/components/UpcomingSetRow.tsx',
  section: 'component',
  description:
    'A set that has been announced but not published upstream: dashed, muted, badged "Coming Soon", and deliberately not a link — there is no set page behind it yet.',
  component: UpcomingSetRow,
  defaults: { set: BASE },
  variants: [
    { label: 'with logo + card count', props: { set: BASE } },
    {
      // The graceful degradation: an entry added before its logo was sourced.
      label: 'no logo yet',
      props: { set: { ...BASE, logoAssetPath: undefined } },
    },
    {
      // `printedCount: null` in the table arrives here as 0 — an announcement
      // that did not say how big the set is.
      label: 'count not yet known',
      props: { set: { ...BASE, cardCountTotal: 0, printedCount: 0 } },
    },
    {
      // Long names are the row's squeeze case: the title truncates, the badge
      // and the date must not.
      label: 'long name',
      props: { set: { ...BASE, name: '30th Celebration Classic Collection Premium Edition' } },
    },
  ],
} satisfies GalleryMeta<{ set: SetSummary }>
