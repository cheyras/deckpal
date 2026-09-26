import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './fixture.css'
import { DeckeChat, type ChatMessage } from '../../apps/web/src/character/host/DeckeChat'
import { DeckeScreen } from '../../apps/web/src/character/host/DeckeScreen'
import { useDeckeChat } from '../../apps/web/src/character/host/useDeckeChat'
import type { DeckEInstance } from '../../apps/web/src/character/host/runtime'
import { openerStore, readLastSaid } from '../../apps/web/src/character/host/deckeChatState'
import { SUBHEADS } from '../../apps/web/src/character/host/deckeVoice'
import {
  createRouter,
  createRootRoute,
  createRoute,
  RouterProvider,
  Outlet,
  Link,
} from '@tanstack/react-router'
import { RootErrorBoundary, RouteErrorFallback } from '../../apps/web/src/components/ErrorBoundary'

// Test-only entry: actual components, no host/WebGL/model or production route.
const events = { closes: 0, sends: [] as string[], topUps: 0, retries: [] as string[] }
type FixtureState = { open: boolean; busy: boolean; messages: ChatMessage[]; credits: { remaining: number; allowance: number } }
declare global {
  interface Window {
    fixture: { events: typeof events; set: (patch: Partial<FixtureState>) => void; expectedSubhead: () => string | undefined }
    /** `?meter` only — the real hook's own send, so the test drives real fetches. */
    meterChat: { send: (text: string) => void; busy: boolean }
    /** `?errorboundary` only — see `ErrorBoundaryFixture` below. */
    errorBoundaryFixture: { disarmCrash: () => void; disarmLoaderCrash: () => void; crashOutsideRouter: () => void }
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
  if (location.search.includes('errorboundary')) return <ErrorBoundaryFixture />
  return <DeckeChat {...state} minimised={false} onExpand={() => {}}
    onClose={() => { events.closes++ }} decke={null}
    onSend={text => events.sends.push(text)} onStop={() => setState(s => ({ ...s, busy: false }))}
    asking={null} onApprove={() => {}} onDeny={() => {}} approvalPreview={() => null}
    approvalChoices={new Map()} onApprovalChoice={() => {}} approvalBusy={false}
    onRetryTool={id => events.retries.push(id)} desktop={innerWidth >= 1068} characterPx={160}
    onTopUp={() => { events.topUps++ }} />
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
/**
 * ── QUAL-01's error boundaries, driven end to end ────────────────────────────
 *
 * A minimal, REAL `@tanstack/react-router` tree — not a stand-in — wired
 * exactly like `apps/web/src/main.tsx`: `defaultErrorComponent:
 * RouteErrorFallback` on `createRouter()`, and the whole thing wrapped in
 * `RootErrorBoundary`. `ShellStub` plays the part of `AppShell`: a header
 * that lives OUTSIDE the routed `<Outlet/>`, so the test can tell "one
 * route's boundary caught this" (header still there) apart from "the root
 * boundary caught this" (header gone too, because it replaced everything
 * `RootErrorBoundary` wraps).
 *
 * `crashArmed` is module state, not component state, on purpose: `reset()`
 * (TanStack's own, from `defaultErrorComponent`'s `{ reset }` prop) remounts
 * `CrashRoute` but does not touch anything outside React — exactly like a
 * real bug that was actually fixed and then retried, as opposed to one
 * masked by resetting state that caused it.
 */
let crashArmed = true
// A SEPARATE flag from `crashArmed`: a `beforeLoad` failure lives in the
// ROUTER's match store, not in React state, which is exactly the distinction
// Astra review (PR #209) caught `RouteErrorFallback`'s Retry getting wrong —
// `reset()` alone reads the same stale `match.status === 'error'` and
// rethrows immediately. See the fixed `retry()` in ErrorBoundary.tsx.
let loaderCrashArmed = true

function CrashRoute() {
  if (crashArmed) throw new Error('Fixture: deliberate render-time throw')
  return <p>Recovered — this route renders fine now.</p>
}

function RootCrash(): never {
  throw new Error('Fixture: deliberate throw outside the router')
}

function ShellStub() {
  return <div>
    <header role="banner">Fixture shell header</header>
    <nav aria-label="Fixture rail">Fixture rail</nav>
    <Link to="/crash">Go to crash route</Link>
    <Link to="/loader-crash">Go to loader-crash route</Link>
    <Outlet />
  </div>
}

const errorBoundaryRootRoute = createRootRoute({ component: ShellStub })
const errorBoundaryHomeRoute = createRoute({
  getParentRoute: () => errorBoundaryRootRoute,
  path: '/',
  component: () => <p>Home route content</p>,
})
const errorBoundaryCrashRoute = createRoute({
  getParentRoute: () => errorBoundaryRootRoute,
  path: '/crash',
  component: CrashRoute,
})
const errorBoundaryLoaderCrashRoute = createRoute({
  getParentRoute: () => errorBoundaryRootRoute,
  path: '/loader-crash',
  beforeLoad: () => {
    if (loaderCrashArmed) throw new Error('Fixture: deliberate beforeLoad throw')
  },
  component: () => <p>Loader recovered — this route renders fine now.</p>,
})
const errorBoundaryRouter = createRouter({
  routeTree: errorBoundaryRootRoute.addChildren([
    errorBoundaryHomeRoute,
    errorBoundaryCrashRoute,
    errorBoundaryLoaderCrashRoute,
  ]),
  defaultErrorComponent: RouteErrorFallback,
})
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof errorBoundaryRouter
  }
}

function ErrorBoundaryFixture() {
  const [outsideRouter, setOutsideRouter] = useState(false)
  window.errorBoundaryFixture = {
    disarmCrash: () => { crashArmed = false },
    disarmLoaderCrash: () => { loaderCrashArmed = false },
    crashOutsideRouter: () => setOutsideRouter(true),
  }
  return <RootErrorBoundary>
    {outsideRouter ? <RootCrash /> : <RouterProvider router={errorBoundaryRouter} />}
  </RootErrorBoundary>
}

createRoot(document.getElementById('root')!).render(<Fixture />)
