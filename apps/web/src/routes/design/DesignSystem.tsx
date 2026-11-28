/**
 * Design-system editor — the /design route component.
 *
 * In dev this is the full editor (token saves + agent lane via the Vite
 * dev-server plugin). In production it ships as an OWNER-ONLY read-only
 * reference: main.tsx's beforeLoad gate checks the server-verified
 * `designEditor` flag on /me and renders the router's not-found page for
 * anyone else. The /__design endpoints never exist in production, so
 * `health` stays null there and everything write-shaped hides itself.
 */
import { useState, useEffect, useRef } from 'react'
import { SkinToggle } from './SkinToggle'
import { FoundationsPanel } from './FoundationsPanel'
import { useScrollEdge } from '../../lib/useScrollEdge'
import { TopbarToggle } from './TopbarToggle'
import { createPortal } from 'react-dom'
import { designApi, type HealthResponse } from './designApi'
import { useTokenOverrides } from './useTokenOverrides'
import { TokenPanel } from './TokenPanel'
import { CatalogSection } from './CatalogSection'
import { RequestsPanel } from './RequestsPanel'
import { PENDING_ITEMS, completionStats } from './pending'

type TabId = 'tokens' | 'primitives' | 'components' | 'requests' | 'pending'

// Base-aware app links: BASE_URL is '/' on cloud and '/deckpal/' self-host.
const appHref = (path: string) => `${import.meta.env.BASE_URL}${path}`

export default function DesignSystem() {
  const [activeTab, setActiveTab] = useState<TabId>('tokens')
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const overrides = useTokenOverrides()
  // Edit capability exists exactly when the dev-server endpoints answer.
  const editable = health?.ok === true

  useEffect(() => {
    designApi.health().then(setHealth).catch(() => {})
  }, [])

  const stats = completionStats()

  const tabs: { id: TabId; label: string; badge?: string }[] = [
    { id: 'tokens', label: 'Tokens' },
    { id: 'primitives', label: 'Primitives' },
    { id: 'components', label: 'Components' },
    { id: 'requests', label: 'Requests' },
    { id: 'pending', label: 'Pending', badge: `${stats.done}/${stats.total}` },
  ]

  return (
    <>
      <div className="min-h-screen bg-surface-primary">
        {/* Header */}
        {/* Header. On a phone it is two rows — the title with "Back to app"
            across from it, then the toggles — instead of one row squeezing all
            five things into a column beside the title. From `md:` up it is one
            row again, with "Back to app" at the end. */}
        <header className="sticky top-0 z-20 border-b border-border-default bg-surface-primary/95 backdrop-blur-sm">
          <div className="mx-auto max-w-[1200px] px-4 pt-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
              <div className="order-1 min-w-0 flex-1">
                <h1 className="text-[18px] font-bold text-text-primary">Design System</h1>
                {health ? (
                  <p className="mt-0.5 truncate font-mono text-[11px] text-text-muted">
                    {health.branch} @ {health.worktree.split('/').slice(-2).join('/')}
                  </p>
                ) : (
                  <p className="mt-0.5 text-[11px] text-text-muted">Read-only — saves need the local dev server</p>
                )}
              </div>
              <a
                href={appHref('series')}
                className="order-2 flex h-8 shrink-0 items-center rounded-full border border-border-default px-3 text-[12px] font-medium text-text-secondary hover:text-text-primary md:order-4"
              >
                Back to app
              </a>
              <div className="order-3 flex w-full flex-wrap items-center gap-2 md:w-auto">
                <TopbarToggle />
                <SkinToggle />
                {overrides.count > 0 && (
                  <span className="rounded-full bg-action-primary/20 px-2.5 py-0.5 text-[11px] font-medium text-action-primary">
                    {overrides.count} override{overrides.count !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>

            {/* Tab nav. Five tabs do not fit across a phone at a readable size,
                so the row scrolls sideways — with the scroll edge fading
                whichever side has more, so a tab is never sliced mid-word
                ("Pendin") with nothing to say there is more. The active tab is
                scrolled into view when it changes. */}
            <TabStrip tabs={tabs} active={activeTab} onChange={setActiveTab} />
          </div>
        </header>

        {/* Content */}
        <main className="mx-auto max-w-[1200px] px-4 py-5">
          {activeTab === 'tokens' && (
            <>
              <FoundationsPanel />
              <TokenPanel overrides={overrides} editable={editable} />
            </>
          )}
          {activeTab === 'primitives' && <CatalogSection section="primitive" title="Primitives" editable={editable} />}
          {activeTab === 'components' && <CatalogSection section="component" title="Components" editable={editable} />}
          {activeTab === 'requests' && <RequestsPanel editable={editable} />}
          {activeTab === 'pending' && <PendingSection />}
        </main>
      </div>

      {/* Preview pill — shown outside /design when overrides are active */}
      {overrides.count > 0 && <PreviewPill overrides={overrides} />}
    </>
  )
}

// ── Tab strip ───────────────────────────────────────────────────────────

function TabStrip({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: TabId; label: string; badge?: string }[]
  active: TabId
  onChange: (id: TabId) => void
}) {
  const edge = useScrollEdge({ axis: 'x' })
  const activeRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])
  return (
    <nav
      ref={edge}
      aria-label="Design system sections"
      // Bleeds to the screen edge on a phone (-mx-4 against the header's px-4)
      // so a tab scrolls out under the edge fade rather than stopping short of
      // it, and pads back in so the first and last tabs rest where the title
      // does. `scroll-px-4` makes scrollIntoView honour that padding.
      className="scroll-edge-x -mx-4 mt-2 flex scroll-px-4 gap-0.5 overflow-x-auto px-4 [scrollbar-width:none] sm:gap-1 [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          ref={active === tab.id ? activeRef : undefined}
          onClick={() => onChange(tab.id)}
          aria-current={active === tab.id ? 'page' : undefined}
          // On a phone the five tabs SHARE the row (`flex-1`, tighter padding,
          // 12px) so all of them fit at 390px with nothing to scroll; from
          // `sm:` up they size to their labels. The badge repeats the meter
          // inside the Pending tab, so it is the thing that goes on a phone.
          className={`min-w-fit flex-1 whitespace-nowrap rounded-t-lg border-b-2 px-1.5 py-2 text-[12px] font-medium transition-colors sm:flex-none sm:px-3.5 sm:text-[13px] ${
            active === tab.id
              ? 'border-action-primary bg-surface-secondary text-text-primary'
              : 'border-transparent text-text-muted hover:bg-surface-secondary/50 hover:text-text-primary'
          }`}
        >
          {tab.label}
          {tab.badge && <span className="ml-1.5 hidden text-[10px] text-text-muted sm:inline">{tab.badge}</span>}
        </button>
      ))}
    </nav>
  )
}

// ── Preview pill ────────────────────────────────────────────────────────

function PreviewPill({ overrides }: { overrides: ReturnType<typeof useTokenOverrides> }) {
  return createPortal(
    <div className="fixed bottom-[16px] left-1/2 -translate-x-1/2 z-(--z-toast) flex items-center gap-3 rounded-full bg-surface-tertiary/95 backdrop-blur-sm border border-action-primary/30 px-4 py-2 shadow-elevated">
      <span className="text-[12px] font-medium text-action-primary">
        Design preview active
      </span>
      <span className="text-[11px] text-text-muted">
        {overrides.count} override{overrides.count !== 1 ? 's' : ''}
      </span>
      <button
        onClick={overrides.resetAll}
        className="text-[11px] text-text-muted hover:text-text-primary"
      >
        Reset
      </button>
      <a
        href={appHref('design')}
        className="text-[11px] text-action-primary hover:text-action-primary-hover"
      >
        Back to /design
      </a>
    </div>,
    document.body,
  )
}

// ── Pending section ─────────────────────────────────────────────────────

function PendingSection() {
  const stats = completionStats()
  const extractions = PENDING_ITEMS.filter((i) => i.kind === 'extraction' || i.kind === 'adoption')
  const offTheme = PENDING_ITEMS.filter((i) => i.kind === 'off-theme')

  return (
    <div className="space-y-5">
      {/* Completeness meter */}
      <div className="rounded-lg bg-surface-secondary p-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <h3 className="text-[14px] font-semibold text-text-primary">Componentization progress</h3>
          <span className="text-[13px] text-text-muted">
            {stats.done} of {stats.total} patterns componentized ({stats.pct}%)
          </span>
        </div>
        <div className="h-[6px] rounded-full bg-surface-quaternary overflow-hidden">
          <div
            className="h-full rounded-full bg-action-primary transition-all"
            style={{ width: `${stats.pct}%` }}
          />
        </div>
      </div>

      {/* Extractions backlog */}
      <div className="space-y-2">
        <h3 className="text-[14px] font-semibold text-text-primary">Extraction backlog (Phase 2)</h3>
        {extractions.length === 0 && (
          <p className="text-[12px] text-text-muted">
            Backlog clear — every planned extraction and adoption (C1–C13) has landed.
          </p>
        )}
        {extractions.map((item) => (
          <div key={item.id} className="rounded-lg bg-surface-secondary px-4 py-3">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded bg-surface-quaternary px-1.5 py-px text-[10px] font-mono text-text-muted">
                    {item.id}
                  </span>
                  <span className="text-[13px] font-medium text-text-primary">{item.label}</span>
                  <span className={`rounded-full px-1.5 py-px text-[9px] font-medium ${
                    item.kind === 'extraction'
                      ? 'bg-action-primary/15 text-action-primary'
                      : 'bg-link/15 text-link'
                  }`}>
                    {item.kind}
                  </span>
                </div>
                <p className="text-[12px] text-text-muted mt-1">{item.description}</p>
              </div>
              <span className="text-[10px] text-text-muted font-mono whitespace-nowrap ml-3">
                {item.auditRef}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Off-theme values */}
      <div className="space-y-2">
        <h3 className="text-[14px] font-semibold text-text-primary">Known off-theme values</h3>
        <p className="text-[12px] text-text-muted">
          Colors and values that live outside theme.css. After Phase 2 promotes them,
          they appear in the token panel automatically.
        </p>
        {offTheme.map((item) => (
          <div key={item.id} className="rounded-lg bg-surface-secondary px-4 py-2.5">
            <div className="flex items-start gap-2">
              {/* Color swatch for hex values */}
              {item.label.startsWith('#') && (
                <div
                  className="mt-0.5 h-[14px] w-[14px] rounded border border-border-default flex-shrink-0"
                  style={{ backgroundColor: item.label.match(/#[0-9a-f]+/)?.[0] }}
                />
              )}
              <div className="min-w-0">
                <span className="text-[13px] font-medium text-text-primary">{item.label}</span>
                <p className="text-[12px] leading-[18px] text-text-muted mt-0.5 [overflow-wrap:anywhere]">{item.description}</p>
                {item.steps && (
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12px] leading-[18px] text-text-body">
                    {item.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
