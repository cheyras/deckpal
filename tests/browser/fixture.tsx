import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './fixture.css'
import { DeckeChat, type ChatMessage } from '../../apps/web/src/character/host/DeckeChat'
import { DeckeScreen } from '../../apps/web/src/character/host/DeckeScreen'
import { useDeckeChat } from '../../apps/web/src/character/host/useDeckeChat'
import type { DeckEInstance } from '../../apps/web/src/character/host/runtime'
import { openerStore, readLastSaid } from '../../apps/web/src/character/host/deckeChatState'
import { SUBHEADS } from '../../apps/web/src/character/host/deckeVoice'
import type { PendingApproval } from '../../apps/web/src/character/host/approval'
import type { ApprovalPreview } from '../../apps/web/src/character/host/chat/approvalCardState'
import type { DeepQuote } from '../../apps/web/src/character/host/chat/deepRequest'

// Test-only entry: actual components, no host/WebGL/model or production route.
const events = { closes: 0, sends: [] as string[], topUps: 0, retries: [] as string[], approves: 0, denies: 0 }
type FixtureState = { open: boolean; busy: boolean; messages: ChatMessage[]; credits: { remaining: number; allowance: number }
  /** A held call and its dry run, for the approval card's geometry and rows. */
  asking: PendingApproval[] | null; preview: ApprovalPreview | null; quote: DeepQuote | null }
declare global {
  interface Window {
    fixture: { events: typeof events; set: (patch: Partial<FixtureState>) => void; expectedSubhead: () => string | undefined }
    /** `?meter` only — the real hook's own send, so the test drives real fetches. */
    meterChat: { send: (text: string) => void; busy: boolean }
  }
}
function Fixture() {
  const [state, setState] = useState<FixtureState>({ open: true, busy: false, messages: [],
    credits: { remaining: 2, allowance: 100 }, asking: null, preview: null, quote: null })
  window.fixture = { events, set: patch => setState(s => ({ ...s, ...patch })),
    expectedSubhead: () => SUBHEADS.find(s => s.id === readLastSaid(openerStore()).subheadId)?.text }
  if (location.search.includes('screen')) return <main style={{ maxWidth: 700, padding: 24 }}>
    <DeckeScreen spec={{ title: 'Browser screen', blocks: Array.from({ length: 6 }, (_, i) =>
      ({ kind: 'text', text: 'Section ' + (i + 1) })) }} />
  </main>
  if (location.search.includes('meter')) return <MeterFixture />
  const { preview, ...props } = state
  return <DeckeChat {...props} minimised={false} onExpand={() => {}}
    onClose={() => { events.closes++ }} decke={null}
    onSend={text => events.sends.push(text)} onStop={() => setState(s => ({ ...s, busy: false }))}
    onApprove={() => { events.approves++ }} onDeny={() => { events.denies++ }}
    approvalPreview={id => preview?.toolCallId === id ? preview : null}
    approvalChoices={new Map()} onApprovalChoice={() => {}} approvalBusy={false}
    onRetryTool={id => events.retries.push(id)} desktop={innerWidth >= 1068} characterPx={fixtureCharacterPx()}
    onTopUp={() => { events.topUps++ }} />
}

/**
 * His height as the host would set it with the chat open: the viewport ceiling
 * on a phone (`characterHeightBeside`'s `w * 0.28`, which a composer never
 * undercuts there), and the desktop composer's ruling above it. The park box is
 * sized from this, so a clearance measured against any other number is a
 * clearance for a character who is not there.
 */
function fixtureCharacterPx() {
  return innerWidth >= 1068 ? 160 : Math.round(Math.min(innerWidth * 0.28, innerHeight * 0.24))
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
    onRetryTool={chat.retry} desktop={innerWidth >= 1068} characterPx={160}
    credits={{ remaining: 2, allowance: 100 }} onTopUp={() => { events.topUps++ }} />
}
createRoot(document.getElementById('root')!).render(<Fixture />)
