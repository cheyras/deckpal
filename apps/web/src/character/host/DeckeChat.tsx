/**
 * The chat overlay.
 *
 * HE IS NOT DRAWN INTO THIS PANEL. He flies to it.
 *
 * The obvious design — render the character a second time inside the panel —
 * cannot work here, and it took an adversarial review to see why. The off-screen
 * beacon looks like the precedent for it, but it works the other way round:
 * `DeckeBeacon.tsx` says outright that it "IS A HOLE, NOT A PICTURE" — the chip
 * draws a ring with nothing in the middle at z-25, and the WebGL canvas above it
 * at z-30 renders the character into that rectangle. A panel at modal level
 * would paint over the canvas and hide him; and `renderInset` only runs while he
 * is off-screen, so on-screen he would draw twice — two Deck-Es, one of them in
 * a box.
 *
 * So the panel leaves a transparent well and sits BELOW the canvas, and the
 * character's own `flyTo` machinery parks him in it. That machinery already
 * pins to a DOM rect through scroll and resize, so the well behaves like any
 * other element he can stand beside. One render pass, no new stacking rules,
 * and the open reads as *he comes over to talk* rather than *a picture of him
 * appears* — which is the better animation anyway.
 *
 * Stacking, against the tokens in `theme.css`:
 *   scrim   z-15   above content (0), below chrome (20) — desktop chrome stays sharp
 *   panel   z-25   below the canvas, with a transparent character well
 *   canvas  z-30   (owned by DeckeHost)
 *   modals  100 / toasts 9999 still paint over him, which is correct and rare.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { lockScroll, unlockScroll } from '../../components/ui/Sheet'
import { Icon } from '../../components/Icon'
import type { DeckEInstance } from './runtime'
import { DeckeScreen, type ScreenSpec } from './DeckeScreen'

/**
 * WHERE HE STANDS WHILE THE CHAT IS OPEN, as a fraction of the viewport.
 *
 * NOT INSIDE THE PANEL, and that is a considered reversal. The panel first cut
 * a transparent "well" for him to stand in, on the theory that the off-screen
 * beacon does the same thing. Building it taught why it does not generalise:
 *
 *   `setCharacterHeight` does not scale him — it DOLLIES THE CAMERA. Shrinking
 *   him to fit a 210 px box pushed the camera from 18 to 69 world units, which
 *   moves the mapping between screen pixels and world units for the ENTIRE
 *   scene. Positions solved at one distance land somewhere else at another, and
 *   `framing.ts` then rotates him into a per-position view frame — correct for a
 *   character standing on a page, and it reads as a dramatic tilt inside a small
 *   box in the corner.
 *
 * So he does what the engine is built for: he stands ON THE PAGE, at his normal
 * size, beside the conversation. The canvas is above the scrim, so he stays
 * sharp while the page behind him blurs — which reads as him stepping forward to
 * talk, and needs no new engine behaviour at all.
 *
 * Left of centre on desktop (the panel is bottom-right); upper-middle on mobile,
 * where the panel is full-screen and the transcript starts lower.
 */
export const STAND_DESKTOP = { x: 0.36, y: 0.58 }
export const STAND_MOBILE = { x: 0.5, y: 0.3 }

/** `--breakpoint-nav` in theme.css. Below this the panel goes full-screen. */
const NAV_BREAKPOINT = 1068

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  /**
   * A panel he composed, if he composed one.
   *
   * Held on the MESSAGE rather than as one "current screen" on the hook, so a
   * panel stays attached to the turn that produced it. Scrolling back to a haul
   * from four questions ago should still show the haul, not whatever was
   * rendered last.
   */
  screen?: ScreenSpec
}

export function DeckeChat({
  open,
  minimised,
  onExpand,
  onClose,
  decke,
  messages,
  onSend,
  busy,
}: {
  open: boolean
  /** He has gone out onto the page; the transcript gets out of the way. */
  minimised: boolean
  onExpand: () => void
  onClose: () => void
  decke: DeckEInstance | null
  messages: ChatMessage[]
  onSend: (text: string) => void
  busy: boolean
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const [draft, setDraft] = useState('')
  const [desktop, setDesktop] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= NAV_BREAKPOINT,
  )

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${NAV_BREAKPOINT}px)`)
    const on = () => setDesktop(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  // ── Scroll authority ──────────────────────────────────────────────────────
  //
  // THE ORDER HERE IS THE WHOLE THING, and getting it wrong teleports him.
  //
  // `lockScroll` pins the body with `position: fixed` and offsets it by the
  // current scroll, so `window.scrollY` reads 0 for as long as the lock is
  // held. The character's pinned station computes its drift as
  // `scrollY - pinnedAt`, so locking while he is pinned hands that solve a
  // delta equal to the entire scroll offset and throws him across the screen.
  //
  // Sending him home releases the pin first. Only then is it safe to freeze.
  useEffect(() => {
    if (!open || minimised) return
    decke?.returnHome()
    lockScroll()
    return () => unlockScroll()
  }, [open, minimised, decke])

  // Escape closes; focus lands in the composer.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    const t = window.setTimeout(() => inputRef.current?.focus(), 260)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(t)
    }
  }, [open, onClose])

  // Keep the newest message in view as it streams.
  useEffect(() => {
    const el = transcriptRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const submit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const text = draft.trim()
      if (!text || busy) return
      setDraft('')
      onSend(text)
    },
    [draft, busy, onSend],
  )

  if (!open) return null

  // MINIMISED: the conversation does not vanish while he is out on the page —
  // it collapses to a bar showing the last thing the READER said, which is the
  // context they need to make sense of what he is doing. What HE says goes to
  // the speech bubble beside him instead, so the words are where the action is.
  //
  // No scrim: the page has to be visible for showing them something on it to
  // mean anything, and the scroll lock is released for the same reason — he may
  // be driving the page under himself.
  if (minimised) {
    const lastAsked = [...messages].reverse().find((m) => m.role === 'user')?.text
    return (
      <button
        type="button"
        onClick={onExpand}
        aria-label="Back to the conversation"
        className={[
          'fixed inset-x-[12px] bottom-[12px] z-[25] flex items-center gap-[10px]',
          'rounded-full border border-border-default bg-surface-raised/95 px-[16px] py-[10px]',
          'text-left shadow-xl backdrop-blur-sm nav:inset-x-auto nav:right-[24px] nav:w-[420px]',
          'motion-safe:animate-[decke-chat-in_220ms_cubic-bezier(0.2,0.9,0.3,1)_both]',
        ].join(' ')}
      >
        <span className="min-w-0 flex-1 truncate text-[13px] text-text-muted">
          {lastAsked ? `“${lastAsked}”` : 'Back to the conversation'}
        </span>
        <Icon name="chevron-down" size={16} className="shrink-0 rotate-180 text-icon-muted" />
      </button>
    )
  }

  return (
    <>
      {/*
        SCRIM AT z-15, and the number is doing real work. Content sits at 0 and
        app chrome at 20, so this darkens and blurs the page while leaving the
        header and sidebar sharp — which is the desktop behaviour asked for.
        On mobile the chrome is part of what should recede, so the scrim covers
        everything and the panel is full-screen.
      */}
      <button
        type="button"
        aria-label="Close chat"
        onClick={onClose}
        className={[
          'fixed inset-0 cursor-default bg-black/45 backdrop-blur-[3px]',
          'motion-safe:animate-[sheet-scrim-in_180ms_ease-out_both]',
          desktop ? 'z-[15]' : 'z-[24]',
        ].join(' ')}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Chat with Deck-E"
        className={[
          'fixed z-[25] flex flex-col',
          'border-border-default bg-surface-primary',
          desktop
            ? 'bottom-[24px] right-[24px] h-[min(620px,calc(100vh-140px))] w-[420px] rounded-[18px] border shadow-2xl motion-safe:animate-[decke-chat-in_280ms_cubic-bezier(0.2,0.9,0.3,1)_both]'
            : 'inset-0 motion-safe:animate-[sheet-panel-up_260ms_cubic-bezier(0.2,0.9,0.3,1)_both]',
        ].join(' ')}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-border-default px-[16px] py-[12px]">
          <span className="text-[15px] font-semibold text-text-primary">Deck-E</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chat"
            className="flex h-[32px] w-[32px] items-center justify-center rounded-full text-icon-default hover:bg-surface-secondary hover:text-icon-hover"
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        <div ref={transcriptRef} className="flex-1 overflow-y-auto px-[16px] pb-[12px]">
          {messages.length === 0 ? (
            <p className="py-[8px] text-[14px] leading-[21px] text-text-muted">
              Ask me about your collection, or tell me to show you something.
            </p>
          ) : (
            <ul className="flex flex-col gap-[10px]">
              {messages.map((m) => (
                <li
                  key={m.id}
                  className={[
                    'flex flex-col gap-[8px]',
                    m.role === 'user' ? 'items-end' : 'items-stretch',
                  ].join(' ')}
                >
                  {/* An empty bubble is not rendered at all. A turn that answers
                      purely with a panel would otherwise open with a stray empty
                      pill above it. */}
                  {m.text ? (
                    <div
                      className={[
                        'max-w-[85%] rounded-[14px] px-[12px] py-[8px] text-[14px] leading-[21px]',
                        m.role === 'user'
                          ? 'self-end bg-action-primary text-action-primary-text'
                          : 'self-start bg-surface-secondary text-text-body',
                      ].join(' ')}
                    >
                      {m.text}
                    </div>
                  ) : null}
                  {/* Full width rather than inside the bubble: a panel is a
                      figure, and an 85%-wide column with a card grid in it is a
                      column of one card. */}
                  {m.screen ? <DeckeScreen spec={m.screen} /> : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <form
          onSubmit={submit}
          className="flex shrink-0 items-center gap-[8px] border-t border-border-default px-[12px] py-[10px]"
        >
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Say something…"
            aria-label="Message Deck-E"
            className="h-[40px] flex-1 rounded-full bg-surface-secondary px-[14px] text-[14px] text-text-primary outline-none placeholder:text-text-muted"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            aria-label="Send"
            className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full bg-action-primary text-action-primary-text disabled:opacity-40"
          >
            <Icon name="chevron-right" size={18} />
          </button>
        </form>
      </div>
    </>
  )
}
