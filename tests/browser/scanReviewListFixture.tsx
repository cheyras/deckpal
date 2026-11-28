// A camera-free /scan for the review list (scanReviewList.mts): the real
// VerifyFeed, rows, action bar, Deck-E launcher and toaster, inside the same
// document Scan.tsx lives in — AppShell's fixed header over a `min-h-screen`
// shell and `.app-content`, and the scanner's own `position: fixed` screen under
// it — over the owner's 2026-11-27 White Flare batch. No camera, no engine, no
// network, nothing signed in: the rows are fixtures and every write is local.
//
// The screen markup mirrors Scan.tsx's (title bar, the Verify bar, the list, the
// action bar; or the camera, the capture bar and the bin) because the bugs this
// exists for are about where things are on that screen, not about the camera.
import React, { useCallback, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../apps/web/src/theme.css'
import { VerifyFeed } from '../../apps/web/src/scan/ui/VerifyFeed'
import { PrimaryActionBar } from '../../apps/web/src/scan/ui/PrimaryActionBar'
import { DeckeButton } from '../../apps/web/src/character/host/DeckeButton'
import { PwaUi } from '../../apps/web/src/components/PwaUi'
import { Icon } from '../../apps/web/src/components/Icon'
import { feedTotals } from '../../apps/web/src/scan/ui/feed'
import { useFixedScreen } from '../../apps/web/src/lib/fixedScreen'
import { removeWithUndo } from '../../apps/web/src/scan/ui/undoRemove'
import type { FeedEntry, FeedVariant } from '../../apps/web/src/scan/ui/types'

declare global {
  interface Window {
    harness: {
      mode: (m: 'verify' | 'scan') => void
      land: (name: string) => void
      feed: () => FeedEntry[]
      reset: () => void
    }
  }
}

const variants = (base: number): FeedVariant[] => [
  { variantId: base, kind: 'normal', displayName: 'Normal', isPrimary: true, tier: 'standard', ownedQuantity: 0 },
  { variantId: base + 1, kind: 'reverse', displayName: 'Reverse Holofoil', isPrimary: false, tier: 'special', ownedQuantity: 0 },
]
const art = (hue: number, label: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"><rect width="63" height="88" rx="4" fill="hsl(${hue} 55% 45%)"/><text x="31" y="48" font-size="8" fill="white" text-anchor="middle" font-family="sans-serif">${label}</text></svg>`,
  )}`

// The owner's batch, in scan order: ten White Flare cards, two Durants, and the
// Lillipup the matcher called a Herdier sitting under the real Herdier.
const BATCH: [string, string, string][] = [
  ['Herdier', '075', 'Uncommon'],
  ['Herdier', '075', 'Uncommon'],
  ['Galvantula', '031', 'Uncommon'],
  ['Cheren', '084', 'Uncommon'],
  ['Durant', '061', 'Common'],
  ['Gothorita', '043', 'Uncommon'],
  ['Energy Retrieval', '082', 'Uncommon'],
  ['Durant', '061', 'Common'],
  ['Joltik', '030', 'Common'],
  ['Gothita', '042', 'Common'],
]
let seq = 0
function row(name: string, number: string, rarity: string): FeedEntry {
  seq += 1
  const id = `cap-${seq}`
  return {
    id, cardId: `sv10.5w-${number}`, matched: true, name, setName: 'White Flare', setId: 'sv10.5w', number, rarity,
    images: null, capturePreviewUrl: art(seq * 37, name), captureBlob: new Blob(), captureId: id, captureTrackId: null, identity: null,
    confidence: 0.81, distance: 12, quantity: 1, variantId: 500 + seq * 2, variants: variants(500 + seq * 2),
    printingPicked: false, detectingPrinting: false, alternates: [], capturedAt: seq, verified: false,
  }
}
const batch = () => BATCH.map(([n, num, r]) => row(n, num, r))

// `?before` replays the list as it shipped before this fix: a remove is a plain
// filter with nothing to undo, and the document behind the screen is left
// scrollable. The components themselves are whatever is in the tree.
const BEFORE = new URLSearchParams(location.search).has('before')

function Screen() {
  const [feed, setFeed] = useState<FeedEntry[]>(batch)
  const [mode, setMode] = useState<'verify' | 'scan'>('verify')
  const feedRef = useRef(feed)
  feedRef.current = feed
  useFixedScreen(!BEFORE)
  window.harness = {
    mode: setMode,
    land: (name) => setFeed((f) => [...f, row(name, '001', 'Common')]),
    feed: () => feedRef.current,
    reset: () => setFeed(batch()),
  }
  const remove = useCallback((id: string) => {
    if (BEFORE) setFeed((prev) => prev.filter((e) => e.id !== id))
    else removeWithUndo(feedRef.current, id, setFeed)
  }, [])
  const changeQuantity = useCallback(
    (id: string, quantity: number) => {
      if (quantity <= 0) return remove(id)
      setFeed((prev) => prev.map((e) => (e.id === id ? { ...e, quantity } : e)))
    },
    [remove],
  )
  const changeVariant = useCallback((id: string, variantId: number) => {
    setFeed((prev) => prev.map((e) => (e.id === id ? { ...e, variantId, printingPicked: true } : e)))
  }, [])
  const binView = useMemo(() => [...feed].reverse(), [feed])
  const total = feedTotals(feed).cards
  const noop = () => {}
  const common = {
    onQuantityChange: changeQuantity,
    onVariantChange: changeVariant,
    onCorrect: noop,
    onRemove: remove,
    onReport: async () => {},
    onOpenDetail: noop,
    registerThumbNode: noop,
  }

  return (
    <div
      className="fixed bottom-0 right-0 flex flex-col overflow-hidden bg-surface-primary"
      style={{ top: 'var(--app-header-h, 64px)', left: 'var(--app-sidebar-w, 0px)' }}
    >
      <div className="flex h-[46px] shrink-0 items-center gap-[8px] border-b border-divider-subtle bg-surface-secondary px-[14px]" data-title-bar>
        <Icon name="camera" size={18} className="text-action-primary" />
        <span className="text-[14px] font-bold text-text-primary">Scan</span>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {mode === 'scan' ? (
          <>
            <div className="flex min-h-[180px] flex-[3] flex-col overflow-hidden" data-camera>
              <div className="relative min-h-0 flex-1 bg-black" />
              <div className="flex h-[44px] shrink-0 items-center gap-[8px] border-b border-divider-subtle bg-surface-secondary px-[12px]">
                <span className="text-[12px] text-text-muted">capture bar</span>
              </div>
            </div>
            <div className="flex min-h-[140px] flex-[2] flex-col overflow-hidden border-t border-divider-subtle">
              <VerifyFeed entries={binView} sort={{ key: 'scan', dir: 'desc' }} followTop title="Cards" {...common} />
            </div>
            <PrimaryActionBar label={`Verify (${total})`} icon="check" count={total} onClick={() => setMode('verify')} />
          </>
        ) : (
          <>
            <div className="flex h-[46px] shrink-0 items-center gap-[10px] border-b border-divider-subtle bg-surface-secondary px-[10px]" data-verify-bar>
              <button type="button" onClick={() => setMode('scan')} className="flex h-[32px] items-center gap-[4px] rounded-full px-[10px] text-[13px] font-semibold text-text-body">
                <Icon name="chevron-left" size={16} /> Scan more
              </button>
            </div>
            <VerifyFeed entries={feed} sort={{ key: 'scan', dir: 'asc' }} onSortChange={noop} title="Verify" clearFab={total === 0} {...common} />
            <PrimaryActionBar label={`Add ${total} card${total === 1 ? '' : 's'}`} icon="plus" count={total} onClick={noop} />
          </>
        )}
      </div>
    </div>
  )
}

function Shell() {
  // AppShell's document: the fixed header, the `min-h-screen` shell, `main`
  // and `.app-content`, and the offsets it publishes (AppShell.tsx).
  return (
    <div className="app-shell min-h-screen bg-surface-primary">
      <header className="app-header fixed left-0 right-0 top-0 z-(--z-chrome) border-b border-border-default bg-surface-secondary">
        <div className="flex h-[64px] items-center px-4 text-[15px] font-bold text-text-primary">DeckPal</div>
      </header>
      <main id="main" className="app-main">
        <div className="app-content pt-16">
          <Screen />
        </div>
      </main>
      <style>{`:root{--app-header-h:64px;--app-sidebar-w:0px}.app-content{padding-top:calc(64px + env(safe-area-inset-top))}`}</style>
      <PwaUi />
      <DeckeButton hidden={false} onOpen={() => {}} onWarm={() => {}} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Shell />)
// main.tsx parks every route render on scrollY 1 (Safari 26, issue #40).
requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: 1, left: 0 })))
