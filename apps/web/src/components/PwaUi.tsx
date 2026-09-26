import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { useConnectivity } from '../lib/useConnectivity'
import { applyUpdate, needRefresh as initialNeedRefresh, onNeedRefresh } from '../pwa'

// Chromium fires this before offering an install; we stash it to drive our own
// subtle affordance instead of the browser's default mini-infobar.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari uses a non-standard flag rather than display-mode.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

/** Install button — only when the browser says the app is installable. */
function InstallButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    if (isStandalone()) return
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => setDeferred(null)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (!deferred) return null
  return (
    <button
      onClick={async () => {
        await deferred.prompt()
        await deferred.userChoice
        setDeferred(null)
      }}
      className="pointer-events-auto flex h-[40px] items-center gap-[8px] rounded-full bg-surface-tertiary pl-[14px] pr-[16px] text-[14px] font-semibold text-text-primary shadow-lg ring-1 ring-border-default hover:bg-action-default-hover"
      aria-label="Install DeckPal"
    >
      <Icon name="download" size={16} className="text-action-primary" />
      Install
    </button>
  )
}

/** Update toast — bottom-right, matches UI-SPEC §3.14 sticker treatment. */
function UpdateToast() {
  const [show, setShow] = useState(initialNeedRefresh)
  useEffect(() => onNeedRefresh(() => setShow(true)), [])
  if (!show) return null
  return (
    <div className="pointer-events-auto flex items-center gap-[12px] rounded-lg bg-surface-quaternary py-[10px] pl-[16px] pr-[10px] shadow-2xl ring-1 ring-border-default">
      <Icon name="sparkle" size={16} className="text-action-primary" />
      <span className="text-[14px] font-bold text-text-primary">Update available</span>
      <button
        onClick={applyUpdate}
        className="rounded-md bg-action-primary px-[12px] py-[6px] text-[14px] font-bold text-action-primary-text hover:bg-action-primary-hover"
      >
        Reload
      </button>
      <button
        onClick={() => setShow(false)}
        className="flex h-[28px] w-[28px] items-center justify-center rounded-md text-icon-default hover:bg-action-default-hover"
        aria-label="Dismiss"
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  )
}

/**
 * Offline banner — honest about the tiered offline model (wiki: Frontend-Research §C.5):
 * full metadata browse + collection + art you've already viewed stay available;
 * unvisited card art shows the skeleton, not real art. Collection edits are
 * network-only, so the steppers disable while offline (see CardDetail).
 *
 * `useConnectivity`, not `useOnline` — this makes a claim ("Offline.") that
 * has to be right, not just a hint (see `lib/connectivity.ts`).
 */
function OfflineBanner() {
  const offline = useConnectivity()
  if (!offline) return null
  return (
    <div
      role="status"
      className="pointer-events-auto flex max-w-[520px] items-start gap-[10px] rounded-lg bg-surface-quaternary px-[14px] py-[10px] shadow-2xl ring-1 ring-border-default"
    >
      <span className="mt-[1px] text-action-primary">
        <Icon name="alert" size={18} />
      </span>
      <div className="text-[14px] leading-[17px] text-text-body">
        <span className="font-bold text-text-primary">Offline.</span>{' '}
        Browsing cached data — sets, your collection, and art you&apos;ve already viewed.
        Unvisited card art shows placeholders, and collection edits are paused until
        you&apos;re back online.
      </div>
    </div>
  )
}

/** Single fixed overlay host for all PWA affordances. */
export function PwaUi() {
  // The scan and labeler surfaces put working controls in the bottom-left
  // corner (the labeler's TL/rotate cluster sits exactly under the Install
  // pill — 2026-09-07 readiness pass screenshots). Full-screen working
  // surfaces suppress the pill; it returns everywhere else, and the
  // bottom-right toasts are unaffected.
  const suppressInstall =
    typeof window !== 'undefined' &&
    (window.location.pathname.startsWith('/scan') || window.location.pathname.startsWith('/dev/quad-labeler'))
  // calc(), not the bare 16px both used before a Home-Screen install put a
  // home indicator under them (flagged, unfixed, in
  // roadmap/plans/decke-experience-pass/research/R5-mobile-layout.md) — same
  // idiom as Sheet.tsx's footer padding, so the 16px gap from the edge is
  // preserved and the safe-area inset stacks on top of it rather than
  // replacing it.
  const bottomOffset = 'bottom-[calc(16px_+_env(safe-area-inset-bottom))]'
  return (
    <>
      {/* bottom-left: install */}
      {!suppressInstall && (
        <div className={`pointer-events-none fixed ${bottomOffset} left-[16px] z-(--z-toast) nav:left-[98px]`}>
          <InstallButton />
        </div>
      )}
      {/* bottom-right: offline banner stacked above the update toast */}
      <div className={`pointer-events-none fixed ${bottomOffset} right-[16px] z-(--z-toast) flex flex-col items-end gap-[10px]`}>
        <OfflineBanner />
        <UpdateToast />
      </div>
    </>
  )
}
