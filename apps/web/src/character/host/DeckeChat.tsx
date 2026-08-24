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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { lockScroll, unlockScroll } from '../../components/ui/Sheet'
import { Icon } from '../../components/Icon'
import type { DeckEInstance } from './runtime'
import { DeckeScreen, type ScreenSpec } from './DeckeScreen'
import { ChatMarkdown } from './chat/ChatMarkdown'
import { ThinkingRow } from './chat/ThinkingRow'
import { ToolRow } from './chat/ToolRow'
import { toolRowFromChip } from './chat/toolRowState'
import { CreditChip, DeckeNotice, type NoticeTone } from './chat/DeckeNotice'
import { deepRequestLine } from './chat/deepRequest'
import { HistoryMenu } from './chat/HistoryMenu'
import { TranscriptExit, TranscriptPane } from './chat/TranscriptView'
import {
  creditHeaderLabel,
  creditState,
  outOfCreditsDetail,
  outOfCreditsLine,
  TOP_UP_LABEL,
  type CreditBalance,
} from './chat/creditState'
import { ApprovalCard } from './chat/ApprovalCard'
import type { ApprovalPreview, Choices, RowChoice } from './chat/approvalCardState'
import type { PendingApproval, ToolChip } from './useDeckeChat'
import {
  chooseOpeners,
  noteShown,
  openerStore,
  readLastSaid,
  readOpenerLog,
  replyAnnouncement,
  writeLastSaid,
  writeOpenerLog,
  type Opener,
} from './deckeChatState'
import { composeGreeting, GREETINGS, SUBHEADS } from './deckeVoice'
import { useDeckeUserName } from './deckeIdentity'

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

/** The composer's auto-grow bounds. One line to six, then it scrolls: unbounded,
 *  one long dictated list would push the conversation off the top of the panel
 *  and take his mark with it, since his height is measured from this card. */
const MIN_ROWS = 1
const MAX_ROWS = 6
const LINE = 22
const PAD = 18

/**
 * ── THE SEND ARROW, AND WHY IT IS DRAWN HERE ─────────────────────────────────
 *
 * *"Let's have the icon be a proper arrow, actually pointing up rather than to
 * the right, so an arrow with an actual stem."*
 *
 * `components/Icon.tsx` has no `arrow-up`. Its `chevron-*` set is deliberately
 * stemless — a chevron is a direction, an arrow is an instruction — and the one
 * stemmed arrow it owns, `download`, points the wrong way and carries a tray.
 *
 * **THIS BELONGS IN `Icon.tsx` AS `arrow-up`.** It is drawn locally because
 * that file is outside this pass's edit surface, and it is drawn to the icon
 * set's exact geometry — 24 viewBox, `currentColor`, 1.75 stroke, round caps,
 * `aria-hidden` — so moving it there is a cut and paste rather than a redraw.
 * The path is `download`'s, mirrored: one stem, one head.
 */
function SendArrow({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20V5m0 0l-6 6m6-6l6 6" />
    </svg>
  )
}


/**
 * ── THE NEW-CHAT SCREEN'S HEADLINE ───────────────────────────────────────────
 *
 * THE MOST-SEEN SCREEN IN THE WHOLE FEATURE. Every conversation starts here and
 * most sessions never leave it, and until now it was a 15px semibold line and a
 * 13px grey one — the size of a form-field label, sitting above a composer, in
 * a pane that is most of a 1,600px display. The owner's word for it was "lame",
 * and the specific ask was *"big, well-set text above a centred composer, the
 * way claude.ai does it."*
 *
 * So it is set as DISPLAY TEXT: 30px on desktop and 22px on a phone, tight
 * tracking, one clear line with the supporting sentence under it at a real step
 * down rather than a nudge.
 *
 * ── AND THE WORDS ARE HIS NOW, AND THEY MOVE ─────────────────────────────────
 *
 * The size was the first half. The second was that the sentence said
 * **"Ask Deck-E about your collection"** — a caption about a character, in the
 * third person, on a screen where that character is standing four inches to the
 * left having just flown across the page to talk to you. And it described a
 * SEARCH BOX: *"right now it's speaking mostly to being able to ask him
 * questions about the collection, but I'd like it to be more like 'hey username,
 * what's next'."*
 *
 * Both lines now come from `deckeVoice.ts`, vary per opening, know the hour, and
 * use the reader's own name when `/me` has one. The pools carry the rules; this
 * component just sets the type.
 *
 * CENTRED ONLY ON DESKTOP, for the reason the composer is: on a phone he
 * physically stands in the bottom-left corner of this panel, and text centred
 * inside a column that is being indented around him reads as misalignment
 * rather than as centring. Left-aligned beside him is the honest arrangement at
 * that size.
 */
export function DeckeEmptyIntro({
  centred,
  greeting,
  subhead,
}: {
  centred: boolean
  /**
   * HIS OWN WORDS, PASSED IN RATHER THAN COMPOSED HERE.
   *
   * The panel picks them once per opening (see `DeckeChat`) so they cannot
   * change under somebody's finger on a re-render, and the gallery can pin a
   * seed and photograph a known pair. Defaulted so a caller that has not been
   * updated still renders a sentence rather than an empty heading.
   */
  greeting?: string
  subhead?: string
}) {
  return (
    <div className={centred ? 'text-center' : ''}>
      <h2
        className={[
          'text-balance font-semibold tracking-[-0.02em] text-text-primary',
          centred ? 'text-[30px] leading-[38px]' : 'text-[22px] leading-[29px]',
        ].join(' ')}
      >
        {greeting ?? "What are we doing next?"}
      </h2>
      <p
        className={[
          'text-pretty text-text-secondary',
          centred ? 'mt-[10px] text-[15px] leading-[23px]' : 'mt-[6px] text-[13.5px] leading-[20px]',
        ].join(' ')}
      >
        {subhead ?? SUBHEADS[0].text}
      </p>
    </div>
  )
}

/**
 * ── THE OPENERS, NOW UNDER THE COMPOSER ──────────────────────────────────────
 *
 * Three real openers rather than a list of capabilities. A feature tour tells
 * someone what a thing can do; a prompt they can press shows them, and it
 * solves the harder problem — nobody knows what to type first. They fill the
 * composer rather than sending, so pressing one is a suggestion and not a
 * commitment.
 *
 * They are deliberately GENERIC. Openers drawn from what this reader actually
 * owns would be better and are worth doing, but they need a collection read at
 * panel-open time, and a starting screen that waits on a request is a starting
 * screen that is sometimes blank.
 *
 * THEY MOVED BELOW THE INPUT. Above it they were a third band of chrome between
 * the heading and the box, so the eye met the suggestions before it met the
 * thing they are suggestions FOR. Under the composer they read as an
 * afterthought in the useful sense — the box is the offer, these are ways to
 * take it — which is the arrangement every full-screen chat this is measured
 * against uses.
 */
export function DeckeOpeners({
  openers,
  onPick,
  centred,
}: {
  openers: readonly { readonly id: string; readonly text: string }[]
  onPick: (text: string) => void
  centred: boolean
}) {
  return (
    <ul className={['flex flex-wrap gap-[8px]', centred ? 'justify-center' : ''].join(' ')}>
      {openers.map((o) => (
        <li key={o.id}>
          <button
            type="button"
            onClick={() => onPick(o.text)}
            className={[
              // A QUIETER CHIP. It was `bg-surface-secondary` with a full
              // `border-default` — the same weight as the composer card it sat
              // above, so three of them read as three more cards. A chip is a
              // suggestion; it should sit BELOW the surface it offers to fill,
              // not level with it.
              'rounded-full border border-surface-tertiary bg-transparent',
              'px-[13px] py-[7px] text-[13px] leading-[18px] text-text-secondary',
              'motion-safe:transition-colors hover:border-border-default hover:bg-surface-secondary',
              'hover:text-text-primary focus-visible:outline focus-visible:outline-2',
              'focus-visible:outline-offset-2 focus-visible:outline-border-focus',
            ].join(' ')}
          >
            {o.text}
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * ── THE COMPOSER, AS ITS OWN COMPONENT ───────────────────────────────────────
 *
 * Lifted out of the panel for one reason and it is not tidiness: the empty
 * screen — the most-seen surface in the whole feature — could not be reviewed.
 * `/dev/chat-ui` renders every chat state from the REAL components, and the
 * new-chat screen is a heading, a composer and a row of openers arranged around
 * each other. With the composer welded into a 1,400-line panel that needs a
 * live `useDeckeChat`, the gallery could only have shown the heading, which
 * would have made it the one surface still reviewed by reading the code.
 *
 * The prop boundary was already there — draft, submit, busy, stop — so this is
 * a move rather than a redesign. Its height measurement and the auto-grow state
 * came with it, because nothing outside ever read them.
 */
export function DeckeComposer({
  draft,
  onDraftChange,
  onSubmit,
  busy,
  onStop,
  dropPx = 0,
  onDropEnd,
  inputRef,
  formRef,
  bottomPad = true,
  bottomPadPx = 20,
}: {
  draft: string
  onDraftChange: (next: string) => void
  onSubmit: (e: React.FormEvent) => void
  busy: boolean
  onStop: () => void
  /** The FLIP distance when the composer drops out of the middle. 0 = no flourish. */
  dropPx?: number
  onDropEnd?: () => void
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
  formRef?: React.RefObject<HTMLFormElement | null>
  /**
   * Whether this composer is the LAST thing in the column.
   *
   * It normally carries the panel's whole bottom inset. On the new-chat screen
   * the openers sit under it and carry that inset instead, so stacking both
   * would open a 40px hole between the box and its own suggestions.
   */
  bottomPad?: boolean
  /**
   * How much air under the card, in px, before the safe-area floor.
   *
   * *"Once we're in here it's too close to the bottom still — I want it up like
   * double the amount."* 20 was already a fix — it was 12, and hard against the
   * window edge — and it is right for the NEW-CHAT screen, where the composer is
   * a centred object with a whole pane around it. In a conversation the box is
   * the floor of a scrolling column and needs to feel like a floor, so
   * `DeckeChat` passes 40 the moment there is a transcript.
   *
   * `max()` still wins on hardware with a home indicator, where the inset is
   * larger than either number.
   */
  bottomPadPx?: number
}) {
  const ownInput = useRef<HTMLTextAreaElement | null>(null)
  const input = inputRef ?? ownInput

  /**
   * The composer's height, measured from its own content.
   *
   * MEASURED RATHER THAN COUNTED. Counting a newline is wrong the moment a line
   * wraps, which for a dictated card list is immediately. Setting the height to
   * `auto` and reading `scrollHeight` back is what the browser already knows.
   *
   * `useLayoutEffect` so it lands before paint — after paint, every keystroke
   * that adds a line shows one frame at the old height first, which reads as a
   * stutter on exactly the input someone is looking at while they type.
   */
  const [composerH, setComposerH] = useState(MIN_ROWS * LINE + PAD)
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    const next = Math.min(el.scrollHeight, MAX_ROWS * LINE + PAD)
    el.style.height = `${next}px`
    setComposerH(next)
  }, [draft, input])

  return (
  <div

    className="pointer-events-auto shrink-0 px-[16px]"

    // 20px, not 12. At 12 the composer sat hard against the bottom edge

    // of the window — "really fucking close to the bottom in a way that

    // looks bad". Every full-screen chat this is measured against leaves

    // appreciably more. `max()` still wins on hardware with a home

    // indicator, where the inset is larger than either number.

    style={{ paddingBottom: bottomPad ? `max(${bottomPadPx}px, env(safe-area-inset-bottom))` : 12 }}

  >

  <form

    ref={formRef}

    onSubmit={onSubmit}

    // MEASURED BY `DeckeHost` TO DECIDE HOW TALL HE IS. His size used to

    // be a viewport fraction capped at 300px, which on a laptop made him

    // as tall as he is when nobody is talking to him — standing in the

    // middle of the conversation with his shoulders across it. He is

    // beside a composer now, so the composer is what he is scaled

    // against, and the two cannot drift because there is only one number.

    {...{ [COMPOSER_LANDMARK]: '' }}

    style={dropPx ? ({ '--decke-drop': `${dropPx}px` } as React.CSSProperties) : undefined}

    className={[

      'decke-composer decke-composer-card flex items-end gap-[8px] p-[8px]',

      dropPx

        ? 'motion-safe:animate-[decke-composer-drop_360ms_cubic-bezier(0.2,0.9,0.3,1)_backwards]'

        : '',

    ].join(' ')}

    onAnimationEnd={onDropEnd}

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



      THE CONTROLS SIT AT THE BOTTOM OF THE CARD, not at its middle.
      `items-center` is identical to `items-end` at one row — the box and the
      button are both 40px — and wrong at six, where a centred send button
      floats halfway up a block of the reader's own text with nothing beside
      it. beautiful-ui's Prompt Bar reflows its whole control row under a tall
      draft for the same reason; this is the one-control version of that, and
      it is the part of that reference which is real here.

      WHAT IS DELIBERATELY NOT HERE: an attach button, a model picker, a
      dictation toggle. The Prompt Bar has all three and they are the most
      copied thing on that page, but there is no attachment path into
      `useDeckeChat`, no second model to choose between, and no speech
      pipeline — so each would be a control that opens nothing, which is worse
      than an empty row. The row is one send button because one action exists.
      When a second one does, this is where it goes.

      ENTER SENDS, SHIFT+ENTER BREAKS THE LINE. That is the convention

      everywhere this is used, and getting it the other way round makes

      the common action two keys.



      It grows to six lines and then scrolls: unbounded, one long dictated

      list would push the conversation off the top of the panel and take

      his mark with it, since his height is measured from this card.

    */}

    <textarea

      ref={input}

      value={draft}

      rows={1}

      onChange={(e) => onDraftChange(e.target.value)}

      onKeyDown={(e) => {

        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {

          e.preventDefault()

          onSubmit(e)

        }

      }}

      // SHORT ENOUGH TO FIT BESIDE HIM, AND THE BAR IS LOWER THAN IT LOOKS.

      //

      // He legitimately occupies ~129px of a 393px phone — he stands

      // beside the composer by design — which leaves the field about

      // 174px. "Ask about your collection…" needs 190 and truncated

      // mid-word. "Ask about your cards…" was the fix and was still too

      // long: PHOTOGRAPHED at 390px it wrapped to "Ask about your" +

      // "cards", and the second line was CLIPPED.

      //

      // Clipped rather than shown, because an empty textarea's

      // `scrollHeight` is one row — a placeholder is not content, so it

      // contributes nothing to the height the auto-grow effect measures.

      // The box is sized for one line while the placeholder needs two.

      // Growing the box instead would make an empty composer two rows

      // tall on every phone, which is worse than a shorter word.

      //

      // The empty state above says the long version in full; this only

      // has to say the box is for typing.

      placeholder="Ask Deck-E…"

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

    {/*

      A SEGMENT OF THE BOX, NOT A DISC BESIDE IT.

      *"I'd like this circle button to be a segment of the chat box instead —

      just a little square segment. Let's have the icon be a proper arrow,

      actually pointing up rather than to the right, so an arrow with an actual

      stem."*

      Both halves are one idea. A `rounded-full` disc in a 14px card is a

      DIFFERENT OBJECT sitting inside the composer; a 10px rounded square

      shares the card's own geometry and reads as part of it, which is what

      every composer this is measured against does. And a chevron pointing

      right is a *next* glyph — it belongs on a carousel — while an arrow with

      a real stem pointing UP is the send glyph the whole category has settled

      on, and it means the thing the control does: this goes up into the

      conversation.

      `arrow-up` had to be added to `Icon`; the existing `chevron-*` set is

      stemless by design and scaling one is how you get a fat tick.

      36px rather than 40, because a square reads larger than a circle of the

      same box — the corners are real area — and 40 made it the loudest thing

      in the composer.

    */}

    {busy ? (

      <button

        type="button"

        onClick={onStop}

        aria-label="Stop"

        className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-[10px] bg-surface-tertiary text-text-primary"

      >

        <span className="block h-[11px] w-[11px] rounded-[2px] bg-current" />

      </button>

    ) : (

      <button

        type="submit"

        disabled={!draft.trim()}

        aria-label="Send"

        className="btn-fill-primary flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-[10px] text-action-primary-text motion-safe:transition-opacity disabled:opacity-40"

      >

        <SendArrow />

      </button>

    )}

  </form>

  </div>
  )
}


/**
 * ── EVERYTHING HE SAYS ON ONE OPENING, PICKED ONCE ───────────────────────────
 *
 * A greeting, the line under it, and three openers. One function, one seed, one
 * read of storage — because the three are read as a single utterance and there
 * is no arrangement in which the greeting changing while the chips stay put
 * looks like anything but a glitch.
 *
 * The name is NOT part of this. It arrives from `/me` at its own pace and is
 * applied by `renderGreeting` afterwards, so a late-arriving name fills in the
 * sentence that is already on screen rather than replacing it with a different
 * one — see the comment at the call site.
 */
export type SaidThisOpening = {
  greetingId: string
  subheadId: string
  subhead: string
  openers: readonly Opener[]
}

export function chooseWhatToSay(opts: { seed?: number; now?: Date } = {}): SaidThisOpening {
  const { seed, now } = opts
  const store = openerStore()
  const last = readLastSaid(store)
  const g = composeGreeting({
    now,
    seed,
    memory: { greetingId: last.greetingId, subheadId: last.subheadId },
  })
  return {
    greetingId: g.greetingId,
    subheadId: g.subheadId,
    subhead: g.subhead,
    openers: chooseOpeners(undefined, readOpenerLog(store), {
      seed,
      avoid: last.openerIds ?? [],
    }),
  }
}

/**
 * The chosen greeting, with the name in it if we have one by now.
 *
 * Looks the pick up by id rather than re-rolling, so this is a pure formatting
 * step and a late `/me` cannot change WHICH thing he said — only whether it uses
 * your name. A pick that has been retired from the pool between two releases
 * falls back to the first entry rather than to an empty heading.
 */
export function renderGreeting(said: SaidThisOpening, name: string | null): string {
  const g = GREETINGS.find((x) => x.id === said.greetingId) ?? GREETINGS[0]
  const trimmed = (name ?? '').trim()
  return trimmed ? g.named.replace('{name}', trimmed) : g.anon
}

/** The mobile park box, as `DeckeHost` looks for it. */
export const PARK_LANDMARK = 'data-decke-park'

/**
 * Fallback stand point if the landmark is not in the DOM — he is parked before
 * the panel has laid out, or someone renders the host without the chat.
 * Deliberately the same lower-left CORNER the landmark describes.
 *
 * The corner, and no longer the same HEIGHT: the park box now stands on top of
 * the composer rather than in the corner beside it (see `PARK_ABOVE`). This
 * stays where it is on purpose — every case that reaches it is a case with no
 * composer on screen to stand above, and raising him by the height of a control
 * that is not there would leave him hovering for no reason a reader could see.
 */
export const STAND_MOBILE = { x: 0.14, y: 0.84 }

/** `--breakpoint-nav` in theme.css. Below this the panel goes full-screen. */
export const NAV_BREAKPOINT = 1068

/** The panel's own content padding, and the base the gutter is measured from. */
const CONTENT_PAD = 16

/** How far the park box sits from the panel's left edge. */
const PARK_LEFT = 10

/**
 * The floor the park box falls back to when the composer has not been measured.
 *
 * Only reachable for the frame or two before layout settles, and while he is out
 * of credits (the composer is replaced by a notice and there is nothing to stand
 * above). It is the OLD resting height, deliberately: if the measurement is
 * missing the honest thing is to put him where he used to be rather than to
 * guess a new number and have him jump when the real one arrives.
 */
const PARK_BOTTOM = 6

/**
 * AIR BETWEEN HIS FEET AND THE TOP OF THE COMPOSER.
 *
 * *"We had decided to have him not be this low anymore… he should be up above
 * this… move him up so he's just above the input."*
 *
 * Small on purpose. "Just above" is a specific instruction — he is meant to
 * stand ON the composer the way you stand on a step, not float in a band of his
 * own halfway up the panel — so this is a hairline of clearance that reads as
 * "not touching", not as a layout row.
 */
const PARK_ABOVE = 8

/**
 * How long the panel stays on screen after `open` goes false.
 *
 * KEPT IN STEP WITH `Sheet`'s `EXIT_MS` and with the `[data-closing]` rules in
 * theme.css, and matching the sheet rather than picking a new number is the
 * point: he is one of several things in this app that can be dismissed, and a
 * dismissal that takes noticeably longer here than in a card sheet reads as the
 * app being inconsistent rather than as him being special.
 */
const EXIT_MS = 220

/**
 * The same test `Sheet` runs, duplicated rather than imported because `Sheet`
 * keeps it private — and a two-line media query is a cheaper dependency than
 * widening another module's public surface for it.
 */
function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  )
}

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
  /**
   * A refusal, and it is a PART KIND rather than a string for one reason.
   *
   * When the server refuses a turn — signed out, not entitled, out of credit,
   * gateway down — the reply used to be replaced with a plain sentence and
   * rendered as prose. Photographed in the real app with the meter spent:
   * *"I've done as much as I can for you today — try me again tomorrow"*, drawn
   * exactly like an answer to a question. It is the same defect as a fluent
   * refusal reaching the model as a bare string (`deepOutcome.ts`), pointed at
   * the reader instead: an outcome nobody encodes is an outcome somebody has to
   * infer from tone.
   *
   * Encoded here so `DeckeNotice` can draw it as what it is, and so nothing
   * downstream has to sniff prose to find out. `messageText` deliberately does
   * not include it — a notice is not something he SAID, and the announcement,
   * the bubble and the transcript's live region all read that.
   */
  | { kind: 'notice'; id: string; tone: NoticeTone; title: string; detail?: string }

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
  credits,
  conversationId,
  onNewChat,
  onTopUp,
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
  /**
   * ── THE CREDIT BALANCE, IF THIS DEPLOYMENT HAS ONE ────────────────────────
   *
   * `undefined` — not loaded, or this build has no credit system. Renders
   * EXACTLY as it does today: nothing in the header, an ordinary composer. The
   * default is deliberately the state that shows nothing, so the presentational
   * half can ship before the balance does without asserting anything.
   *
   * The daily "10 deep questions" cap is being replaced by a balance you top up.
   * `creditState.ts` owns what counts as low and what he says when it is gone.
   */
  credits?: CreditBalance | null
  /** The conversation being recorded right now, so the list can mark it. */
  conversationId?: string | null
  /** Start a fresh conversation: clears the transcript and rotates the id. */
  onNewChat?: () => void
  /** Where "Top up" goes. Absent means no route yet, and the chip is not a button. */
  onTopUp?: () => void
}) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const parkRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLFormElement | null>(null)
  const [draft, setDraft] = useState('')
  const empty = messages.length === 0
  // `spent` gates the composer, and nothing else about the panel. History,
  // scrolling, the header and the approval card are all unaffected: running out
  // of credits stops him taking NEW work, it does not close what is open.
  const spent = creditState(credits ?? null) === 'empty'

  /**
   * ── THE PANEL OUTLIVES ITS OWN `open` PROP ────────────────────────────────
   *
   * *"The chat window should also animate out, always, rather than simply
   * disappearing."*
   *
   * `if (!open) return null` is the entire bug, and the reason it cannot be
   * fixed the way `Sheet` fixes it is that `Sheet` owns every one of its own
   * closers. Its scrim, its ✕ and its Escape all route through a private
   * `requestClose` that plays the exit and only THEN tells the caller — which
   * works because nothing outside a `Sheet` can close a `Sheet`.
   *
   * This panel is closed from outside constantly. `DeckeHost` drops `open` when
   * HE decides the conversation is over: `seeYouOut()` after he has walked the
   * reader to a page, the auto-retire after a presentation. Wrapping the four
   * click handlers would animate the closes the reader asked for and blink out
   * the ones he asked for — the half that matter most, because those are the
   * ones where the reader is watching him rather than the panel.
   *
   * So the interception happens at the PROP, not at the buttons: watch `open`
   * for a falling edge, keep rendering for `EXIT_MS` with `data-closing` on,
   * and stop. Whoever flipped it, and for whatever reason, gets the same exit.
   *
   * THE RISING EDGE IS HANDLED IN RENDER, not in the effect, and that is not
   * style. Half a dozen effects below gate on "the panel is up" and then touch
   * the DOM — the transcript's scroll listener reads `transcriptRef.current`
   * and returns early if it is null. Re-keying those to a `visible` that lags
   * `open` by a commit would run them against an empty ref and never re-run
   * them, because their deps would not have changed by the time the DOM
   * existed. Adjusting state during render (React's documented pattern for
   * exactly this) makes `visible` a strict superset of `open` with an IDENTICAL
   * rising edge, so those effects fire on the same commit they always did and
   * the only behaviour that changes is the one being fixed.
   */
  const [visible, setVisible] = useState(open)
  const [closing, setClosing] = useState(false)
  /**
   * Whether he was out on the page at the moment the close was asked for.
   *
   * FROZEN AT THE EDGE, because `minimised` is `DeckeHost`'s `travelling` flag
   * and the host clears it in its own effect one commit after `open` falls. An
   * arrival-triggered close would therefore un-minimise mid-exit: the docked bar
   * would vanish and the full panel would appear, at full size, purely in order
   * to fade away. Capturing the value on the falling edge means the exit plays
   * on whichever of the two forms the reader was actually looking at.
   */
  const [closingMinimised, setClosingMinimised] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) {
      setVisible(true)
      setClosing(false)
    } else if (visible) {
      setClosingMinimised(minimised)
    }
  }
  useEffect(() => {
    if (open || !visible) return
    // Reduced motion gets the old behaviour, and the old behaviour is CORRECT
    // for it: someone who has asked the system not to move things has asked for
    // the panel to be gone, not for a shorter version of it leaving.
    if (prefersReducedMotion()) {
      setVisible(false)
      return
    }
    setClosing(true)
    const t = window.setTimeout(() => {
      setVisible(false)
      setClosing(false)
    }, EXIT_MS)
    return () => window.clearTimeout(t)
  }, [open, visible])

  /**
   * WHICH FORM IS ON SCREEN — the docked bar, or the whole panel.
   *
   * One derived boolean rather than reading `minimised` at four call sites, so
   * that the freeze above cannot be honoured in one place and forgotten in
   * another.
   */
  const shownMinimised = closing ? closingMinimised : minimised

  /**
   * ── THE PAST CONVERSATION BEING READ, OR NULL FOR THE LIVE ONE ─────────────
   *
   * One id, held here rather than in a route, because reading a record is a
   * MODE of this panel and not a place in the app. Routing to it would put the
   * live conversation behind a browser Back button, and the live conversation
   * is the thing the reader is in the middle of.
   *
   * NOTHING ABOUT THE LIVE TURN IS TOUCHED WHILE THIS IS SET. `messages`,
   * `busy`, the abort controller and any held approval all live in the hook and
   * carry on exactly as they were; this only decides what the column draws. So
   * wandering into the archive mid-answer and coming back loses nothing, which
   * is the property that makes the archive safe to open at all.
   */
  const [viewingId, setViewingId] = useState<string | null>(null)
  const viewing = viewingId !== null
  const backToChat = useCallback(() => setViewingId(null), [])
  // A REF, because the Escape listener is registered once per `open` and would
  // otherwise close over the value of `viewing` at the moment the panel opened
  // — which is always `false`, so Escape inside a record would always have
  // closed the whole panel. Re-registering the listener on every change instead
  // would work and would also rebind a window listener on a state flip.
  const viewingRef = useRef(viewing)
  viewingRef.current = viewing

  // CLOSING THE PANEL LEAVES THE ARCHIVE. Reopening him is a new intention —
  // "talk to Deck-E" — and landing back in a transcript somebody read yesterday
  // would be the panel remembering the wrong half of what happened.
  //
  //
  // ── KEYED ON `visible`, READING `open`, AND BOTH HALVES ARE DELIBERATE ────
  //
  // WHAT it tests is `open`, because that is the prop that means "closed" and
  // the rule above is about closing. WHEN it tests is `visible`, because the
  // panel now stays on screen for `EXIT_MS` after `open` falls: firing on the
  // raw prop would swap an archived transcript back to the live conversation
  // for the last few frames of its own exit, and the reader would watch the
  // thing they were reading turn into something else on the way out.
  //
  // The read is never stale, because `visible` can only fall AFTER `open` has.
  // And a close that is cancelled mid-exit — reopened before the timer lands —
  // never moves `visible` at all, which leaves the record open: correct, since
  // the panel did not go anywhere.
  useEffect(() => {
    if (!open) setViewingId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above: the
    // dependency is the panel's visibility, not the prop it reads.
  }, [visible])

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

  /**
   * ── HOW HIGH THE COMPOSER'S TOP EDGE SITS ABOVE THE PANEL'S FLOOR ─────────
   *
   * In CSS pixels, so the park box can be expressed as "that, plus a gap". The
   * panel is `fixed … bottom-0`, so distance-from-the-viewport-bottom and
   * distance-from-the-panel's-floor are the same number and no second reference
   * element is needed.
   *
   * MEASURED, NOT DERIVED, for the reason the composer's own FLIP above states
   * and this one inherits: the composer's height is a 14px card around a
   * textarea that GROWS to six lines, sitting in a wrapper whose bottom padding
   * is 20 or 40 depending on whether anything has been said and is overridden
   * entirely by a home indicator. There is no constant that is right at more
   * than one viewport, on more than one device, holding more than one draft.
   *
   * The `ResizeObserver` is the auto-grow: typing a third line moves the top
   * edge without touching anything React knows about, and he has to come up
   * with it or he ends up standing in the text. Everything else that moves the
   * edge — the empty-state FLIP, a rotation, the credit notice replacing the
   * composer outright — re-runs the effect through its deps or its resize
   * listener.
   */
  const [composerTop, setComposerTop] = useState(0)
  useLayoutEffect(() => {
    const el = composerRef.current
    if (!el) {
      setComposerTop(0)
      return
    }
    const measure = () =>
      setComposerTop((prev) => {
        const next = Math.round(window.innerHeight - el.getBoundingClientRect().top)
        // Sub-pixel jitter from a rounding boundary would otherwise re-render
        // the whole panel — and re-fly him — several times a second while a
        // textarea animates its own height.
        return Math.abs(next - prev) < 1 ? prev : next
      })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [visible, shownMinimised, empty, spent, desktop])

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


  const [turnStartedAt, setTurnStartedAt] = useState(0)
  const wasBusyRef = useRef(false)
  useEffect(() => {
    if (busy && !wasBusyRef.current) setTurnStartedAt(Date.now())
    wasBusyRef.current = busy
  }, [busy])

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant') ?? null
  const lastAssistantId = lastAssistant?.id ?? null

  // ── What he says, and what he offers, on the new-chat screen ──────────────
  //
  // CHOSEN ONCE PER OPENING, not per render. Re-running the choice on every
  // keystroke would be nearly free — it is a pass over 24 items — but it would
  // also let the greeting and the three chips change under someone's finger the
  // moment the log was written, which is a worse bug than the one being fixed.
  //
  // ONE PICK FOR ALL THREE POOLS, for the same reason: a greeting that changed
  // while the openers stayed put would read as a glitch rather than as variety.
  const name = useDeckeUserName()
  const [said, setSaid] = useState<SaidThisOpening>(() => chooseWhatToSay())

  // THE NAME ARRIVES LATE, AND THE GREETING HAS TO SURVIVE THAT. `/me` is a real
  // request; on a cold session it lands after the panel has opened. Re-composing
  // when it arrives would swap the whole sentence a beat after it was read, so
  // instead the CHOSEN greeting is re-rendered with the name filled in — same
  // line, same rhythm, the reader's name appears in it. `composeGreeting` is
  // deterministic given the id, so pinning the seed to it reproduces the pick.
  const greeting = useMemo(
    () => renderGreeting(said, name),
    [said, name],
  )

  // RECORDED WHEN THEY ARE ACTUALLY ON SCREEN. Writing the sighting at choice
  // time would count an opening that never reached the empty state — the panel
  // opened on an existing conversation, say — and rotate a chip nobody saw.
  const openersLoggedRef = useRef(false)
  useEffect(() => {
    if (!open || !empty || openersLoggedRef.current) return
    openersLoggedRef.current = true
    const store = openerStore()
    writeOpenerLog(store, noteShown(readOpenerLog(store), said.openers))
    writeLastSaid(store, {
      ...readLastSaid(store),
      greetingId: said.greetingId,
      subheadId: said.subheadId,
      openerIds: said.openers.map((o) => o.id),
    })
  }, [open, empty, said])

  // Closing re-arms the choice, so the NEXT opening reads what this one wrote.
  // Doing it on close rather than on open means the fresh set is already in
  // place before the panel animates in, with no swap mid-flight.
  //
  // Which is now `visible` rather than `open`, because "no swap mid-flight" has
  // acquired a second flight. On an empty panel the greeting and the three
  // opener chips are the whole screen; re-rolling them the instant `open` fell
  // would rewrite every word on the panel during the 220ms it spends leaving.
  useEffect(() => {
    if (visible) return
    openersLoggedRef.current = false
    setSaid(chooseWhatToSay())
  }, [visible])

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
  //
  // ── AND THE LOCK IS HELD FOR THE WHOLE EXIT, NOT UNTIL `open` FALLS ────────
  //
  // This is the one thing the exit animation could easily have broken, and it
  // would have broken it spectacularly. `unlockScroll` restores the document's
  // real scroll offset, which is the very number the character's pinned station
  // differences against — so releasing the lock on the raw `open` prop hands
  // that solve a delta equal to the entire page scroll WHILE the glass panel is
  // still visibly on screen, and throws him across it in front of the reader.
  // Keying on `visible` means the page is frozen until the panel is genuinely
  // gone, and the 220ms of held scroll costs nothing: the CSS in theme.css has
  // already given every click through to the page, so the only thing waiting is
  // the wheel.
  useEffect(() => {
    if (!visible || shownMinimised) return
    decke?.returnHome()
    lockScroll()
    return () => unlockScroll()
  }, [visible, shownMinimised, decke])

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
    if (!visible) return
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
    // `visible`, so the restore lands when the panel is actually gone. On `open`
    // it would fire a frame into the exit, and the rAF fallback would then race
    // a launcher that has remounted UNDERNEATH a panel still sliding off it —
    // focus arriving somewhere the reader cannot yet see.
  }, [visible])

  // Escape closes; focus lands in the composer.
  //
  // ── UNLESS A RECORD IS OPEN, IN WHICH CASE IT CLOSES THE RECORD ────────────
  //
  // Escape unwinds one layer at a time, which is the only behaviour that lets
  // somebody press it without thinking. Closing the whole panel from inside a
  // transcript would throw away the live conversation to dismiss a thing the
  // reader opened two seconds ago and can leave with a button.
  //
  // The dropdown's own Escape runs BEFORE this one — it listens in the capture
  // phase and stops propagation — so the three layers unwind in the order they
  // were opened.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (viewingRef.current) setViewingId(null)
      else onClose()
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
    // `visible`/`shownMinimised` rather than the raw props. The transcript is no
    // longer torn down when he goes out on the page, so this is now the ONLY
    // thing that detaches the listener while he is minimised — and it stays
    // attached through the exit, where the last frames of a scroll deceleration
    // still want to be drawn.
    if (!visible || shownMinimised || !el) return
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
  }, [visible, shownMinimised, reflow])

  /**
   * Dismiss on a click that landed on nothing.
   *
   * See the comment at the transcript for why this is needed at all and what
   * each guard is protecting. `DISMISS_SLOP` is generous enough to survive a
   * trackpad twitch and far short of a scroll.
   */
  const downRef = useRef<{ x: number; y: number } | null>(null)
  const onSurfaceDown = useCallback((e: React.PointerEvent) => {
    downRef.current = { x: e.clientX, y: e.clientY }
  }, [])
  const onSurfaceClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target !== e.currentTarget) return
      const down = downRef.current
      downRef.current = null
      const DISMISS_SLOP = 6
      if (down && Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > DISMISS_SLOP) return
      // A release that finishes a text selection is not a dismissal. `toString()`
      // is empty for a collapsed caret, which is what an ordinary click leaves.
      if ((window.getSelection()?.toString() ?? '').length > 0) return
      onClose()
    },
    [onClose],
  )

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

  // `visible`, not `open`. See the state block at the top of this component:
  // the panel is still on screen for `EXIT_MS` after the prop falls, and this
  // is the line that used to make every close a blink.
  if (!visible) return null

  const lastAskedMsg = [...messages].reverse().find((m) => m.role === 'user')
  const lastAsked = lastAskedMsg ? messageText(lastAskedMsg) : undefined

  return (
    <>
      {/*
        MINIMISED: the conversation does not vanish while he is out on the page —
        it collapses to a bar showing the last thing the READER said, which is
        the context they need to make sense of what he is doing. What HE says
        goes to the speech bubble beside him instead, so the words are where the
        action is.

        No scrim, no scroll lock: the page has to be visible AND drivable for
        showing them something on it to mean anything — he may be scrolling the
        page under himself.

        ── AND IT IS A SIBLING NOW, NOT A SECOND `return` ────────────────────

        *"There's a hiccup where it kind of re-renders."*

        There was, and this is it. The bar used to be an early return, so
        toggling `minimised` swapped the element type React found in this slot —
        `<button>` where a `<Fragment>` had been — and React's reconciler cannot
        morph one into the other. It unmounted the entire panel and mounted a
        bar, then did the reverse on expand, replaying `sheet-scrim-in` and
        `decke-chat-in` from the top every single time. That is the hiccup: not
        a slow render, a REBIRTH, and it took the transcript's scroll position
        and the composer's focus with it each way.

        Rendering all three surfaces unconditionally and hiding two of them in
        CSS costs one idle DOM subtree and buys a stable tree — the swap becomes
        a repaint, the entrance animation plays once per OPENING as it always
        should have, and the transcript comes back exactly where it was left.

        The bar is the one surface that may use `hidden`, because it is the one
        with nothing to preserve: no scroll box, no focus, no text mid-typing.
        Its entrance replaying every time he goes out is correct — the bar IS
        arriving.
      */}
      <button
        type="button"
        onClick={onExpand}
        aria-label="Back to the conversation"
        data-closing={closing || undefined}
        className={[
          'decke-chat-bar fixed inset-x-[12px] bottom-[12px] z-[25] items-center gap-[10px]',
          shownMinimised ? 'flex' : 'hidden',
          // ── IT IS THE COMPOSER'S SMALLER SIBLING, NOT A GREY PILL ────────
          //
          // Measured at 1.3:1 before this: `text-muted` (#8b847e) on
          // `surface-raised/95` (#79716b), which is two greys four steps apart
          // on the same stone ramp. Unreadable is the polite word — at a
          // glance it is a dead slab with a smudge in it, and the smudge is the
          // reader's own question.
          //
          // The theme's composer-card comment already argued this exact case
          // and named this exact mistake: "raised" is stone-500, a colour sized
          // for a 56px circular button where a light disc reads as lifted, and
          // a full-width bar in it is "a pale slab across the bottom of a
          // near-black page". The fix is the same one the composer took —
          // `surface-secondary` with a `surface-tertiary` hairline and a real
          // shadow, because a card over a dark page is lifted by its edge and
          // its shadow, not by being lighter than everything.
          //
          // Which also makes it read as what it IS. This bar is the composer,
          // compacted: same background, same border, same 14px radius, same
          // elevation, in the same place at the bottom of the screen. The
          // reader is meant to recognise it as the conversation folded up
          // rather than as a new piece of chrome that has appeared.
          'rounded-[14px] border border-surface-tertiary bg-surface-secondary px-[14px] py-[10px]',
          'text-left shadow-elevated nav:inset-x-auto nav:right-[24px] nav:w-[420px]',
          'motion-safe:animate-[decke-chat-in_220ms_cubic-bezier(0.2,0.9,0.3,1)_backwards]',
        ].join(' ')}
      >
        {/* `text-body` (#cac6c4) on `surface-secondary` (#292524) measures
            8.9:1. It is the reader's own sentence quoted back at them and it
            has to be legible at a glance from across a page he is busy
            driving. */}
        <span className="min-w-0 flex-1 truncate text-[13px] text-text-body">
          {lastAsked ? `“${lastAsked}”` : 'Back to the conversation'}
        </span>
        {/* `icon-default`, not `icon-muted`: 4.1:1 against the card where muted
            manages 3.0 and misses even the non-text floor. */}
        <Icon name="chevron-down" size={16} className="shrink-0 rotate-180 text-icon-default" />
      </button>

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
        // NOT REACHABLE while he is out on the page or while the panel is
        // leaving, and `disabled` rather than a class because this is a real
        // control: hiding it in CSS would leave a full-viewport button in the
        // tab order over a page the reader has been sent to look at, and the
        // first Tab would land on "Close chat" spread invisibly across it.
        disabled={shownMinimised || closing}
        // The two attributes the CSS in theme.css keys off. `data-minimised`
        // takes the darkening AND the blur away — see the rule; `data-closing`
        // fades it out instead of deleting it.
        data-minimised={shownMinimised || undefined}
        data-closing={closing || undefined}
        style={{
          // THE WITHDRAWAL HAS TO BE INLINE BECAUSE THE PAINT IS. An inline
          // declaration outranks every selector in a stylesheet, so a
          // `[data-minimised]` rule reaching for the blur would lose silently
          // and the page he has taken the reader out to look at would stay
          // frosted. `data-minimised` still carries the opacity and the pointer
          // events, which nothing here sets.
          background: shownMinimised ? 'transparent' : 'var(--color-decke-scrim)',
          backdropFilter: shownMinimised ? 'none' : 'blur(var(--decke-scrim-blur))',
          WebkitBackdropFilter: shownMinimised ? 'none' : 'blur(var(--decke-scrim-blur))',
          top: desktop ? 0 : 'calc(var(--app-header-h) + env(safe-area-inset-top))',
        }}
        className={[
          'decke-chat-scrim fixed inset-x-0 bottom-0 cursor-default',
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
        // ── STILL IN THE DOM WHILE HE IS OUT, AND THAT NEEDS SAYING ────────
        //
        // The panel no longer unmounts when it minimises (see the docked bar
        // above for why), so a transcript and a composer now sit invisibly over
        // a page the reader has been sent to look at. `inert` is the whole of
        // the repair and it is not optional: without it the first Tab lands in
        // a composer nobody can see, and a screen reader walks a conversation
        // that is not on screen. It also covers the exit, where the panel is
        // visible but no longer accepting anything.
        //
        // `opacity` and pointer-events come from the `[data-minimised]` and
        // `[data-closing]` rules in theme.css rather than from Tailwind's
        // `hidden`, and the reason is written out there: `display: none` would
        // destroy the transcript's scroll box and reset it to the bottom on
        // every expand, which is half the "hiccup" this restructure removes.
        inert={shownMinimised || closing}
        data-minimised={shownMinimised || undefined}
        data-closing={closing || undefined}
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
          'decke-chat-panel pointer-events-none fixed bottom-0 right-0 z-[25] flex flex-col',
          // The entrance stays a utility and the EXIT lives in theme.css, which
          // is not an inconsistency — it is how the exit wins. A
          // `.decke-chat-panel[data-closing]` selector outranks a single-class
          // utility, so the two never have to be spelled as one conditional
          // expression and the entrance cannot be left on during the exit.
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
        {/*
          ── IT SPANS THE PANE, NOT THE MEASURE ──────────────────────────────

          *"Let's have this be bigger — not a lot bigger, but bigger — and also
          in Fraunces, and bring it over here. Let's also make the x button
          bigger and bring it over here. That's just mirroring kind of what
          claude.ai does."*

          Two "over here"s and they are the same instruction. This row used to
          be `mx-auto max-w-[760px]`, so on a 1,600px pane the name sat 400px in
          from the left edge and the ✕ 400px in from the right — both floating
          in the middle of the panel with a runway of nothing outside them,
          aligned to a text measure that has nothing to do with chrome. Every
          full-screen chat this is measured against puts its title hard against
          the leading edge and its close hard against the trailing one, because
          that is where the panel's edges ARE.

          The transcript keeps its 760px measure. Prose wants a measure; chrome
          wants the frame. They were one element and are now two.

          FRAUNCES AT 17px, and the size is what makes the serif legal: the
          `.font-display` block in `theme.css` says the display face "goes muddy
          below ~14px" and 15 was inside the margin where it reads as a mistake.
          17 is a real step up, still not a headline, and the name of a
          character is exactly the "named thing that is not a heading" that
          class exists for. `font-normal` because Fraunces at 400 already reads
          heavier than the sans at 600 beside it.
        */}
        <header className="flex w-full shrink-0 items-center gap-[10px] px-[16px] py-[9px] nav:px-[22px]">
          {/*
            `shrink-0 whitespace-nowrap`, AND IT IS NOT DEFENSIVE PADDING.

            Photographed at 390px the moment a third item joined this row: the
            name broke across two lines as **Deck-** / **E** and the header grew
            to 48px. A flex child's default is `min-width: auto`, so "Deck-E" was
            a legal wrap opportunity the moment the row wanted more room than it
            had — and a hyphenated character name is about the most obviously
            broken thing a panel can open with.

            The row's total at 390 is ~312px inside 358px of content box, so it
            fits; what it must not do is fit by BREAKING. Anything that has to
            give when the balance chip appears should give somewhere the reader
            can afford, which is why the chip itself is the elastic one.
          */}
          <span className="shrink-0 whitespace-nowrap font-display text-[17px] font-normal leading-[24px] text-text-primary">
            Deck-E
          </span>
          {/*
            EXPERIMENTAL, SAID OUT LOUD.

            He is gated to a short list of accounts on production — the server
            refuses `/api/chat` for anyone else, so this is not the access
            control and must not be mistaken for it. What it does is make the
            STATE honest to the people who can see him: a feature that only two
            accounts can reach, still changing weekly, should say so on itself
            rather than rely on those two remembering.

            Quiet on purpose. It sits beside the name in the panel's own muted
            type — a fact about what this is, not a warning, and not something to
            look at twice after the first time.
          */}
          <span
            className="shrink-0 whitespace-nowrap rounded-full border border-border-subtle px-[7px] py-[1px] text-[10.5px] font-medium uppercase leading-[15px] tracking-[0.04em] text-text-muted"
            title="Deck-E is experimental and changes often."
          >
            Experimental
          </span>
          {/*
            THE BALANCE LIVES HERE, AND ONLY WHEN IT IS GETTING LOW.

            *"Nothing shown normally; once it is getting low, surface it in the
            header and keep it there."* `creditHeaderLabel` returns `''` for a
            healthy or unknown balance, so this renders nothing at all in the
            ordinary case — which is most of the time and is the point.

            Beside the name rather than beside the ✕: it is a fact about him, and
            the trailing edge belongs to the one control that closes the panel.
          */}
          <CreditChip
            label={creditHeaderLabel(credits ?? null)}
            spent={creditState(credits ?? null) === 'empty'}
            onTopUp={onTopUp}
          />
          {/*
            ── THE HISTORY, TO THE RIGHT OF THE TITLE ────────────────────────

            *"To the right of the chat page title, I'd like a dropdown that has
            a chat history saved."* Which is where it is — and the ordering
            around it took a decision, because three things now want this row.

            `Deck-E` · `Experimental` · balance · **History** ·······  ✕

            The name and the two things that are FACTS ABOUT IT stay together at
            the leading edge; the one CONTROL comes after them; the trailing edge
            still belongs to the single control that closes the panel. The
            balance renders nothing at all unless it is running low, so in the
            ordinary case this button sits immediately beside the badge — which
            is literally "to the right of the title" — and in the rare case where
            the balance IS showing, the urgent chip is not pushed past a control
            to make room for it.

            It carries the WORD as well as the glyph at both widths. A bare clock
            icon is a thing you have to hover to identify, on a surface where
            half the readers are on a phone and cannot hover at all; the word
            costs ~46px and buys a control nobody has to learn twice.
          */}
          <HistoryMenu
            viewingId={viewingId}
            liveId={conversationId ?? null}
            onNewChat={() => {
              // Leaving a record open onto a transcript that has just been
              // emptied would show a saved chat with no way to tell it from
              // the new blank one.
              setViewingId(null)
              onNewChat?.()
            }}
            onOpenConversation={setViewingId}
            // A CONVERSATION DELETED WHILE IT IS BEING READ TAKES ITS OWN VIEWER
            // WITH IT. Leaving the transcript up after the row is gone would be
            // a document that no longer exists, and the next thing the reader
            // does with it — reload, share, come back — finds nothing.
            onDeleted={(id) => setViewingId((cur) => (cur === id ? null : cur))}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chat"
            className="pointer-events-auto ml-auto flex h-[38px] w-[38px] items-center justify-center rounded-full text-icon-default motion-safe:transition-colors hover:bg-surface-secondary hover:text-icon-hover"
          >
            <Icon name="close" size={22} />
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
            // FULL WIDTH, and the 760px measure moved INSIDE. See the scroller
            // below: what scrolls has to be the pane, not a strip in it.
            'flex w-full min-h-0 flex-1 flex-col',
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
            // A RECORD IS NEVER THE NEW-CHAT SCREEN. `empty` is about the live
            // conversation and stays true while a past one is open, so without
            // this the archive would inherit the centred no-transcript layout
            // and a five-turn record would be pinned to the middle of the pane.
            !viewing && empty ? (desktop ? 'justify-center' : 'justify-end') : '',
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
        {/*
          THE SCROLLBAR BELONGS AT THE WINDOW'S EDGE.

          This element used to be inside the `max-w-[760px]` column, so the
          scrollbar was drawn down the middle of the pane, floating beside the
          text with a foot of empty pane to the right of it. Nothing else does
          that — not claude.ai, not any full-screen chat, not this app's own
          pages — and it is one of those details that reads as "unfinished"
          without the reader being able to name why.

          So the SCROLLER is the full-width, full-height column and the MEASURE
          is a wrapper inside it. The two jobs were always separate and had been
          done by one element.

          `min-h-full` plus `flex-col` on that wrapper keeps `mt-auto` on the
          message list working: bottom-alignment is still an auto margin and
          never `justify-end`, because content pushed past a flex container's
          START edge is unreachable — `scrollHeight` comes back equal to
          `clientHeight` and the earliest messages cannot be scrolled to at all.
          That trap has already cost this codebase one unusable panel.
        */}
        {/*
          ── AND CLICKING THE EMPTY PART OF IT DISMISSES HIM ──────────────────

          *"I'd like that functionality to be extended to when we're actually in
          the chat as well."*

          It already worked on the new-chat screen and stopped working the
          moment anything was said, which looks like a bug in the scrim and is
          not. The scrim is a real `<button>` underneath the panel, and the
          panel is `pointer-events-none` so taps fall through to it — but the
          transcript takes its events BACK, deliberately (a drag that started in
          the padding band used to fall through and fail to scroll; that is
          measured, in the comment above). Once there is a conversation the
          transcript is `flex-1`, so it covers the pane, so nothing reaches the
          scrim.

          THE GUARDS ARE THE WHOLE OF IT, and each one is a way this could
          become a panel that closes when you did not mean it to:

           • **`target === currentTarget`** — the click landed on the scroller
             itself or on the measure wrapper, i.e. genuinely empty space. A
             click on a bubble, a row, a panel or a control never gets here.
           • **A drag is not a click.** `pointerdown`/`pointerup` within 6px.
             Flick-scrolling a phone transcript ends with your finger on empty
             space essentially every time.
           • **A selection is not a click.** He drag-selects tool rows on camera
             and likes that he can; releasing a selection must not close the
             panel underneath it.

          What it does NOT guard is a click very near him — and it does not need
          to, because he is painted by a canvas above this element and takes no
          pointer events at all. The owner said that case is fine.
        */}
        {viewing ? (
          /*
            ── THE ARCHIVE TAKES THE TRANSCRIPT'S PLACE, NOT A LAYER OVER IT ──

            A modal over the conversation would have put a record in front of a
            live turn, with the panel's own scrim between them and two scroll
            containers fighting for the wheel. Replacing the column is what makes
            the mode unmistakable, and it is also what lets the composer be
            GONE rather than covered — see `TranscriptView`, where that is the
            whole design.

            `key` on the id so switching conversations from the dropdown
            remounts rather than transitioning: the scroll position of the record
            you just left is not a sensible place to open the next one.
          */
          <TranscriptPane key={viewingId} id={viewingId} onBack={backToChat} />
        ) : (
        <div
          ref={transcriptRef}
          onPointerDown={onSurfaceDown}
          onClick={onSurfaceClick}
          className={[
            'decke-transcript-fade pointer-events-auto flex w-full flex-col overflow-y-auto',
            empty ? 'shrink-0' : 'flex-1',
          ].join(' ')}
        >
          <div
            onClick={onSurfaceClick}
            // NO `pb-` HERE. The bottom padding is derived from `--decke-fade`
            // in `theme.css`, because a mask DELETES the pixels under it: a 12px
            // padding beneath a 28px band cut the last line of his reply in
            // half. Two numbers that must stay in step do not live in two files.
            className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-[16px]"
          >
          {empty ? (
            /*
              THE HEADLINE ONLY. The openers moved below the composer — see
              `DeckeOpeners` — so what sits here is the one block of display text
              that the composer is the foot of.

              THE GUTTER IS PER-ELEMENT, NOT PER-BLOCK, and that is the whole
              reason `decke-shift` sits on the child rather than on the wrapper.
              He stands in the bottom-left corner, so only the things actually
              beside him need to move out of his way — but a single
              `decke-shift` on the wrapper indents the WHOLE block the moment its
              bottom edge overlaps him, which pushed a heading two hundred
              pixels above his head into a narrow column and wrapped it. It read
              as broken alignment rather than as a character standing there.
            */
            <div
              className={[
                'flex flex-col items-stretch py-[8px]',
                desktop ? 'pb-[26px]' : 'gap-[16px] pb-[16px]',
              ].join(' ')}
            >
              <div className="decke-shift">
                <DeckeEmptyIntro centred={desktop} greeting={greeting} subhead={said.subhead} />
              </div>
              {/*
                ON A PHONE THE OPENERS STAY ABOVE THE INPUT, and this is the one
                place the claude.ai arrangement does not survive the translation.

                Desktop puts them under the composer because that is where a
                new-chat screen puts them and there is a whole pane of room. A
                phone has neither half of that: the composer is pinned to the
                BOTTOM (`justify-end`, so the software keyboard cannot cover
                it), so "under the composer" is the last 40px of the screen —
                and it is also where Deck-E physically stands. Photographed at
                390px, three chips below the box ran under his head and the
                third one was half a character wide.

                Above the input on a phone they have the whole empty screen to
                sit in, and `decke-shift` steps them clear of him. Same
                components, same order in the DOM on desktop; the one thing that
                moves is which side of the box they are on.
              */}
              {!desktop && !spent ? (
                <div className="decke-shift">
                  <DeckeOpeners
                    openers={said.openers}
                    onPick={(text) => {
                      setDraft(text)
                      inputRef.current?.focus()
                    }}
                    centred={false}
                  />
                </div>
              ) : null}
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
                          {/*
                            `toolRowFromChip` WAS A BRIDGE AND IS NOW A BACKSTOP.
                            `deny` used to emit its "nothing was written" row as
                            `phase: 'ok'` — the phase for a call that SUCCEEDED —
                            so a refusal drew a tick, which is the owner's
                            *"there should be a little red x"*. `useDeckeChat`
                            emits `phase: 'declined'` directly now, so the
                            mapping no longer fires: it matches `ok` AND the
                            `-declined` id, and a real `declined` phase passes
                            straight through untouched.

                            Kept rather than deleted because it is pure, tested,
                            and costs one comparison — and because a transcript
                            that goes back to drawing a tick on a refusal is the
                            one regression here nobody would notice in review.
                          */}
                          <ToolRow data={toolRowFromChip(part.chip)} onRetry={onRetryTool} />
                        </ul>
                      )
                    }
                    if (part.kind === 'notice') {
                      // NOT a speech bubble. A refusal used to be pushed into
                      // the reply as plain text and drawn exactly like an
                      // answer — photographed with the meter spent: "I've done
                      // as much as I can for you today", indistinguishable from
                      // him telling you something. It is not something he said;
                      // it is something that happened TO the turn.
                      return (
                        <div key={part.id} className="decke-figure decke-shift">
                          <DeckeNotice tone={part.tone} title={part.title}>
                            {part.detail}
                          </DeckeNotice>
                        </div>
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
        </div>
        )}

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
        {/* NEVER OVER A RECORD. `atLatest` is measured from the LIVE scroller,
            which is unmounted while the archive is open, so its last reading is
            whatever it was when the reader left — and "Jump to latest" floating
            over a transcript from last week would scroll something that is not
            on screen. */}
        {!viewing && !empty && !atLatest ? (
          <div className="relative z-[1] mx-auto h-0 w-full max-w-[760px]">
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
          <div className="mx-auto w-full max-w-[760px]">
          <ApprovalCard
            title={asking[0].title}
            // What he understood the request to be. Null for a tool whose call
            // has a preview under it — there the ROWS are the restatement, and
            // saying it twice would be noise.
            request={deepRequestLine(asking[0].name, asking[0].input)}
            heldCalls={asking.length}
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
          </div>
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
        <div className="mx-auto w-full max-w-[760px]">
        {viewing ? (
          /*
            ── READING A RECORD: THE COMPOSER IS GONE, NOT DISABLED ───────────

            The same ruling as `spent` immediately below, applied to the same
            slot for the same reason, and it is the single strongest guard
            against the one failure this feature can have: somebody typing a
            question into a transcript they are only reading. A greyed box takes
            a keystroke and explains afterwards; a box that is not there cannot.

            It is also where the way out lives — see `TranscriptExit`.
          */
          <TranscriptExit onBack={backToChat} />
        ) : spent ? (
          /*
            ── OUT OF CREDITS: THE COMPOSER IS REPLACED, NOT DISABLED ─────────

            The owner's ruling, and the reason it is a ruling rather than a
            style: an input that is still there — greyed, or worse, live — takes
            a question, swallows it, and shows a modal afterwards. That is the
            PRETENDING this whole pass exists to remove. It is the same defect as
            answering as though a cancelled write had happened, one surface
            along, and a control that is gone cannot lie about what it will do.

            The panel still OPENS and the transcript above is still readable, so
            nothing they already have is taken away — which is the other half of
            the ruling, and why this is not a modal in front of the conversation.

            HE SAYS IT, IN THE FIRST PERSON. Not a system banner talking over a
            character standing four inches to the left of it.
          */
          <div className="px-[16px]" style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}>
            <DeckeNotice
              tone="limit"
              title={outOfCreditsLine()}
              detail={outOfCreditsDetail()}
              action={onTopUp ? TOP_UP_LABEL : undefined}
              onAction={onTopUp}
            />
          </div>
        ) : (
          <DeckeComposer
            draft={draft}
            onDraftChange={setDraft}
            onSubmit={submit}
            busy={busy}
            onStop={onStop}
            dropPx={dropPx}
            onDropEnd={() => setDropPx(0)}
            inputRef={inputRef}
            formRef={composerRef}
            bottomPad={!(empty && desktop)}
            // DOUBLE, ONCE THERE IS A CONVERSATION. See `bottomPadPx`: 20 is right
            // for a composer centred in an empty pane and reads as cramped when the
            // same box is the floor under a scrolling transcript.
            bottomPadPx={empty ? 20 : 40}
          />
        )}
        </div>
        {/*
          UNDER THE COMPOSER — ON DESKTOP, AND ONLY BEFORE ANYTHING HAS BEEN
          SAID. The phone copy of this lives above the input instead, inside the
          transcript block; the comment there says why.

          Once there is a transcript these are noise between the last answer and
          the box, so `empty` is the same flag the heading uses and the two
          halves of the new-chat screen appear and leave together.

          Outside the composer's own padded wrapper so the chips clear the safe
          area on their own terms and the card's rounded corners keep their gap.
        */}
        {/* `!viewing`: the openers are the new-chat screen's second half, and
            there is no new chat on screen while a record is. */}
        {empty && desktop && !spent && !viewing ? (
          <div
            className="pointer-events-auto mx-auto w-full max-w-[760px] shrink-0 px-[16px]"
            style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
          >
            <div className="decke-shift">
              <DeckeOpeners
                openers={said.openers}
                onPick={(text) => {
                  setDraft(text)
                  inputRef.current?.focus()
                }}
                centred={desktop}
              />
            </div>
          </div>
        ) : null}

        {/* the conversation column ends here; what follows anchors to the
            PANE, not to the column */}
        </div>

        {/*
          WHERE HE STANDS, as a box rather than a coordinate.

          `DeckeHost` flies him to its centre and the transcript measures its top
          edge to decide what has cleared him, so his position and the space kept
          for him are the same fact stated once.

          ── HE STANDS ON THE COMPOSER, NOT IN IT ────────────────────────────

          *"We had decided to have him not be this low anymore… he should be up
          above this… move him up so he's just above the input."*

          Said four times in one sitting, which is the tell that the previous
          answer was not a misunderstanding but a disagreement. THIS SUPERSEDES
          the 2026-08-23 "beside the composer" placement, whose comment used to
          sit here and argued the opposite case in the strongest terms: it
          offset him a hair from the panel's bottom-left corner so that "about
          half of him overlaps [the composer's band]", and it called that
          overlap "the point" — the thing that put him BESIDE the input rather
          than in a row of his own above it.

          It is not the point any more. Standing him in the corner buried his
          feet in the one control the reader is trying to use, and the reading
          it produced — a character half-sunk behind a text field — was never
          the "beside" it was reaching for. He now stands ON the composer's top
          edge with `PARK_ABOVE` of daylight under him: still bottom-left, still
          in the same column of the panel, still the same silhouette and the
          same gutter kept clear beside him. What changed is the floor he
          stands on.

          NOTE FOR THE DESKTOP CASE, which is NOT this box: on wide viewports
          `DeckeHost` parks him beside the composer itself and this landmark is
          not rendered at all. Nothing here moves him there.

          MEASURED, NOT OFFSET FROM THE BOTTOM. `composerTop` is the live
          distance from the panel's floor to the top of the composer card, so
          the home indicator, the empty-state FLIP and a textarea that has grown
          to four lines all move him by exactly the amount they moved the thing
          he is standing on — where the old `calc()` had to restate the safe
          area by hand and could only ever be right about one of the three.
        */}
        {!desktop && characterPx > 0 ? (
          <div
            ref={parkRef}
            {...{ [PARK_LANDMARK]: '' }}
            aria-hidden
            className="pointer-events-none absolute opacity-0"
            style={{
              left: `${PARK_LEFT}px`,
              bottom: composerTop
                ? `${composerTop + PARK_ABOVE}px`
                : // Not yet measured — one or two frames on open, and the whole
                  // time he is out of credits and the composer has been replaced
                  // by a notice. The old resting height, for the reason
                  // `PARK_BOTTOM` gives.
                  `calc(${PARK_BOTTOM}px + env(safe-area-inset-bottom))`,
              width: `${parkW}px`,
              height: `${parkH}px`,
            }}
          />
        ) : null}
      </div>
    </>
  )
}
