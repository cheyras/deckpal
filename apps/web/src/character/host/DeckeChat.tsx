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
 * So the panel sits BELOW the canvas and puts an empty MARK on the page for him
 * to stand on, and the character's own `flyTo` machinery parks him there. That
 * machinery already pins to a DOM rect through scroll and resize, so the mark
 * behaves like any other element he can stand beside. One render pass, no new
 * stacking rules, and the open reads as *he comes over to talk* rather than *a
 * picture of him appears* — which is the better animation anyway.
 *
 * WHICH MAKES HIM UNSTACKABLE, and the phone layout is built around that fact
 * rather than fighting it. He is painted by a canvas above everything the panel
 * lays out, so no z-index will ever put a bubble in front of him: the column
 * leaves him a gutter instead. See `--decke-gutter` and the CSS in `theme.css`.
 *
 * ON A PHONE THE PANEL IS GLASS. It has no background of its own — the scrim
 * below it darkens and blurs the page, and the reader can still see where they
 * are while he talks. That also makes it a sheet over a live page, so it takes
 * no pointer events except on the parts that are actually something; a tap on
 * the blurred page closes him.
 *
 * Stacking, against the tokens in `theme.css`:
 *   scrim   z-15 desktop / z-24 phone — desktop chrome stays sharp above it,
 *                                       a phone's chrome is part of what recedes
 *   panel   z-25   below the canvas; opaque card on desktop, glass on a phone
 *   canvas  z-30   (owned by DeckeHost)
 *   modals  100 / toasts 9999 still paint over him, which is correct and rare.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { lockScroll, unlockScroll } from '../../components/ui/Sheet'
import { Icon } from '../../components/Icon'
import type { DeckEInstance } from './runtime'
import { DeckeScreen, type ScreenSpec } from './DeckeScreen'
import type { PendingApproval, ToolChip } from './useDeckeChat'

/**
 * WHERE HE STANDS WHILE THE CHAT IS OPEN.
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
 * So he does what the engine is built for: he stands ON THE PAGE, beside the
 * conversation. The canvas is above the scrim, so he stays sharp while the page
 * behind him blurs — which reads as him stepping forward to talk, and needs no
 * new engine behaviour at all.
 *
 * Desktop keeps a viewport fraction: the panel is a card in the bottom-right
 * corner and he stands out on the page, left of centre, where nothing is.
 *
 * MOBILE PARKS HIM AGAINST A REAL ELEMENT instead — the landmark below. The
 * phone panel is full-bleed, so his spot is not "somewhere on the page", it is a
 * specific corner of a layout that has to leave room for him. Expressing it as a
 * DOM box means one geometry serves both jobs: `flyTo` parks him in it, and the
 * transcript measures it to know what to keep clear. A fraction would be two
 * numbers that have to agree by hand, and they would stop agreeing.
 */
export const STAND_DESKTOP = { x: 0.36, y: 0.58 }

/** The mobile park box, as `DeckeHost` looks for it. */
export const PARK_LANDMARK = 'data-decke-park'

/**
 * Fallback stand point if the landmark is not in the DOM — he is parked before
 * the panel has laid out, or someone renders the host without the chat.
 * Deliberately the same lower-left corner the landmark describes.
 */
export const STAND_MOBILE = { x: 0.14, y: 0.84 }

/** `--breakpoint-nav` in theme.css. Below this the panel goes full-screen. */
export const NAV_BREAKPOINT = 1068

/** The panel's own content padding, and the base the gutter is measured from. */
const CONTENT_PAD = 16

/** How far the park box sits from the panel's left and bottom edges. */
const PARK_LEFT = 10
const PARK_BOTTOM = 6

/**
 * HIS DRAWN SILHOUETTE, as multiples of `characterPx`.
 *
 * MEASURED, not derived, and the difference matters. `characterPx` is what
 * `BODY_H` — the deck box — spans on screen, and he is not only a deck box: the
 * bolts sit outside it, and the 3/4 view turns his 1.15-deep body so that some
 * of its DEPTH counts toward his width. Sizing the mark from `BODY_W / BODY_H`
 * therefore describes a box he does not fit in, which on a phone means his
 * shoulder over the text and his bolt off the edge of the screen.
 *
 * Taken off a composite at 390x844 with `characterPx` at 107, thresholding the
 * corner strip where nothing but him is drawn: 103 x 136, so 1.27 tall and 0.76
 * as wide as he is tall. `DeckE.screenRect` still uses the nominal ratio, and
 * says why — it is placing a speech bubble, where a few pixels closer than
 * intended is not a defect. A clearance is the case where it is.
 *
 * The mark is his SILHOUETTE because both of its jobs are about his outline:
 * keeping him on screen, and keeping text out from under him.
 * `flyTo(..., centre: true)` aims his BODY centre at the mark's centre, so the
 * fit is good to a few pixels rather than exact.
 */
const SILHOUETTE = 1.28
const SILHOUETTE_ASPECT = 0.76

/** Air between his widest point and the text beside him. */
const PARK_GAP = 12

/**
 * How far above his head a bubble must sit before it slides left.
 *
 * Zero would let a bubble come to rest with its baseline exactly level with the
 * top of his bolts, which looks like a collision even though it is not one.
 */
const CLEAR_PAD = 10

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
  /**
   * What he actually DID this turn, as chips.
   *
   * Held on the message for the same reason the screen is: the record of a
   * lookup belongs to the turn that made it. It is also what gets replayed,
   * compacted, as the NEXT turn's evidence — see `messagesToWire`. Without it,
   * turn N+1 has no record that turn N read 604 cards, only its own prose about
   * them, and prose is exactly the thing that drifts.
   */
  tools?: ToolChip[]
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
  asking,
  onApprove,
  onDeny,
  desktop,
  characterPx,
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
  /**
   * Writes he is holding, waiting on a person. Null when nothing is pending.
   *
   * The SDK genuinely has not run them — this is not a courtesy prompt in front
   * of work already done.
   */
  asking: PendingApproval[] | null
  onApprove: () => void
  onDeny: () => void
  /**
   * Is the viewport wide enough for the desktop composition?
   *
   * Passed in rather than watched here, and for the same reason `characterPx`
   * is: `DeckeHost` has to know too — crossing the breakpoint changes both his
   * size and where he is meant to stand, so it re-flies him — and two components
   * each holding their own answer is two answers that can be out of step for a
   * render. One writer, one query.
   */
  desktop: boolean
  /**
   * How tall he is on screen right now, in CSS pixels.
   *
   * Passed in rather than measured off `decke.screenRect()`, and the difference
   * matters: his live rect MOVES — it is mid-flight for most of a second after
   * the panel opens — and a layout that tracked it would have the whole column
   * creeping sideways while he travelled. `DeckeHost` owns the single number
   * that decides his size, so the layout can be solved from it once, before he
   * has even set off, and be right when he arrives.
   */
  characterPx: number
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const parkRef = useRef<HTMLDivElement | null>(null)
  const [draft, setDraft] = useState('')

  // HIS FOOTPRINT, from the one number that decides his size.
  //
  // Zero until the engine has measured, which is correct: before he exists there
  // is nothing to leave room for, and the column simply uses the full width.
  const parkH = Math.round(characterPx * SILHOUETTE)
  const parkW = Math.round(parkH * SILHOUETTE_ASPECT)
  const gutter =
    desktop || !characterPx ? 0 : Math.max(0, PARK_LEFT + parkW + PARK_GAP - CONTENT_PAD)

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

  // ── Who is standing behind whom ───────────────────────────────────────────
  //
  // One pass over the transcript, marking each of his own bubbles as clear of
  // him or not. The test is geometric and absolute — the bubble's bottom edge
  // against the top of the box he is parked in — rather than an index into the
  // list, because a bubble crosses that line by being SCROLLED as often as by
  // having something arrive underneath it.
  //
  // WRITTEN STRAIGHT TO THE DOM, not through state. This flips while a finger is
  // dragging the transcript; re-rendering the message list at scroll rate to
  // move one margin is how a chat starts to feel expensive. The CSS in
  // `theme.css` owns what the attribute means and animates the change.
  const reflow = useCallback(() => {
    const list = transcriptRef.current
    if (!list) return
    // No park box means no obstruction — desktop, or before he has a size. An
    // infinite limit marks everything clear, which collapses to the old layout.
    const park = parkRef.current
    const limit = park ? park.getBoundingClientRect().top - CLEAR_PAD : Infinity
    for (const el of list.querySelectorAll<HTMLElement>('.decke-shift')) {
      if (el.getBoundingClientRect().bottom <= limit) el.setAttribute('data-clear', 'true')
      else el.removeAttribute('data-clear')
    }
  }, [])

  // Keep the newest message in view as it streams, then re-solve what that
  // pushed past him.
  //
  // BEFORE PAINT, so a message that mounts already clear of him is simply drawn
  // there. Running this after paint would give the browser a previous computed
  // margin to interpolate from, and every arriving message would slide in from
  // under his feet — an animation for something that never moved.
  useLayoutEffect(() => {
    const el = transcriptRef.current
    if (el) el.scrollTop = el.scrollHeight
    reflow()
  }, [messages, reflow, gutter])

  // Dragging the transcript moves bubbles past him too. rAF-coalesced: `scroll`
  // can fire several times per frame and the pass reads layout.
  useEffect(() => {
    const el = transcriptRef.current
    if (!open || minimised || !el) return
    let raf = 0
    const on = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        reflow()
      })
    }
    el.addEventListener('scroll', on, { passive: true })
    window.addEventListener('resize', on)
    return () => {
      el.removeEventListener('scroll', on)
      window.removeEventListener('resize', on)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [open, minimised, reflow])

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
          'motion-safe:animate-[decke-chat-in_220ms_cubic-bezier(0.2,0.9,0.3,1)_backwards]',
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
          'motion-safe:animate-[sheet-scrim-in_180ms_ease-out_backwards]',
          desktop ? 'z-[15]' : 'z-[24]',
        ].join(' ')}
      />

      {/*
        THE PHONE PANEL HAS NO BACKGROUND OF ITS OWN. The scrim above already
        darkens and blurs the page; painting `surface-primary` over the top of
        that threw the blur away and replaced the app with a blank sheet. The
        reader should be able to see where they are while he talks.

        Which makes the panel a sheet of glass over a live page, and glass must
        not swallow taps: it is `pointer-events-none` on mobile, and only the
        parts that ARE something — the close button, the message list, the
        composer — take them back. Everything else falls through to the scrim,
        so a tap on the blurred page dismisses him, which is what a page you can
        still see invites you to do.
      */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Chat with Deck-E"
        style={{ '--decke-gutter': `${gutter}px` } as React.CSSProperties}
        className={[
          'fixed z-[25] flex flex-col',
          desktop
            ? 'bottom-[24px] right-[24px] h-[min(620px,calc(100vh-140px))] w-[420px] rounded-[18px] border border-border-default bg-surface-primary shadow-2xl motion-safe:animate-[decke-chat-in_280ms_cubic-bezier(0.2,0.9,0.3,1)_backwards]'
            : 'pointer-events-none inset-0 motion-safe:animate-[sheet-panel-up_260ms_cubic-bezier(0.2,0.9,0.3,1)_backwards]',
        ].join(' ')}
      >
        <header
          className={[
            'flex shrink-0 items-center justify-between px-[16px] py-[12px]',
            desktop ? 'border-b border-border-default' : '',
          ].join(' ')}
        >
          <span className="text-[15px] font-semibold text-text-primary">Deck-E</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chat"
            className="pointer-events-auto flex h-[32px] w-[32px] items-center justify-center rounded-full text-icon-default hover:bg-surface-secondary hover:text-icon-hover"
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        {/*
          BOTTOM-ALIGNED BY `mt-auto` ON THE LIST, never by `justify-end` on the
          scroller. `align-items`/`justify-content` pushing content past a flex
          container's START edge makes that overflow unreachable — `scrollHeight`
          comes back equal to `clientHeight` and the earliest messages cannot be
          scrolled to at all. That trap has already cost this codebase one
          unusable panel; see the Sheet primitive's notes. An auto margin does
          the same visual job and leaves the scroll range intact.
        */}
        <div
          ref={transcriptRef}
          className="flex flex-1 flex-col overflow-y-auto px-[16px] pb-[12px]"
        >
          {messages.length === 0 ? (
            <p className="decke-bubble decke-shift mt-auto py-[8px] text-[14px] leading-[21px] text-text-muted">
              Ask me about your collection, or tell me to show you something.
            </p>
          ) : (
            <ul className="pointer-events-auto mt-auto flex flex-col gap-[10px]">
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
                        'decke-bubble rounded-[14px] px-[12px] py-[8px] text-[14px] leading-[21px]',
                        m.role === 'user'
                          ? 'self-end bg-action-primary text-action-primary-text'
                          : 'decke-shift self-start bg-surface-secondary text-text-body',
                      ].join(' ')}
                    >
                      {m.text}
                    </div>
                  ) : null}
                  {/*
                    WHAT HE ACTUALLY DID, as chips.

                    Work has been indistinguishable from theatre: `thinking` is
                    driven by request latency, so a fabricated answer and a
                    researched one looked exactly the same while they were being
                    produced. These are emitted by the server's own execute
                    wrapper, one per real invocation, so a chip cannot appear
                    for a lookup that did not happen.

                    Rendered ABOVE his words on purpose — the reading order is
                    "I checked your collection" then "you've got 70 of them",
                    which is the order that makes the second sentence
                    trustworthy.
                  */}
                  {m.tools?.length ? (
                    <ul className="decke-shift flex flex-wrap gap-[6px] self-start">
                      {m.tools.map((t) => (
                        <li
                          key={t.id}
                          className={[
                            'rounded-full px-[10px] py-[3px] text-[12px] leading-[18px]',
                            'border border-border-subtle bg-surface-secondary',
                            t.phase === 'error' ? 'text-text-muted line-through' : 'text-text-muted',
                          ].join(' ')}
                          // The summary is the first line of the real tool
                          // result. Kept in a title rather than shown, because
                          // the chip is a reassurance and the answer is the
                          // answer — a chip that competes with his reply for
                          // attention is a worse chip.
                          title={t.summary ?? undefined}
                        >
                          {t.phase === 'start' ? `${t.title}…` : t.title}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {/* Full width rather than inside the bubble: a panel is a
                      figure, and an 85%-wide column with a card grid in it is a
                      column of one card. */}
                  {m.screen ? (
                    <div className="decke-figure decke-shift">
                      <DeckeScreen spec={m.screen} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/*
          WHERE HE STANDS, as a box rather than a coordinate.

          `DeckeHost` flies him to its centre and the transcript measures its top
          edge to decide what has cleared him, so his position and the space kept
          for him are the same fact stated once.

          Offset from the panel's bottom-left corner by a hair, because he is
          meant to sit IN the corner — and tall enough that his head is well
          above the composer's band while about half of him overlaps it. That
          overlap is the point: it puts him BESIDE the input rather than in a row
          of his own above it.
        */}
        {!desktop && characterPx > 0 ? (
          <div
            ref={parkRef}
            {...{ [PARK_LANDMARK]: '' }}
            aria-hidden
            className="pointer-events-none absolute opacity-0"
            style={{
              left: `${PARK_LEFT}px`,
              bottom: `${PARK_BOTTOM}px`,
              width: `${parkW}px`,
              height: `${parkH}px`,
            }}
          />
        ) : null}

        {/*
          THE APPROVAL GATE.

          Above the composer, because it is the thing to answer before saying
          anything else — and because a decision that scrolls away with the
          transcript is a decision people will miss and then be surprised by.

          The buttons are deliberately not symmetrical. "Leave it" is the plain
          one and comes first in reading order; going ahead takes the deliberate
          click. This is the only place in the app where a model asks to change
          the reader's collection, and the default posture should be no.
        */}
        {asking?.length ? (
          <div
            className="pointer-events-auto shrink-0 border-t border-border-default px-[16px] py-[12px]"
            role="alertdialog"
            aria-label="Deck-E is asking permission"
          >
            <p className="text-[13px] leading-[19px] text-text-body">
              {asking.length === 1
                ? `Let him ${asking[0].title.toLowerCase()}?`
                : `Let him make ${asking.length} changes?`}
            </p>
            <div className="mt-[8px] flex gap-[8px]">
              <button
                type="button"
                onClick={onDeny}
                className="rounded-[10px] border border-border-default px-[12px] py-[6px] text-[13px] text-text-body"
              >
                Leave it
              </button>
              <button
                type="button"
                onClick={onApprove}
                className="rounded-[10px] bg-action-primary px-[12px] py-[6px] text-[13px] text-action-primary-text"
              >
                Go ahead
              </button>
            </div>
          </div>
        ) : null}

        <form
          onSubmit={submit}
          className={[
            'decke-composer pointer-events-auto flex shrink-0 items-center gap-[8px] py-[10px] pr-[16px]',
            desktop ? 'border-t border-border-default' : '',
          ].join(' ')}
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
