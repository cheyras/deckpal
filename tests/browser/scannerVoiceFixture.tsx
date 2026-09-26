import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../apps/web/src/theme.css'
import { useScannerVoice } from '../../apps/web/src/scan/voice/useScannerVoice'
import { VoiceCaption, VoiceLiveRegion, VoicePrimer, VoiceToggle, voicePrimerSeen } from '../../apps/web/src/scan/voice/VoiceControls'
import { VerifyFeed } from '../../apps/web/src/scan/ui/VerifyFeed'
import { DEFAULT_SORT } from '../../apps/web/src/scan/ui/sort'
import type { FeedEntry, FeedVariant } from '../../apps/web/src/scan/ui/types'

// Test-only entry: the real voice hook, controls and verify list, composed the
// way Scan.tsx composes them, over a fixed list. No camera, engine or network —
// the recognizer is the fake that scannerVoice.mts installs before this loads.
declare global {
  interface Window {
    harness: {
      setLast: (captureId: string | null) => void
      setInFlight: (captureId: string | null) => void
      land: (id: string, name: string) => void
      setEnabled: (on: boolean) => void
      unmount: () => void
      feed: () => FeedEntry[]
    }
  }
}

const v = (variantId: number, kind: string, displayName: string, isPrimary = false): FeedVariant => ({
  variantId, kind, displayName, isPrimary, tier: kind === 'normal' ? 'standard' : 'special', ownedQuantity: 0,
})
const EXEGGCUTE = [v(1, 'normal', 'Normal', true), v(2, 'reverse', 'Reverse Holofoil'), v(3, 'reverse-foil-pokeball', 'Poke Ball Pattern Reverse Holofoil')]
const CHARIZARD = [v(11, 'holo-unlimited', 'Holofoil', true), v(12, 'holo-shadowless-stamp-1st-edition', '1st Edition Holofoil Shadowless'), v(13, 'holo-shadowless', 'Unlimited Holofoil Shadowless')]
const VENONAT = [v(21, 'normal', 'Normal', true), v(22, 'reverse', 'Reverse Holofoil')]
const ART = (hue: number) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"><rect width="63" height="88" rx="4" fill="hsl(${hue} 55% 45%)"/></svg>`)}`

function row(id: string, name: string, variants: FeedVariant[], hue: number): FeedEntry {
  return {
    id, cardId: `card-${id}`, matched: true, name, setName: 'Fixture Set', setId: 'sv1', number: '001', rarity: 'Common',
    images: null, capturePreviewUrl: ART(hue), captureBlob: new Blob(), captureId: id, captureTrackId: null, identity: null,
    confidence: 0.97, distance: 2, quantity: 1, variantId: variants[0].variantId, variants, printingPicked: false,
    detectingPrinting: false, alternates: [], capturedAt: 0, verified: false,
  }
}

function Scanner() {
  const [feed, setFeed] = useState<FeedEntry[]>([
    row('cap-1', 'Exeggcute', EXEGGCUTE, 90),
    row('cap-2', 'Charizard', CHARIZARD, 20),
    row('cap-3', 'Venonat', VENONAT, 280),
  ])
  const [enabled, setEnabled] = useState(true)
  const [primer, setPrimer] = useState(false)
  const last = useRef<string | null>('cap-3')
  const inFlight = useRef<string | null>(null)
  const voice = useScannerVoice({
    enabled,
    feed,
    setFeed,
    lastCaptureId: () => last.current,
    inFlight: (id) => inFlight.current === id,
  })
  Object.assign(window.harness, {
    setLast: (id: string | null) => (last.current = id),
    setInFlight: (id: string | null) => (inFlight.current = id),
    land: (id: string, name: string) => setFeed((f) => [...f, row(id, name, VENONAT, 200)]),
    setEnabled,
    feed: () => feed,
  })
  const requestStart = () => (voicePrimerSeen() ? voice.start() : setPrimer(true))
  // Layout by inline style: Tailwind only generates classes it finds under
  // apps/web, so this file's own utility classes would silently not exist.
  return (
    <main style={{ display: 'flex', flexDirection: 'column', height: '100vh', maxWidth: 640, margin: '0 auto', background: 'var(--color-surface-primary)' }}>
      <div data-scan-camera-view style={{ position: 'relative', height: 260, flexShrink: 0, background: '#000' }}>
        <VoiceCaption voice={voice} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', height: 44, flexShrink: 0, padding: '0 12px', background: 'var(--color-surface-secondary)' }}>
        <VoiceToggle voice={voice} onRequestStart={requestStart} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
        <VerifyFeed
          entries={feed}
          sort={DEFAULT_SORT}
          onSortChange={() => {}}
          onQuantityChange={(id, quantity) => setFeed((f) => f.map((e) => (e.id === id ? { ...e, quantity } : e)))}
          onVariantChange={(id, variantId) => setFeed((f) => f.map((e) => (e.id === id ? { ...e, variantId, printingPicked: true } : e)))}
          onCorrect={() => {}}
          onRemove={(id) => setFeed((f) => f.filter((e) => e.id !== id))}
          onReport={async () => {}}
          onOpenDetail={() => {}}
          registerThumbNode={() => {}}
          voicePending={voice.pendingByRow}
          onVoiceCancel={voice.cancel}
        />
      </div>
      {primer && (
        <VoicePrimer
          onClose={() => setPrimer(false)}
          onAccept={() => {
            setPrimer(false)
            voice.start()
          }}
        />
      )}
      <VoiceLiveRegion text={voice.announcement} />
    </main>
  )
}

function Root() {
  const [mounted, setMounted] = useState(true)
  window.harness = { ...window.harness, unmount: () => setMounted(false) }
  return mounted ? <Scanner /> : <p>unmounted</p>
}

window.harness = {} as Window['harness']
createRoot(document.getElementById('root')!).render(<Root />)
