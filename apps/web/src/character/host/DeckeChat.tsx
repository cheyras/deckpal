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
import { ChatMarkdown } from './chat/ChatMarkdown'
import { ThinkingRow } from './chat/ThinkingRow'
import { ToolRow } from './chat/ToolRow'
import { ApprovalCard } from './chat/ApprovalCard'
import type { ApprovalPreview, Choices, RowChoice } from './chat/approvalCardState'
import type { PendingApproval, ToolChip } from './useDeckeChat'
import {
  chooseOpeners,
  noteShown,
  openerStore,
  readOpenerLog,
  replyAnnouncement,
  writeOpenerLog,
  type Opener,
} from './deckeChatState'

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

/**
 * The composer card, as `DeckeHost` looks for it.
 *
 * He stands beside it, so it is what decides how big he is. Expressed as a DOM
 * box for the same reason the park box is: one geometry serving both jobs beats
 * two numbers that have to agree by hand and eventually will not.
 */
export const COMPOSER_LANDMARK = 'data-decke-composer'

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

/*
 * WHAT A FIRST-TIME READER CAN PRESS INSTEAD OF THINKING OF SOMETHING — and it
 * is no longer three fixed strings in this file. The pool, the rotation and the
 * per-viewer memory moved to `deckeChatState.ts`, where they can be tested
 * without a browser.
 *
 * The original rule survives the move and is still the reason the list is
 * shaped the way it is: ONE OF EACH KIND rather than three of the best, because
 * the job is to show the range — something he answers from data, something he
 * shows on a panel, and something he does to the page. The third is the one
 * nobody guesses he can do.
 *
 * WHAT IS NEW is that the three are chosen rather than fixed. NN/g's finding is
 * that re-serving a suggestion someone already passed over reads as nagging, and
 * three constants have nothing else to offer. `chooseOpeners` picks the
 * least-seen member of each kind, and `noteShown` records the sighting in
 * `localStorage` — per viewer, best-effort, and every touch of storage is inside
 * a `try` because a private window throws on the property access itself.
 */

/** Air between his widest point and the text beside him. */
const PARK_GAP = 12

/**
 * How far above his head a bubble must sit before it slides left.
 *
 * Zero would let a bubble come to rest with its baseline exactly level with the
 * top of his bolts, which looks like a collision even though it is not one.
 */
const CLEAR_PAD = 10

/**
 * ONE ORDERED LIST, not three parallel ones.
 *
 * A turn used to be `{ text, tools?, screen? }` — his words in one field, the
 * record of what he did in a second, and any panel he composed in a third. That
 * shape cannot express the thing this feature is becoming, and it was already
 * quietly lying about the thing it does now:
 *
 *  - **It cannot say WHEN.** Chips were grouped per message, so a lookup that
 *    happened halfway through a sentence rendered as though it happened before
 *    the sentence began. Once he narrates a journey — "I'm heading to your
 *    decks", travel, "here they are" — the rows have to interleave with the
 *    prose in occurrence order, and three arrays have no order between them.
 *  - **It could not keep its own order.** Updating a chip did
 *    `filter(c => c.id !== chip.id)` then append, so every `ok` moved that chip
 *    to the END. That is why the order visibly shifted between frames — and
 *    worse, it pushed the one call that FAILED into last place, where it read
 *    as the most recent thing rather than as the broken one. With a part list
 *    an update is an update in place, so first-seen order is preserved by
 *    construction rather than by remembering to.
 *  - **It allowed one screen per turn**, silently replacing an earlier one.
 *
 * `text` and `tools` are derived by the helpers below rather than stored, so
 * there is one source of truth and nothing to keep in step.
 */
export type ChatPart =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'tool'; id: string; chip: ToolChip }
  | { kind: 'screen'; id: string; spec: ScreenSpec }

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  parts: ChatPart[]
}

/** Everything he said this turn, in order, with the rows taken out. */
export function messageText(m: ChatMessage): string {
  let out = ''
  for (const p of m.parts) if (p.kind === 'text') out += p.text
  return out
}

/**
 * What he actually DID this turn.
 *
 * Also what gets replayed, compacted, as the NEXT turn's evidence — without it
 * turn N+1 has no record that turn N read 604 cards, only its own prose about
 * them, and prose is exactly the thing that drifts.
 */
export function messageTools(m: ChatMessage): ToolChip[] {
  const out: ToolChip[] = []
  for (const p of m.parts) if (p.kind === 'tool') out.push(p.chip)
  return out
}

/** A message with nothing in it yet renders nothing — see the transcript. */
export function messageIsEmpty(m: ChatMessage): boolean {
  return m.parts.every((p) => (p.kind === 'text' ? p.text.length === 0 : false))
}


/**
 * The status lines the thinking row shows, newest last.
 *
 * SOURCED, NEVER COMPOSED HERE. Each line is a `note` the server emitted at a
 * real tool boundary, or the real title of a call that actually started. The one
 * thing this must not do is invent a plausible line — "Checking your
 * collection…" with no lookup behind it is strictly worse than no line at all,
 * because it manufactures evidence. `ThinkingRow` handles an empty list by
 * saying something honest and non-specific.
 */
function liveLabels(m: ChatMessage): string[] {
  const out: string[] = []
  for (const p of m.parts) {
    if (p.kind !== 'tool') continue
    if (p.chip.note) out.push(p.chip.note)
    else if (p.chip.phase === 'start') out.push(`${p.chip.title}…`)
  }
  return out
}

export function DeckeChat({
  open,
  minimised,
  onExpand,
  onClose,
  decke,
  messages,
  onSend,
  onStop,
  busy,
  asking,
  onApprove,
  onDeny,
  approvalPreview,
  approvalChoices,
  onApprovalChoice,
  approvalBusy,
  onRetryTool,
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
  /**
   * Abort the turn in flight.
   *
   * The ONLY reachable path to the abort signal. `useDeckeChat` has returned a
   * `stop()` since it was written and nothing ever called it, so every
   * downstream abort handler — the RLS session destroying its connection, the
   * API client dropping its wait, a sub-agent stopping its Opus bill — was
   * unreachable code guarding an event that could not happen.
   */
  onStop: () => void
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
  /** The dry run's real rows for a held call, or null for the plain dialog. */
  approvalPreview: (toolCallId: string) => ApprovalPreview | null
  approvalChoices: Choices
  onApprovalChoice: (index: number, choice: RowChoice) => void
  /** True from the tick Accept is pressed until the write has answered. */
  approvalBusy: boolean
  /**
   * Ask for a failed or partial call to be tried again.
   *
   * Optional, and its absence is honest rather than convenient: a row without
   * it still shows its failure loudly, it simply offers no way back from this
   * surface. A retry affordance that silently did nothing would be worse.
   */
  onRetryTool?: (id: string) => void
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
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const parkRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLFormElement | null>(null)
  const [draft, setDraft] = useState('')
  const empty = messages.length === 0

  /**
   * THE COMPOSER STARTS IN THE MIDDLE AND DROPS ON THE FIRST MESSAGE.
   *
   * Before anything has been said there is no transcript for it to be the foot
   * of, so it sits centred in the pane the way a new-chat screen does. The
   * first send moves it to the bottom and the conversation fills in above.
   *
   * MEASURED, NOT GUESSED — a FLIP. The distance it travels depends on the pane
   * height, the safe area and how tall the empty state is, so a hardcoded
   * number would be wrong at every viewport but one. `useLayoutEffect` runs
   * after the DOM has been mutated but before paint, and `lastTop` still holds
   * the position from the PREVIOUS commit, which is exactly the "before" half a
   * FLIP needs.
   */
  const lastTopRef = useRef<number | null>(null)
  const wasEmptyRef = useRef(empty)
  const [dropPx, setDropPx] = useState(0)
  useLayoutEffect(() => {
    const el = composerRef.current
    if (!el) return
    const top = el.getBoundingClientRect().top
    if (wasEmptyRef.current && !empty && lastTopRef.current != null) {
      const delta = top - lastTopRef.current
      // Only when it genuinely moved, and only downward. A resize that happens
      // to coincide should not trigger a flourish, and an upward delta means
      // the layout did something this animation does not describe.
      setDropPx(delta > 8 ? delta : 0)
    }
    lastTopRef.current = top
    wasEmptyRef.current = empty
  }, [empty, messages.length])

  // HIS FOOTPRINT, from the one number that decides his size.
  //
  // Zero until the engine has measured, which is correct: before he exists there
  // is nothing to leave room for, and the column simply uses the full width.
  const parkH = Math.round(characterPx * SILHOUETTE)
  const parkW = Math.round(parkH * SILHOUETTE_ASPECT)
  const gutter =
    desktop || !characterPx ? 0 : Math.max(0, PARK_LEFT + parkW + PARK_GAP - CONTENT_PAD)

  /**
   * When the turn in progress started, for the thinking row's counter.
   *
   * Latched on the transition into `busy` rather than read from a message,
   * because a leg boundary must not restart the clock: a turn that runs a deep
   * tool for three minutes is ONE wait as far as the person waiting is
   * concerned, however many requests it took underneath.
   */
  /**
   * The composer's height, measured from its own content.
   *
   * MEASURED RATHER THAN COUNTED. Counting `
` is wrong the moment a line
   * wraps, which for a dictated card list is immediately. Setting the height to
   * `auto` and reading `scrollHeight` back is what the browser already knows.
   *
   * `useLayoutEffect` so it lands before paint — after paint, every keystroke
   * that adds a line shows one frame at the old height first, which reads as a
   * stutter on exactly the input someone is looking at while they type.
   */
  const MIN_ROWS = 1
  const MAX_ROWS = 6
  const LINE = 22
  const PAD = 18
  const [composerH, setComposerH] = useState(MIN_ROWS * LINE + PAD)
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const next = Math.min(el.scrollHeight, MAX_ROWS * LINE + PAD)
    el.style.height = `${next}px`
    setComposerH(next)
  }, [draft])

  const [turnStartedAt, setTurnStartedAt] = useState(0)
  const wasBusyRef = useRef(false)
  useEffect(() => {
    if (busy && !wasBusyRef.current) setTurnStartedAt(Date.now())
    wasBusyRef.current = busy
  }, [busy])

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant') ?? null
  const lastAssistantId = lastAssistant?.id ?? null

  // ── The openers this viewer has not been shown lately ─────────────────────
  //
  // CHOSEN ONCE PER OPENING, not per render. Re-running the choice on every
  // keystroke would be free — it is a pass over six items — but it would also
  // let the three chips change under someone's finger the moment the log was
  // written, which is a worse bug than the one being fixed.
  const [openers, setOpeners] = useState<readonly Opener[]>(() =>
    chooseOpeners(undefined, readOpenerLog(openerStore())),
  )

  // RECORDED WHEN THEY ARE ACTUALLY ON SCREEN. Writing the sighting at choice
  // time would count an opening that never reached the empty state — the panel
  // opened on an existing conversation, say — and rotate a chip nobody saw.
  const openersLoggedRef = useRef(false)
  useEffect(() => {
    if (!open || !empty || openersLoggedRef.current) return
    openersLoggedRef.current = true
    const store = openerStore()
    writeOpenerLog(store, noteShown(readOpenerLog(store), openers))
  }, [open, empty, openers])

  // Closing re-arms the choice, so the NEXT opening reads the log written by
  // this one. Doing it on close rather than on open means the fresh set is
  // already in place before the panel animates in, with no swap mid-flight.
  useEffect(() => {
    if (open) return
    openersLoggedRef.current = false
    setOpeners(chooseOpeners(undefined, readOpenerLog(openerStore())))
  }, [open])

  // ── What a screen reader is told, and when ────────────────────────────────
  //
  // See `replyAnnouncement` for the reasoning; the short version is that the
  // announcement fires on the TURN BOUNDARY and describes the shape of what
  // arrived, never its content. A live region over the streaming text would
  // read a long answer aloud as a stream of fragments and make it unreadable.
  //
  // CLEARED FIRST, THEN SET. Two turns in a row that produce the same sentence
  // — "Deck-E replied." — are the common case, and assistive technology
  // announces a live region when its CONTENTS CHANGE. Writing the same string
  // twice is not a change, so the second turn would land silently. Emptying the
  // region and repopulating it a tick later is a change either way.
  //
  // THE TIMER IS A REF, NOT AN EFFECT CLEANUP, and that is a real bug avoided
  // rather than a style choice. This effect also depends on the last assistant
  // message, whose identity changes on every tick of a stream — so a cleanup
  // that cancelled the pending announcement would be cancelled by the very next
  // chip update after the turn ended, and the boundary would pass in silence on
  // exactly the turns that did the most.
  const [announcement, setAnnouncement] = useState('')
  const announceArmedRef = useRef(false)
  const announceTimerRef = useRef(0)
  useEffect(() => () => window.clearTimeout(announceTimerRef.current), [])
  useEffect(() => {
    if (busy) {
      announceArmedRef.current = true
      return
    }
    if (!announceArmedRef.current) return
    announceArmedRef.current = false
    const text = replyAnnouncement(lastAssistant?.parts ?? [])
    if (!text) return
    setAnnouncement('')
    window.clearTimeout(announceTimerRef.current)
    announceTimerRef.current = window.setTimeout(() => setAnnouncement(text), 80)
  }, [busy, lastAssistant])

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

  /**
   * Where focus was before he opened, so it can go back.
   *
   * Opening moves focus into the composer, which is right. Closing used to
   * simply drop it — and focus that lands nowhere lands on `<body>`, so the
   * next Tab starts from the top of the page and a keyboard user is silently
   * teleported to the beginning of the app for the crime of pressing Escape.
   */
  const returnFocusRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!open) return
    returnFocusRef.current = (document.activeElement as HTMLElement) ?? null
    return () => {
      const el = returnFocusRef.current
      returnFocusRef.current = null
      // ── AND A FALLBACK, WHICH IS THE COMMON CASE RATHER THAN THE EDGE ──
      //
      // The launcher unmounts once he has arrived, so the element that opened
      // this panel is usually GONE by the time it closes. Focusing a detached
      // node is a silent no-op that leaves focus on `<body>`, so a restore
      // written only for the happy path would almost never fire — measured
      // exactly that way before this fallback existed.
      //
      // The launcher remounts on close and is the control that represents this
      // panel, so it is where focus belongs. After a frame, because it does not
      // exist yet at the moment this cleanup runs.
      const focus = (target: HTMLElement | null) => {
        if (!target?.isConnected) return false
        try {
          target.focus({ preventScroll: true })
          return document.activeElement === target
        } catch {
          return false
        }
      }
      if (focus(el)) return
      requestAnimationFrame(() => {
        focus(document.querySelector<HTMLElement>('button[aria-label="Chat with Deck-E"]'))
      })
    }
  }, [open])

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
  //
  // ONLY IF THEY HAVE NOT SCROLLED AWAY, which is the correction. This used to
  // hard-set `scrollTop = scrollHeight` on EVERY message and gutter change with
  // no guard at all — so reading back through the conversation while he was
  // still streaming yanked you to the bottom on the very next token. Combined
  // with a scroll container that was not taking pointer events, that is the
  // whole of "I'm trying to scroll and I can't."
  //
  // The threshold is generous on purpose. Someone a line and a half off the
  // bottom is still following along and wants to keep following; someone who
  // has gone hunting for what he said four answers ago has left.
  //
  // AND THE HALF THAT WAS MISSING: A WAY BACK. The guard above stops the yank,
  // which is the defect NN/g measured — users read a streaming answer from the
  // top, and one participant gave up on reading at all rather than fight the
  // scroll. What the guard leaves behind is a reader parked halfway up a
  // conversation that is still growing, with no indication that it is growing
  // and nothing to press. `atLatest` mirrors `stickRef` into React so the
  // control below can exist; the ref stays the authority for the layout pass,
  // because that runs at scroll rate and must not wait on a render.
  const stickRef = useRef(true)
  const [atLatest, setAtLatest] = useState(true)
  useLayoutEffect(() => {
    const el = transcriptRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
    reflow()
  }, [messages, reflow, gutter])

  /**
   * Go to the end, and put focus somewhere it can survive.
   *
   * The button that calls this UNMOUNTS the moment it succeeds, which would
   * leave focus on `<body>` and send the next Tab to the top of the app — the
   * same defect the close handler above documents at length. The composer is
   * where someone who has just caught up wants to be anyway.
   */
  const jumpToLatest = useCallback(() => {
    const el = transcriptRef.current
    if (el) el.scrollTop = el.scrollHeight
    stickRef.current = true
    setAtLatest(true)
    inputRef.current?.focus({ preventScroll: true })
  }, [])

  // A fresh opening starts at the end. Without this, closing the panel while
  // scrolled up and reopening it leaves the follow disarmed and the jump
  // control showing over a conversation that is already at its bottom.
  useEffect(() => {
    if (!open) return
    stickRef.current = true
    setAtLatest(true)
  }, [open])

  // Dragging the transcript moves bubbles past him too. rAF-coalesced: `scroll`
  // can fire several times per frame and the pass reads layout.
  useEffect(() => {
    const el = transcriptRef.current
    if (!open || minimised || !el) return
    let raf = 0
    const STICK_SLACK = 48
    const on = () => {
      // Read the stick decision on every scroll event, not only in the rAF —
      // the coalescing exists to keep the LAYOUT pass off the hot path, and
      // three cheap property reads are not that.
      const stuck = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_SLACK
      stickRef.current = stuck
      // Only when it actually flips. A drag fires this dozens of times a second
      // and every one of them would otherwise be a render of the whole message
      // list to change nothing.
      setAtLatest((prev) => (prev === stuck ? prev : stuck))
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
      // Sending re-arms the follow. Someone who has just spoken is asking to be
      // shown the answer, wherever they had scrolled to before typing it.
      stickRef.current = true
      setAtLatest(true)
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
    const lastAskedMsg = [...messages].reverse().find((m) => m.role === 'user')
    const lastAsked = lastAskedMsg ? messageText(lastAskedMsg) : undefined
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
        THE SCRIM DIMS THE CONTENT PANE AND NOTHING ELSE — on both platforms
        now, which is the change. It used to differ, and the phone version was
        wrong.

        DESKTOP works by STACKING and always did: the scrim is z-15, content is
        0, app chrome is 20, and the header and sidebar are opaque — so they
        paint over the blurred region and stay sharp. Nothing about that is
        reversed here.

        PHONE was z-[24], ABOVE the header at 20, so it painted over the chrome
        and blurred the app's own logo and buttons along with the page. The fix
        is GEOMETRIC, not a z-index swap, and that distinction is the whole
        reason this comment exists: `backdrop-filter` samples whatever
        composites behind it REGARDLESS of paint order, so dropping the scrim
        below the header would still blur what is under the header. The blurred
        element must not extend under the header at all. Hence a top offset
        rather than a new z-index.

        The offset matches `AppShell`'s own header box exactly, from the custom
        properties it publishes — 64px on a phone, 78 on desktop, plus the
        notch. Duplicating the numbers here is how they would come apart.
      */}
      <button
        type="button"
        aria-label="Close chat"
        onClick={onClose}
        style={{
          background: 'var(--color-decke-scrim)',
          backdropFilter: 'blur(var(--decke-scrim-blur))',
          WebkitBackdropFilter: 'blur(var(--decke-scrim-blur))',
          top: desktop ? 0 : 'calc(var(--app-header-h) + env(safe-area-inset-top))',
        }}
        className={[
          'fixed inset-x-0 bottom-0 cursor-default',
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
        // NOT `aria-modal`, and removing it is the fix rather than the
        // omission. `aria-modal="true"` tells assistive technology that
        // everything outside this element is inert — which was true when the
        // panel was a card over a scrim that covered the whole viewport, and
        // stopped being true the moment the ruling landed that the app header
        // and the full-height sidebar stay sharp AND USABLE while he is open.
        // They are reachable, they are meant to be, and a nav tap while the
        // chat is open is a deliberate interaction rather than an accident.
        //
        // So the attribute now describes a modality the design has explicitly
        // rejected: a screen-reader user would be told the rest of the app is
        // unavailable while a sighted user is being invited to click it. The
        // honest markup for "a dialog that does not take the app hostage" is
        // `role="dialog"` without it.
        //
        // It also means no focus trap belongs here. Trapping focus inside a
        // panel whose whole point is that the app around it still works would
        // implement the lie instead of removing it. What DOES belong — and is
        // below — is returning focus where it came from on close, which is
        // ordinary courtesy and is missing either way.
        aria-label="Chat with Deck-E"
        style={{
          '--decke-gutter': `${gutter}px`,
          // THE PANEL IS THE CONTENT PANE, on both platforms.
          //
          // Desktop used to be a 420px card pinned to the bottom-right corner.
          // The complaint was that talking to him should feel like the app is
          // listening, not like a widget opened — and the reconciliation, which
          // took a ruling, is that "full screen" means the CONTENT PANE. The
          // header and the full-height sidebar stay sharp and usable; the pane
          // between them becomes the conversation.
          //
          // Phone was already `inset-0`, and that was the bug: the panel's own
          // "Deck-E" row and its ✕ started at the very top of the screen, above
          // the app header, in the status bar. On a real installed PWA the ✕
          // literally overlaps the battery glyph. Starting below the app header
          // fixes the collision by construction rather than by padding it away,
          // and it is the same offset the scrim uses, from the same source.
          left: desktop ? 'var(--app-sidebar-w)' : 0,
          top: 'calc(var(--app-header-h) + env(safe-area-inset-top))',
        } as React.CSSProperties}
        className={[
          // GLASS ON BOTH, and pointer-transparent on both. It was already so
          // on a phone, for a stated reason that turns out to apply just as
          // well to a dimmed desktop pane: the reader should be able to see
          // where they are while he talks, and a sheet you can see through must
          // not swallow taps meant for what is behind it. Only the parts that
          // ARE something take pointer events back.
          'pointer-events-none fixed bottom-0 right-0 z-[25] flex flex-col',
          desktop
            ? 'motion-safe:animate-[decke-chat-in_280ms_cubic-bezier(0.2,0.9,0.3,1)_backwards]'
            : 'motion-safe:animate-[sheet-panel-up_260ms_cubic-bezier(0.2,0.9,0.3,1)_backwards]',
        ].join(' ')}
      >
        {/* A SLIM ROW UNDER THE APP HEADER, not a card's title bar. The panel
            no longer has a border to hang a rule off, and the app's own header
            is directly above providing that edge. No safe-area padding here on
            purpose: the panel's top offset already clears the notch, so padding
            it again would push this row a second inset down the screen. */}
        <header className="mx-auto flex w-full max-w-[760px] shrink-0 items-center justify-between px-[16px] py-[10px]">
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
          THE CONVERSATION LIVES IN A COLUMN, not across the whole pane.

          On a phone the pane IS the column and the cap never binds. On desktop
          the content pane can be 1,600px wide and a transcript stretched across
          that is unreadable — the measure is the same problem a page of prose
          has, and the answer is the same.

          `justify-center` while nothing has been said: before there is a
          transcript, the composer has nothing to be the foot of, so it sits in
          the middle the way a new-chat screen does. The first message drops it
          to the bottom — see the FLIP above — and the conversation fills in
          over it.
        */}
        <div
          className={[
            'mx-auto flex w-full min-h-0 max-w-[760px] flex-1 flex-col',
            // CENTRED ONLY ON DESKTOP. On a phone the composer belongs at the
            // bottom, under the thumb, where the software keyboard will not
            // cover it — and where his park box is, which is the other half:
            // his mark is anchored to the panel's bottom-left corner so that he
            // stands BESIDE the input. Centring the input on a phone left him
            // stranded below it, talking to nothing.
            // Desktop centres it. A phone pushes it to the BOTTOM, which needs
            // saying explicitly: when the conversation is empty the transcript
            // is `shrink-0`, so without this the column packs everything at the
            // top and leaves a third of the screen blank underneath.
            empty ? (desktop ? 'justify-center' : 'justify-end') : '',
          ].join(' ')}
        >
        {/*
          BOTTOM-ALIGNED BY `mt-auto` ON THE LIST, never by `justify-end` on the
          scroller. `align-items`/`justify-content` pushing content past a flex
          container's START edge makes that overflow unreachable — `scrollHeight`
          comes back equal to `clientHeight` and the earliest messages cannot be
          scrolled to at all. That trap has already cost this codebase one
          unusable panel; see the Sheet primitive's notes. An auto margin does
          the same visual job and leaves the scroll range intact.
        */}
        {/*
          `pointer-events-auto` ON THE SCROLLER, not only on the list inside it.

          The panel is glass and therefore pointer-transparent, and only the
          inner `<ul>` used to take events back — so a drag that started in the
          padding band around the messages, which is most of the width, fell
          straight through to the scrim and did nothing. Proven rather than
          suspected: the frame after a real 1.3-second drag was pixel-identical
          to the frame before it.

          The fade mask is the other half of "the composer floats on nothing":
          text now dissolves as it passes under the card instead of sliding
          behind an invisible edge. It is a mask rather than a gradient overlay
          because what is behind it is a live blurred page, so there is no
          colour an overlay could match.
        */}
        {/*
          THE TRANSCRIPT'S LIVE REGION, AND IT IS NOT THE TRANSCRIPT.

          D13: the minimised bubble has `aria-live="polite"` and this surface —
          the one people actually read — had none, so a screen-reader user
          talking to Deck-E in the panel was told nothing at all. The repair
          that suggests itself is `aria-live` on the message list, and it is a
          trap: the list is rewritten on every token, so a five-hundred-word
          answer would be read aloud as several hundred overlapping fragments
          and could never be followed. Announcing everything and announcing
          nothing fail the same person; this is the third option.

          ALWAYS MOUNTED, EMPTY, AND OUTSIDE THE MESSAGE LIST. A live region has
          to exist before its contents change or the first change is missed —
          the same rule `ToolRow` documents for its own — and keeping it out of
          the list means nothing the list does can accidentally announce.

          `role="status"` implies polite and is the honest role: this is
          progress information about the surface, not an alert demanding a
          decision. The approval card is the alert, and it says so itself.
        */}
        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {announcement}
        </div>
        <div
          ref={transcriptRef}
          className={[
            'decke-transcript-fade pointer-events-auto flex flex-col overflow-y-auto px-[16px] pb-[12px]',
            empty ? 'shrink-0' : 'flex-1',
          ].join(' ')}
        >
          {empty ? (
            /*
              THE MOST-SEEN SCREEN IN THE WHOLE FEATURE, and it used to be one
              grey sentence. Every conversation starts here and most sessions
              never leave it, so it is worth more than a placeholder.

              Three real openers rather than a list of capabilities. A feature
              tour tells someone what a thing can do; a prompt they can press
              shows them, and it solves the harder problem — nobody knows what
              to type first. They fill the composer rather than sending, so
              pressing one is a suggestion and not a commitment.

              They are deliberately GENERIC. Openers drawn from what this reader
              actually owns would be better and are worth doing, but they need a
              collection read at panel-open time, and a starting screen that
              waits on a request is a starting screen that is sometimes blank.
            */
            /*
              THE GUTTER IS PER-ELEMENT, NOT PER-BLOCK, and that is the whole
              reason `decke-shift` sits on the children rather than on the
              wrapper. He stands in the bottom-left corner, so only the things
              actually beside him need to move out of his way — but a single
              `decke-shift` on the wrapper indents the WHOLE block the moment
              its bottom edge overlaps him, which pushed a heading two hundred
              pixels above his head into a narrow column and wrapped it. It read
              as broken alignment rather than as a character standing there.
              `reflow` marks each element clear on its own geometry, so with the
              class on the children the heading stays full width and only the
              chips beside him step aside.
            */
            <div className="flex flex-col items-start gap-[14px] py-[8px]">
              <div className="decke-shift">
                <p className="text-[15px] font-semibold leading-[22px] text-text-primary">
                  Ask Deck-E about your collection
                </p>
                <p className="mt-[2px] text-[13px] leading-[19px] text-text-muted">
                  He can look things up, count what you own, and take you to it.
                </p>
              </div>
              <ul className="decke-shift flex flex-wrap gap-[8px]">
                {openers.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(o.text)
                        inputRef.current?.focus()
                      }}
                      className={[
                        'rounded-full border border-border-default bg-surface-secondary',
                        'px-[12px] py-[6px] text-[13px] leading-[18px] text-text-body',
                        'hover:bg-surface-tertiary focus-visible:outline focus-visible:outline-2',
                        'focus-visible:outline-offset-2 focus-visible:outline-border-focus',
                      ].join(' ')}
                    >
                      {o.text}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
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
                  {/*
                    PARTS IN THE ORDER THEY HAPPENED.

                    Three parallel arrays used to be rendered in a fixed
                    sequence — words, then every row, then any panel — which put
                    a lookup that occurred halfway through a sentence above the
                    sentence it interrupted. The comment above the old block
                    said rows render "ABOVE his words on purpose", and the JSX
                    below it put the words first: the code contradicted its own
                    comment, and the owner noticed the result without knowing
                    why. Occurrence order settles it and is the truthful answer
                    to both.

                    Every row here is emitted by the SERVER's own execute
                    wrapper, one per real invocation. A row cannot appear for a
                    lookup that did not happen, because this is not a thing the
                    model can ask for.
                  */}
                  {m.parts.map((part) => {
                    if (part.kind === 'text') {
                      if (!part.text) return null
                      return (
                        <div
                          key={part.id}
                          className={[
                            'decke-bubble rounded-[14px] px-[12px] py-[8px] text-[14px] leading-[21px]',
                            m.role === 'user'
                              ? 'self-end bg-action-primary text-action-primary-text'
                              : 'decke-shift self-start bg-surface-secondary text-text-body',
                          ].join(' ')}
                        >
                          {/* MARKDOWN, at last. `{m.text}` rendered raw, so a
                              numbered list of what to buy next arrived as one
                              paragraph with digits in it. The renderer is lazy
                              — react-markdown and remark-gfm are ~40 KB gz and
                              never touch the main bundle — and it is stricter
                              than the library's defaults about URLs and images,
                              because everything here is model output over a
                              context full of strings other people typed. */}
                          <ChatMarkdown text={part.text} tone="transcript" />
                        </div>
                      )
                    }
                    if (part.kind === 'tool') {
                      return (
                        <ul key={part.id} className="decke-shift w-full self-start">
                          <ToolRow data={part.chip} onRetry={onRetryTool} />
                        </ul>
                      )
                    }
                    // Full width rather than inside a bubble: a panel is a
                    // figure, and an 85%-wide column with a card grid in it is
                    // a column of one card.
                    return (
                      <div key={part.id} className="decke-figure decke-shift">
                        <DeckeScreen spec={part.spec} onResize={reflow} />
                      </div>
                    )
                  })}
                  {/*
                    A REAL THINKING STATE, and there was none at all.

                    The assistant message is inserted with no parts, and an
                    empty message renders nothing — so between pressing send and
                    the first token the transcript showed literally nothing. The
                    owner sat through 210 seconds of that, 61 of them
                    pixel-identical by direct frame comparison, and the answer
                    that finally arrived was a tool failure he did not notice.

                    It appears on the LAST assistant message while the turn is
                    busy, and it carries the live status beats the server sends
                    from real tool boundaries. It is not a spinner: it counts,
                    and a counter cannot be caught looking stopped.

                    NO `steps`, AND THAT IS A FIX RATHER THAN AN OMISSION. It
                    used to be handed `messageTools(m)` — the very rows the loop
                    above has already rendered inline, in the order they
                    happened. So every row appeared TWICE while a turn was busy,
                    and because a failed row opens itself, a failure showed its
                    loud red row twice at once, each with its own "Try again",
                    and announced itself twice to a screen reader. On the exact
                    surface that exists because the owner once failed to notice
                    a failure at all.

                    The drawer was designed before the ordered part list, for a
                    transcript that had nowhere else to put a row. It has
                    somewhere else now, and occurrence order is the better
                    place: a lookup that happened between two sentences belongs
                    between them, not collapsed inside a spinner.
                  */}
                  {busy && m.role === 'assistant' && m.id === lastAssistantId ? (
                    <div
                      className="decke-shift w-full self-start"
                      // A stable hook for verification. The gates and the
                      // visual harness both need to know when a turn is still
                      // in flight, and every other signal in this panel is
                      // ambiguous: the composer input is never disabled, and
                      // the send button reads disabled both while busy AND
                      // when idle with an empty box. This is unambiguous and
                      // it is mounted exactly while he is working.
                      data-decke-thinking
                    >
                      <ThinkingRow startedAt={turnStartedAt} labels={liveLabels(m)} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/*
          THE WAY BACK DOWN.

          The transcript stopped yanking a reader to the bottom mid-stream, which
          is right — NN/g watched people read from the top and one stop reading
          altogether rather than fight it. But "we will not move you" without
          "and here is how to catch up" strands somebody halfway up a
          conversation that is still growing, with nothing to press.

          A ZERO-HEIGHT ROW WITH AN ABSOLUTE CHILD, so the control floats over
          the last line of the transcript instead of taking a band of height from
          it. Putting it in flow would shrink the scroller by its own height the
          moment it appeared, which reflows the very text the reader is in the
          middle of — the defect, reintroduced by its own fix.

          Rendered only when there is somewhere to go: never on the empty state,
          and never while the view is already at the end.
        */}
        {!empty && !atLatest ? (
          <div className="relative z-[1] h-0 w-full">
            <button
              type="button"
              onClick={jumpToLatest}
              className={[
                'pointer-events-auto absolute bottom-[8px] left-1/2 -translate-x-1/2',
                'flex items-center gap-[6px] whitespace-nowrap rounded-full',
                'border border-border-default bg-surface-raised/95 px-[12px] py-[6px]',
                'text-[12px] font-semibold text-text-body shadow-lg backdrop-blur-sm',
                'hover:text-text-primary focus-visible:outline focus-visible:outline-2',
                'focus-visible:outline-offset-2 focus-visible:outline-border-focus',
                'motion-safe:animate-[decke-chat-in_180ms_cubic-bezier(0.2,0.9,0.3,1)_backwards]',
              ].join(' ')}
            >
              <Icon name="chevron-down" size={14} className="shrink-0 text-icon-muted" />
              Jump to latest
            </button>
          </div>
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
          <ApprovalCard
            title={asking[0].title}
            count={asking.length}
            // KEYED TO THE HELD CALL, which fixes a trust defect by
            // construction. This used to be `previewOf(messages)`, which
            // scanned BACKWARDS for the most recent finished tool call of any
            // kind and showed its summary — on the assumption, which its own
            // comment conceded was an assumption, that the last finished call
            // is the dry run of the thing being asked about. Any tool
            // finishing after the dry run displaced it, and a consent dialog
            // showing another call's result is worse than one showing nothing.
            preview={approvalPreview(asking[0].toolCallId)}
            choices={approvalChoices}
            onChoice={onApprovalChoice}
            onAccept={onApprove}
            onDeny={onDeny}
            busy={approvalBusy}
          />
        ) : null}

        {/*
          THE COMPOSER IS A CARD, and the band beneath it is gone.

          It used to be a `<form>` with no background, border, radius or shadow,
          holding a `rounded-full` input and a `rounded-full` button — a pill and
          a circle floating on the scrim. The "dead grey band" along the bottom
          of the phone panel was never a rendered element at all: it was the
          padding, the right gutter and the whole unpadded safe-area strip, seen
          THROUGH to the scrim. There was nothing there to restyle; there had to
          be something there.

          SAFE AREA, and this panel was the only fixed surface in the codebase
          without it. Every other one has it — the app header, the sheet
          primitive, the auth card, the landing. On an installed PWA
          (`viewport-fit=cover` plus a translucent status bar) that meant the
          composer sat under the home indicator. `max()` rather than a bare
          `env()` so it keeps its ordinary padding on hardware with no inset,
          which is the idiom the dev ribbon already uses.

          The outer wrapper carries the inset and the inner card carries the
          look, so the card's rounded corners never end up hard against the
          bottom of the screen.
        */}
        <div
          className="pointer-events-auto shrink-0 px-[16px]"
          style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
        >
        <form
          ref={composerRef}
          onSubmit={submit}
          // MEASURED BY `DeckeHost` TO DECIDE HOW TALL HE IS. His size used to
          // be a viewport fraction capped at 300px, which on a laptop made him
          // as tall as he is when nobody is talking to him — standing in the
          // middle of the conversation with his shoulders across it. He is
          // beside a composer now, so the composer is what he is scaled
          // against, and the two cannot drift because there is only one number.
          {...{ [COMPOSER_LANDMARK]: '' }}
          style={dropPx ? ({ '--decke-drop': `${dropPx}px` } as React.CSSProperties) : undefined}
          className={[
            'decke-composer decke-composer-card flex items-center gap-[8px] p-[8px]',
            dropPx
              ? 'motion-safe:animate-[decke-composer-drop_360ms_cubic-bezier(0.2,0.9,0.3,1)_backwards]'
              : '',
          ].join(' ')}
          onAnimationEnd={() => setDropPx(0)}
        >
          {/*
            A TEXTAREA THAT GROWS, not a single-line input.

            This is the control the owner singled out — *"I don't really like
            the design of the input at all"* — and putting a card around a 40px
            `<input>` restyled everything except it. One line is the actual
            complaint: he dictates card lists to an assistant, and "add a
            Charizard, two Pikachu and the reverse holo Gardevoir" scrolls out
            of sight while you are still typing it, so you cannot read back what
            you are about to send.

            ENTER SENDS, SHIFT+ENTER BREAKS THE LINE. That is the convention
            everywhere this is used, and getting it the other way round makes
            the common action two keys.

            It grows to six lines and then scrolls: unbounded, one long dictated
            list would push the conversation off the top of the panel and take
            his mark with it, since his height is measured from this card.
          */}
          <textarea
            ref={inputRef}
            value={draft}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit(e)
              }
            }}
            // SHORT ENOUGH TO FIT BESIDE HIM. Measured on a 393px phone: he
            // legitimately occupies 129px of the width — he stands beside the
            // composer by design — which leaves the field 174px, and "Ask about
            // your collection…" needs 190. It truncated mid-word on the one
            // control whose job is to invite you to type. The empty state above
            // says the long version in full; the placeholder only has to say
            // the box is for typing.
            placeholder="Ask about your cards…"
            aria-label="Message Deck-E"
            className={[
              'min-w-0 flex-1 resize-none bg-transparent px-[10px] py-[9px]',
              'text-[14px] leading-[22px] text-text-primary outline-none',
              'placeholder:text-text-muted',
            ].join(' ')}
            style={{ height: composerH }}
          />
          {/*
            STOP, AND IT IS THE SAME BUTTON.

            `useDeckeChat` has returned a `stop()` since it was written and
            NOTHING EVER CALLED IT. Worse, `submit` early-returns while `busy`,
            so sending again could not abort either — measured: with an
            interrupt typed and entered, the leg streamed 47 KB to completion.
            There was no reachable way to stop a turn at all.

            That is not a cosmetic gap. Everything downstream is built to honour
            an abort — the RLS session destroys its connection, the API client
            drops its wait, a deep sub-agent stops billing Opus — and none of it
            could ever fire, because the signal had no source. A deep turn is
            now up to five minutes long; a reader who has changed their mind
            needs a way to say so that is not closing the tab.

            One button rather than two, because the composer is 40px of a phone
            screen and "send" and "stop" are never both available.
          */}
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop"
              className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full bg-surface-tertiary text-text-primary"
            >
              <span className="block h-[12px] w-[12px] rounded-[2px] bg-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!draft.trim()}
              aria-label="Send"
              className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full bg-action-primary text-action-primary-text disabled:opacity-40"
            >
              <Icon name="chevron-right" size={18} />
            </button>
          )}
        </form>
        </div>

        {/* the conversation column ends here; what follows anchors to the
            PANE, not to the column */}
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
              // SAFE-AREA AWARE, because the composer above it now is. Padding
              // the composer up off the home indicator without moving his mark
              // by the same amount would drop him relative to the input he is
              // meant to stand beside — the overlap that puts him BESIDE the
              // composer rather than in a row above it is the whole point of
              // this box's geometry.
              bottom: `calc(${PARK_BOTTOM}px + env(safe-area-inset-bottom))`,
              width: `${parkW}px`,
              height: `${parkH}px`,
            }}
          />
        ) : null}
      </div>
    </>
  )
}
