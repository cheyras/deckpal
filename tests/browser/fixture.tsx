import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './fixture.css'
import { DeckeChat, type ChatMessage } from '../../apps/web/src/character/host/DeckeChat'
import { DeckeScreen } from '../../apps/web/src/character/host/DeckeScreen'
import { useDeckeChat } from '../../apps/web/src/character/host/useDeckeChat'
import type { DeckEInstance } from '../../apps/web/src/character/host/runtime'
import { openerStore, readLastSaid } from '../../apps/web/src/character/host/deckeChatState'
import { SUBHEADS } from '../../apps/web/src/character/host/deckeVoice'
import { PwaUi } from '../../apps/web/src/components/PwaUi'
import { Sheet } from '../../apps/web/src/components/ui/Sheet'

// Test-only entry: actual components, no host/WebGL/model or production route.
const events = { closes: 0, sends: [] as string[], topUps: 0, retries: [] as string[] }
type FixtureState = { open: boolean; busy: boolean; messages: ChatMessage[]; credits: { remaining: number; allowance: number } }
declare global {
  interface Window {
    fixture: { events: typeof events; set: (patch: Partial<FixtureState>) => void; expectedSubhead: () => string | undefined }
    /** `?meter` only — the real hook's own send, so the test drives real fetches. */
    meterChat: { send: (text: string) => void; busy: boolean }
    /** `?offline` only — offline.mjs drives the real Sheet/PwaUi collision + connectivity check through this. */
    offlineFixture: { openSheet: () => void; closeSheet: () => void; submitted: number }
  }
}
function Fixture() {
  const [state, setState] = useState<FixtureState>({ open: true, busy: false, messages: [],
    credits: { remaining: 2, allowance: 100 } })
  window.fixture = { events, set: patch => setState(s => ({ ...s, ...patch })),
    expectedSubhead: () => SUBHEADS.find(s => s.id === readLastSaid(openerStore()).subheadId)?.text }
  if (location.search.includes('screen')) return <main style={{ maxWidth: 700, padding: 24 }}>
    <DeckeScreen spec={{ title: 'Browser screen', blocks: Array.from({ length: 6 }, (_, i) =>
      ({ kind: 'text', text: 'Section ' + (i + 1) })) }} />
  </main>
  if (location.search.includes('meter')) return <MeterFixture />
  if (location.search.includes('offline')) return <OfflineHarness />
  return <DeckeChat {...state} minimised={false} onExpand={() => {}}
    onClose={() => { events.closes++ }} decke={null}
    onSend={text => events.sends.push(text)} onStop={() => setState(s => ({ ...s, busy: false }))}
    asking={null} onApprove={() => {}} onDeny={() => {}} approvalPreview={() => null}
    approvalChoices={new Map()} onApprovalChoice={() => {}} approvalBusy={false}
    onRetryTool={id => events.retries.push(id)} desktop={innerWidth >= 1068} characterPx={160}
    onTopUp={() => { events.topUps++ }} />
}

/**
 * The real `PwaUi` (install pill / offline banner / update toast) alongside a
 * real `Sheet`, footer and all — the exact shape of the Bug Report / Add Cards
 * sheets `PR-PROTOCOL`'s repro named. `offline.mjs` drives this to prove two
 * things against the real components rather than a description of them:
 *
 * 1. The offline banner never paints over an open sheet's footer (the z-index
 *    fix in `theme.css`'s `--z-toast`).
 * 2. The banner reflects a CONFIRMED offline state (`useConnectivity`), not a
 *    raw `navigator.onLine` hint — the hook makes a real `fetch` to this
 *    fixture's own `/deckpal/api/me`, so toggling the page offline/online or
 *    spoofing `navigator.onLine` exercises the real probe, not a stub of it.
 */
function OfflineHarness() {
  const [open, setOpen] = useState(false)
  const [submitted, setSubmitted] = useState(0)
  window.offlineFixture = { openSheet: () => setOpen(true), closeSheet: () => setOpen(false), submitted }
  return (
    <>
      <PwaUi />
      {open && (
        <Sheet
          title="Report a problem"
          onClose={() => setOpen(false)}
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" onClick={() => { setSubmitted(n => n + 1); setOpen(false) }}>Submit</button>
            </div>
          }
        >
          <p>Fixture body standing in for the Bug Report sheet&apos;s form.</p>
        </Sheet>
      )}
    </>
  )
}

/**
 * The REAL `useDeckeChat`, over the REAL `fetch('/api/chat')`.
 *
 * Every other case here renders presentation from fixed props. This one exists
 * because a meter refusal has to survive the browser's own leg loop — stream
 * accumulation, approval round trip, the next request body — and that loop was
 * exactly where it was being dropped. Pinning it anywhere short of a real
 * request is how the last pass shipped green with the wire still broken.
 *
 * The character runtime is stubbed to no-ops: the hook drives posture on every
 * turn and none of it is what this case is about.
 */
function MeterFixture() {
  const decke = useMemo(
    () => new Proxy({}, { get: () => () => undefined }) as unknown as DeckEInstance,
    [],
  )
  const chat = useDeckeChat(decke, () => {})
  window.meterChat = { send: text => { void chat.send(text) }, busy: chat.busy }
  return <DeckeChat open minimised={false} onExpand={() => {}} onClose={() => {}} decke={null}
    messages={chat.messages} busy={chat.busy} onSend={chat.send} onStop={chat.stop}
    asking={chat.asking} onApprove={chat.approve} onDeny={chat.deny}
    approvalPreview={chat.approvalPreview} approvalChoices={chat.approvalChoices}
    onApprovalChoice={chat.onApprovalChoice} approvalBusy={chat.approvalBusy}
    onRetryTool={() => {}} desktop={innerWidth >= 1068} characterPx={160}
    credits={{ remaining: 2, allowance: 100 }} onTopUp={() => {}} />
}
createRoot(document.getElementById('root')!).render(<Fixture />)
