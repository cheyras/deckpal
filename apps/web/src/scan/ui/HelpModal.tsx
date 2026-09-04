// The description that used to sit under the page title (a full paragraph,
// permanently on screen) moved here — expanded, since it no longer has to
// fit in a single-viewport app screen that must never scroll at the page
// level. Reuses `Sheet`, the app's one overlay primitive, for the portal,
// scroll-lock, focus trap and Escape handling every other modal in the app
// already gets for free.
import { Sheet } from '../../components/ui/Sheet'
import { Icon } from '../../components/Icon'

export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="How scanning works" onClose={onClose} size="sm">
      <div className="flex flex-col gap-[16px] text-[14px] leading-[21px] text-text-body">
        <p>
          Point the camera at a card and hold it inside the frame — you don't need to line it up exactly. The moment a
          card sits steady, it captures itself: no shutter button, and no way to double-capture the same card by
          accident.
        </p>

        <section className="flex flex-col gap-[6px]">
          <h3 className="text-[13px] font-bold uppercase tracking-wide text-text-muted">1. Scan</h3>
          <p>
            Keep presenting cards — each capture flies into the stack at the edge of the camera while it's identified,
            then drops into the list below. A card you've already scanned bumps its quantity instead of adding a
            duplicate row. Not sure the match is right? Tap <b className="text-text-primary">wrong card?</b> on any
            row to pick from the next-closest guesses, or flag it for review with the{' '}
            <Icon name="bug" size={13} className="inline-block align-[-2px]" /> report button. You can also expand the
            list to full screen at any time to look it over without stopping the camera.
          </p>
        </section>

        <section className="flex flex-col gap-[6px]">
          <h3 className="text-[13px] font-bold uppercase tracking-wide text-text-muted">2. Verify</h3>
          <p>
            When you're done, tap <b className="text-text-primary">Verify</b>. The camera stops completely and the
            list takes over the screen so you can review everything before it touches your collection — quantities,
            printings, anything worth a second look.
          </p>
          <p>
            Prefer going one card at a time? Switch to{' '}
            <b className="text-text-primary">swipe review</b>: swipe right (or press{' '}
            <kbd className="rounded bg-surface-tertiary px-[5px] py-[1px] font-mono text-[12px]">→</kbd>) to confirm a
            card, or left (<kbd className="rounded bg-surface-tertiary px-[5px] py-[1px] font-mono text-[12px]">←</kbd>
            ) if it's wrong — that opens the same correction picker rather than just deleting it. Each card shows what
            you already own of that printing and what it'll become once you commit.
          </p>
        </section>

        <p className="text-text-muted">
          Nothing joins your collection until you tap <b className="text-text-primary">Add to collection</b> on the
          Verify screen — scanning and reviewing never write anything by themselves.
        </p>
      </div>
    </Sheet>
  )
}
