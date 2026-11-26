// A camera-free stage for the scanner's review motion (scanReviewMotion.mts):
// the scanning bin (newest first, VerifyFeed followTop) and the swipe review,
// over fixture rows the runner lands and confirms. Real components, real clock,
// so the recording shows exactly what a phone would.
import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../apps/web/src/theme.css'
import { VerifyFeed } from '../../apps/web/src/scan/ui/VerifyFeed'
import { SwipeReview } from '../../apps/web/src/scan/ui/SwipeReview'
import { runningOwned } from '../../apps/web/src/scan/ui/feed'
import type { FeedEntry, FeedVariant } from '../../apps/web/src/scan/ui/types'

declare global {
  interface Window {
    harness: {
      land: (id: string, name: string, hue: number, variantId?: number) => void
      mode: (m: 'bin' | 'swipe') => void
      clear: () => void
      feed: () => FeedEntry[]
    }
  }
}

const variants = (base: number, owned = 0): FeedVariant[] => [
  { variantId: base, kind: 'normal', displayName: 'Normal', isPrimary: true, tier: 'standard', ownedQuantity: owned },
  { variantId: base + 1, kind: 'reverse', displayName: 'Reverse Holofoil', isPrimary: false, tier: 'special', ownedQuantity: 0 },
]
const art = (hue: number, label: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"><rect width="63" height="88" rx="4" fill="hsl(${hue} 55% 45%)"/><text x="31" y="48" font-size="9" fill="white" text-anchor="middle" font-family="sans-serif">${label}</text></svg>`,
  )}`

function row(id: string, name: string, hue: number, variantId: number): FeedEntry {
  return {
    id, cardId: `card-${name}`, matched: true, name, setName: 'Fixture Set', setId: 'sv1', number: '018', rarity: 'Double Rare',
    images: null, capturePreviewUrl: art(hue, name), captureBlob: new Blob(), captureId: id, captureTrackId: null, identity: null,
    confidence: 0.97, distance: 2, quantity: 1, variantId, variants: variants(variantId - (variantId % 2 === 0 ? 0 : 1)),
    printingPicked: false, detectingPrinting: false, alternates: [], capturedAt: 0, verified: false,
  }
}

function Stage() {
  const [feed, setFeed] = useState<FeedEntry[]>([])
  const [mode, setMode] = useState<'bin' | 'swipe'>('bin')
  const binView = useMemo(() => [...feed].reverse(), [feed])
  const owned = useMemo(() => runningOwned(feed), [feed])
  window.harness = {
    land: (id, name, hue, variantId = 500) => setFeed((f) => [...f, row(id, name, hue, variantId)]),
    mode: setMode,
    clear: () => setFeed([]),
    feed: () => feed,
  }
  const noop = () => {}
  return (
    <div className="flex h-screen w-full flex-col bg-surface-primary">
      {mode === 'bin' ? (
        <>
          <div className="h-[430px] shrink-0 bg-black" />
          <div className="flex h-[300px] min-h-0 flex-col border-t border-divider-subtle">
            <VerifyFeed
              entries={binView}
              sort={{ key: 'scan', dir: 'desc' }}
              followTop
              title="Cards"
              onQuantityChange={noop}
              onVariantChange={noop}
              onCorrect={noop}
              onRemove={noop}
              onReport={async () => {}}
              onOpenDetail={noop}
              registerThumbNode={noop}
            />
          </div>
        </>
      ) : (
        <SwipeReview
          entries={feed}
          owned={owned}
          onQuantityChange={noop}
          onVariantChange={noop}
          onConfirm={(id) => setFeed((f) => f.map((e) => (e.id === id ? { ...e, verified: true } : e)))}
          onCorrect={noop}
          onSkip={noop}
          onOpenDetail={noop}
        />
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Stage />)
