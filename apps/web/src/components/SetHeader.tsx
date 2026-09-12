import { useState, useEffect, useRef } from 'react'
import { Link } from '@tanstack/react-router'
import type { SetDetailResponse } from '../lib/api'
import type { Goal } from '../routes/setSearch'
import { api } from '../lib/api'
import { fmtDate, fmtUsd } from '../lib/format'
import { SetSymbolTile, StatTile } from './ui'
import { SetLogo } from './SetLogo'
import { ProgressCluster } from './ProgressCluster'
import { Icon } from './Icon'
import { PurchaseSetMenu } from './PurchaseSetMenu'
import { SignInPrompt } from './SignInPrompt'
import { useSignedIn } from '../lib/session'


export function SetHeader({ data, goal }: { data: SetDetailResponse; goal: Goal }) {
  const { set, progress } = data
  // `progress` is absent for a logged-out visitor. Two of the three header
  // actions are per-user too: Purchase Set builds a cart of the cards you still
  // NEED, and Print Checklist is a gated export. Shop is a plain TCGplayer
  // search and stays for everyone.
  const signedOut = useSignedIn() === false

  // Logo error state: renders set name as plain text so adversarial markup in
  // set.name cannot be injected as HTML (replaces the former outerHTML= sink).
  const [logoError, setLogoError] = useState(false)

  // Reset logo error when navigating between sets (different setId or logo URL),
  // so a failed logo for set A does not prevent rendering set B's valid logo.
  useEffect(() => {
    setLogoError(false)
  }, [set.setId, set.images.logoUrl])

  // Mobile Actions dropdown state
  const [actionsOpen, setActionsOpen] = useState(false)
  const actionsRef = useRef<HTMLDivElement>(null)
  const actionsTriggerRef = useRef<HTMLButtonElement>(null)

  // Controlled Purchase Set modal — triggered from both desktop button and
  // mobile dropdown without duplicating modal logic (PurchaseSetMenu seam).
  const [purchaseOpen, setPurchaseOpen] = useState(false)

  useEffect(() => {
    if (!actionsOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setActionsOpen(false)
        // Escape: restore focus to the trigger so the user is back where they
        // started (standard disclosure pattern).
        actionsTriggerRef.current?.focus()
      }
    }
    const onPointer = (e: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setActionsOpen(false)
        actionsTriggerRef.current?.focus()
      }
    }
    // Focus-exit dismissal: close when focus leaves the dropdown container via
    // Tab.  Unlike Escape, Tab-exiting should NOT force focus back to the
    // trigger — the user is intentionally moving forward through the tab order,
    // and snapping focus backward would trap them in a loop.
    const onFocusOut = (e: FocusEvent) => {
      if (actionsRef.current && e.relatedTarget instanceof Node && !actionsRef.current.contains(e.relatedTarget)) {
        setActionsOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    actionsRef.current?.addEventListener('focusout', onFocusOut)
    const ref = actionsRef.current
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
      ref?.removeEventListener('focusout', onFocusOut)
    }
  }, [actionsOpen])

  // Shop: no canonical per-set product URL is derivable from our catalog, so it
  // opens a TCGplayer Pokémon search for the set name — a reliable landing page
  // for singles and sealed product alike. Purchase Set is different: it builds a
  // Mass Entry cart deep link for the cards still needed (PurchaseSetMenu).
  const tcgSearchUrl = `https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q=${encodeURIComponent(
    set.name,
  )}`

  const shopLink = (menuItem?: boolean) => (
    <a
      href={tcgSearchUrl}
      target="_blank"
      rel="noreferrer"
      className={
        menuItem
          ? 'flex h-[40px] w-full items-center gap-[8px] rounded-lg px-[12px] text-[14px] font-bold text-text-primary hover:bg-action-default-hover'
          : 'flex h-[40px] items-center gap-[8px] rounded-lg bg-surface-tertiary px-[14px] text-[14px] font-bold text-text-primary hover:bg-action-default-hover'
      }
    >
      <Icon name="external" size={16} className="text-action-brand" /> Shop
    </a>
  )

  const checklistLink = (menuItem?: boolean) => (
    <a
      href={api.setChecklistPdfUrl(set.setId)}
      target="_blank"
      rel="noreferrer"
      className={
        menuItem
          ? 'flex h-[40px] w-full items-center gap-[8px] rounded-lg px-[12px] text-[14px] font-bold text-text-primary hover:bg-action-default-hover'
          : 'flex h-[40px] items-center gap-[8px] rounded-lg bg-surface-tertiary px-[14px] text-[14px] font-bold text-text-primary hover:bg-action-default-hover'
      }
    >
      <Icon name="printer" size={16} className="text-action-brand" /> Print Checklist
    </a>
  )

  // No art/gradient wash behind this block. It used to carry one (UI-SPEC §3.7);
  // it now sits on the same surface as the rest of the page, so the header reads
  // as part of the page rather than as a banner pasted onto it.
  return (
    <div>
      <div className="flex flex-col gap-[20px] pb-[8px] pt-[4px]">
        {/* Row 1 — set identity on the left, actions pushed to the right. */}
        <div className="flex flex-wrap items-center gap-x-[24px] gap-y-[16px]">
          <div className="flex h-[132px] min-w-[135px] items-center">
            {/* logoError: display set name as plain text (React-rendered, not
                innerHTML) to prevent XSS from a crafted set name. */}
            {set.images.logoUrl && !logoError ? (
              <SetLogo
                setId={set.setId}
                alt={set.name}
                imgClassName="max-h-[132px] max-w-[290px]"
                platedImgClassName="max-h-[114px] max-w-[290px]"
                plateClassName="rounded-lg px-[16px] py-[12px]"
                onError={() => setLogoError(true)}
              />
            ) : (
              <span className="font-display text-[38px] font-black text-text-primary">{set.name}</span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-[10px]">
            <SetSymbolTile setId={set.setId} name={set.name} size={40} />

            {/* Desktop inline actions — hidden on mobile, shown at gap+ */}
            <div className="hidden items-center gap-[10px] gap:flex">
              {shopLink()}
              {!signedOut && (
                <>
                  <button
                    onClick={() => setPurchaseOpen(true)}
                    className="flex h-[40px] items-center gap-[8px] rounded-lg bg-surface-tertiary px-[14px] text-[14px] font-bold text-text-primary hover:bg-action-default-hover"
                  >
                    <Icon name="cart" size={16} className="text-action-brand" /> Purchase Set
                  </button>
                  {checklistLink()}
                </>
              )}
            </div>

            {/* Mobile Actions disclosure — shown on mobile, hidden at gap+ (issue #154).
                Uses a plain disclosure (button + panel) with Escape/outside/focus-exit
                dismissal, not ARIA menu roles — menu roles require arrow-key roving
                which is overkill for 2-3 ordinary buttons/links. */}
            <div className="relative gap:hidden" ref={actionsRef}>
              <button
                ref={actionsTriggerRef}
                onClick={() => setActionsOpen((o) => !o)}
                aria-expanded={actionsOpen}
                aria-controls="set-actions-panel"
                className="flex h-[40px] items-center gap-[8px] rounded-lg bg-surface-tertiary px-[14px] text-[14px] font-bold text-text-primary hover:bg-action-default-hover"
              >
                <Icon name="menu" size={16} className="text-action-brand" />
                Actions
                <Icon name="chevron-down" size={14} className={actionsOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
              {actionsOpen && (
                <div
                  id="set-actions-panel"
                  aria-label="Set actions"
                  className="absolute right-0 top-[44px] z-10 min-w-[180px] rounded-lg border border-border-default bg-surface-primary p-[4px] shadow-lg"
                >
                  {shopLink(true)}
                  {!signedOut && (
                    <>
                      <button
                        onClick={() => {
                          setActionsOpen(false)
                          setPurchaseOpen(true)
                        }}
                        className="flex h-[40px] w-full items-center gap-[8px] rounded-lg px-[12px] text-[14px] font-bold text-text-primary hover:bg-action-default-hover"
                      >
                        <Icon name="cart" size={16} className="text-action-brand" /> Purchase Set
                      </button>
                      {checklistLink(true)}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* PurchaseSetMenu modal — always rendered in controlled mode so the
                modal is not unmounted when the dropdown closes (issue #154). */}
            {!signedOut && (
              <PurchaseSetMenu
                setId={set.setId}
                pageGoal={goal}
                controlledOpen={purchaseOpen}
                onControlledClose={() => setPurchaseOpen(false)}
              />
            )}
          </div>
        </div>

        {/* Row 2 — the collection/level progress gets the full width to itself. */}
        <div className="w-full">
          {progress ? (
            // Deck-E's landmark for "how far through this set am I". It sits on
            // a wrapper INSIDE the `progress` branch rather than on the row
            // above it, because the other branch of this ternary is a sign-in
            // prompt: marking the row would give him a landmark labelled "the
            // completion bar" that, signed out, rings an advert.
            <div
              data-decke-completion-bar
              data-decke-landmark="[data-decke-completion-bar]"
              data-decke-label="the completion bar for this set"
            >
              <ProgressCluster progress={progress} goal={goal} />
            </div>
          ) : (
            <SignInPrompt
              title="Track this set"
              detail={`Mark which of these ${set.cardCountTotal.toLocaleString()} cards you own.`}
            />
          )}
        </div>

        {/* 6-column stat strip (UI-SPEC §3.7) */}
        <div className="grid grid-cols-2 gap-[16px] sm:grid-cols-3 nav:grid-cols-6">
          <StatTile label="Set Name" value={set.name} />
          <div className="min-w-0">
            <div className="text-[14px] leading-[23px] text-text-muted">Series</div>
            <Link
              to="/series/$series"
              params={{ series: set.series.slug }}
              className="truncate text-[14px] leading-[23px] text-link hover:text-link-hover"
            >
              {set.series.name}
            </Link>
          </div>
          <StatTile label="Release Date" value={fmtDate(set.releasedOn)} />
          <StatTile
            label="Cards"
            value={set.secretCount > 0 ? `${set.printedCount} + ${set.secretCount} Secret` : `${set.printedCount}`}
          />
          <StatTile label="Most Expensive Card" value={set.mostExpensiveCard?.name ?? '—'} />
          <StatTile label="Full Set Market Value" value={fmtUsd(set.marketValueUsd)} money />
        </div>
      </div>
    </div>
  )
}
