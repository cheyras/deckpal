/**
 * Gallery for SetHeader — set-detail page header.
 *
 * SetHeader uses useSignedIn and renders several subcomponents
 * (SetSymbolTile, SetLogo, ProgressCluster, PurchaseSetMenu, SignInPrompt).
 * Renders inside an error boundary.
 */
import { SetHeader } from './SetHeader'
import type { GalleryMeta } from '../routes/design/galleryTypes'

type Goal = 'complete' | 'master' | 'grandmaster'

// Mock SetDetailResponse matching the domain type
const mockData = {
  set: {
    setId: 'swsh1',
    slug: 'swsh1',
    name: 'Sword & Shield',
    series: { slug: 'swsh', name: 'Sword & Shield', tcgdexId: 'swsh' },
    releasedOn: '2020-02-07',
    isPromo: false,
    printedCount: 202,
    secretCount: 14,
    cardCountTotal: 216,
    images: { logoUrl: null, symbolUrl: null, backgroundUrl: null },
    marketValueUsd: 450.0,
    mostExpensiveCard: { cardId: 'swsh1-1', name: 'Celebi V', number: '1', marketUsd: 12.5 },
  },
  progress: {
    complete: { owned: 142, total: 202, pct: 70 },
    master: { owned: 210, total: 600, pct: 35 },
    grandmaster: { owned: 120, total: 1000, pct: 12 },
  },
  query: {},
  pagination: { page: 1, pageSize: 50, total: 216, pageCount: 5 },
  cards: [],
}

export default {
  name: 'SetHeader',
  source: 'apps/web/src/components/SetHeader.tsx',
  section: 'component',
  description: 'Set-detail page header: logo, shop/purchase/print actions, symbol, progress-or-sign-in-prompt, 6-stat strip. Requires live session for sign-in status.',
  component: SetHeader,
  defaults: { data: mockData as any, goal: 'complete' as Goal },
  variants: [
    { label: 'normal set', props: { data: mockData as any, goal: 'complete' as Goal } },
    {
      label: 'master goal',
      props: { data: mockData as any, goal: 'master' as Goal },
    },
    {
      label: 'promo set',
      props: {
        data: {
          ...mockData,
          set: { ...mockData.set, isPromo: true, name: 'SWSH Black Star Promos', setId: 'swshp' },
        } as any,
        goal: 'complete' as Goal,
      },
    },
  ],
  knobs: {
    goal: { kind: 'select', options: ['complete', 'master', 'grandmaster'] as const },
  },
} satisfies GalleryMeta<{ data: any; goal: Goal }>
