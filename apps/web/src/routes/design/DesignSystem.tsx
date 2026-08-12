/**
 * Design-system editor — the /design route component.
 *
 * DEV-only. Renders the token panel, primitive/component catalog,
 * and the pending-extraction list. The route is dead-code-eliminated
 * from production builds by Vite's static replacement of import.meta.env.DEV.
 */
import { useState, useEffect } from 'react'
import { SkinToggle } from './SkinToggle'
import { createPortal } from 'react-dom'
import { designApi, type HealthResponse } from './designApi'
import { useTokenOverrides } from './useTokenOverrides'
import { TokenPanel } from './TokenPanel'
import { CatalogSection } from './CatalogSection'
import { RequestsPanel } from './RequestsPanel'
import { PENDING_ITEMS, completionStats } from './pending'

type TabId = 'tokens' | 'primitives' | 'components' | 'requests' | 'pending'

export default function DesignSystem() {
  const [activeTab, setActiveTab] = useState<TabId>('tokens')
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const overrides = useTokenOverrides()

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
        <header className="sticky top-0 z-20 border-b border-border-default bg-surface-primary/95 backdrop-blur-sm">
          <div className="mx-auto max-w-[1200px] px-[16px] py-[12px]">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-[18px] font-bold text-text-primary">Design System</h1>
                {health && (
                  <p className="text-[11px] text-text-muted font-mono mt-[2px]">
                    {health.branch} @ {health.worktree.split('/').slice(-2).join('/')}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-[12px]">
                <SkinToggle />
                {overrides.count > 0 && (
                  <span className="rounded-full bg-action-primary/20 px-[10px] py-[3px] text-[11px] font-medium text-action-primary">
                    {overrides.count} override{overrides.count !== 1 ? 's' : ''}
                  </span>
                )}
                <a
                  href="/deckscout/series"
                  className="text-[12px] text-text-muted hover:text-text-primary"
                >
                  Back to app
                </a>
              </div>
            </div>

            {/* Tab nav */}
            <nav className="flex gap-[4px] mt-[12px] -mb-[12px]">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-[14px] py-[8px] text-[13px] font-medium rounded-t-lg border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? 'border-action-primary text-text-primary bg-surface-secondary'
                      : 'border-transparent text-text-muted hover:text-text-primary hover:bg-surface-secondary/50'
                  }`}
                >
                  {tab.label}
                  {tab.badge && (
                    <span className="ml-[6px] text-[10px] text-text-muted">{tab.badge}</span>
                  )}
                </button>
              ))}
            </nav>
          </div>
        </header>

        {/* Content */}
        <main className="mx-auto max-w-[1200px] px-[16px] py-[20px]">
          {activeTab === 'tokens' && <TokenPanel overrides={overrides} />}
          {activeTab === 'primitives' && <CatalogSection section="primitive" title="Primitives" />}
          {activeTab === 'components' && <CatalogSection section="component" title="Components" />}
          {activeTab === 'requests' && <RequestsPanel />}
          {activeTab === 'pending' && <PendingSection />}
        </main>
      </div>

      {/* Preview pill — shown outside /design when overrides are active */}
      {overrides.count > 0 && <PreviewPill overrides={overrides} />}
    </>
  )
}

// ── Preview pill ────────────────────────────────────────────────────────

function PreviewPill({ overrides }: { overrides: ReturnType<typeof useTokenOverrides> }) {
  return createPortal(
    <div className="fixed bottom-[16px] left-1/2 -translate-x-1/2 z-(--z-toast) flex items-center gap-[12px] rounded-full bg-surface-tertiary/95 backdrop-blur-sm border border-action-primary/30 px-[16px] py-[8px] shadow-elevated">
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
        href="/deckscout/design"
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
    <div className="space-y-[20px]">
      {/* Completeness meter */}
      <div className="rounded-lg bg-surface-secondary p-[16px]">
        <div className="flex items-center justify-between mb-[8px]">
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
      <div className="space-y-[8px]">
        <h3 className="text-[14px] font-semibold text-text-primary">Extraction backlog (Phase 2)</h3>
        {extractions.map((item) => (
          <div key={item.id} className="rounded-lg bg-surface-secondary px-[16px] py-[12px]">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-[8px]">
                  <span className="rounded bg-surface-quaternary px-[6px] py-[1px] text-[10px] font-mono text-text-muted">
                    {item.id}
                  </span>
                  <span className="text-[13px] font-medium text-text-primary">{item.label}</span>
                  <span className={`rounded-full px-[6px] py-[1px] text-[9px] font-medium ${
                    item.kind === 'extraction'
                      ? 'bg-action-primary/15 text-action-primary'
                      : 'bg-link/15 text-link'
                  }`}>
                    {item.kind}
                  </span>
                </div>
                <p className="text-[12px] text-text-muted mt-[4px]">{item.description}</p>
              </div>
              <span className="text-[10px] text-text-muted font-mono whitespace-nowrap ml-[12px]">
                {item.auditRef}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Off-theme values */}
      <div className="space-y-[8px]">
        <h3 className="text-[14px] font-semibold text-text-primary">Known off-theme values</h3>
        <p className="text-[12px] text-text-muted">
          Colors and values that live outside theme.css. After Phase 2 promotes them,
          they appear in the token panel automatically.
        </p>
        {offTheme.map((item) => (
          <div key={item.id} className="rounded-lg bg-surface-secondary px-[16px] py-[10px]">
            <div className="flex items-start gap-[8px]">
              {/* Color swatch for hex values */}
              {item.label.startsWith('#') && (
                <div
                  className="mt-[3px] h-[14px] w-[14px] rounded border border-border-default flex-shrink-0"
                  style={{ backgroundColor: item.label.match(/#[0-9a-f]+/)?.[0] }}
                />
              )}
              <div>
                <span className="text-[13px] font-medium text-text-primary">{item.label}</span>
                <p className="text-[11px] text-text-muted mt-[2px]">{item.description}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
