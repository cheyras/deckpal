/**
 * Deck-E's body, mounted once for the life of the tab.
 *
 * WHERE THIS RENDERS IS THE WHOLE POINT, and it is not `AppShell`.
 * `RootComponent` (`main.tsx`) returns one of two different element trees
 * depending on `isPublicPathname(pathname)`:
 *
 *     isPublic ? <AppShell><Outlet/></AppShell>
 *              : <AuthGuard><AppShell><Outlet/></AppShell></AuthGuard>
 *
 * Crossing that boundary — `/series` → `/decks` is the everyday case — changes
 * the element TYPE at that position from `AppShell` to `AuthGuard`, so React
 * unmounts the entire subtree and builds a new one. A canvas mounted inside
 * `AppShell` would tear down its GL context and reload 5.7 MB of character on
 * exactly the navigation the feature exists to survive.
 *
 * The only position that survives every in-app navigation is a SIBLING of that
 * conditional, inside `RootComponent`'s fragment — the slot `DevBackendRibbon`
 * already occupies. That is where this goes, and it is the reason it is a
 * component rather than something a route owns.
 *
 * The one case that still destroys him is a full document load, and there is
 * exactly one: `lazyRoute`'s stale-chunk recovery, which reloads only when the
 * import throws AND a service worker is controlling AND it is the first failure
 * this session. Conversation state is persisted for that; his POSE is not, on
 * purpose — after a reload he boots, which is the honest thing for a character
 * who just came back.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { DeckeBeacon } from '../../components/ui/DeckeBeacon'
import { isChromelessPathname } from '../../lib/landingRoute'
import { deckeEntitled, onDeckeEntitlementChange } from './entitlement'
import { DeckeButton } from './DeckeButton'
import {
  COMPOSER_LANDMARK,
  DeckeChat,
  messageText,
  NAV_BREAKPOINT,
  PARK_LANDMARK,
  STAND_DESKTOP,
  STAND_MOBILE,
} from './DeckeChat'
import { deckeHidden, onDeckeVisibilityChange } from '../deckePreference'
import { MARK_SETTLE_MS, MARK_WATCH_MS, markMoved, type MarkBox } from './markWatch'
import { DeckeBubble, type Rect } from './DeckeBubble'
import { DeckeFarewell } from './DeckeFarewell'
import { pickFarewell } from './deckeVoice'
import { openerStore, readLastSaid, writeLastSaid } from './deckeChatState'
import { useDeckeChat } from './useDeckeChat'
import {
  acquireDeckE,
  loadDeckeRuntime,
  releaseDeckE,
  type Beacon,
  type DeckEInstance,
} from './runtime'

/**
 * How much of himself he keeps while a phone is being used to talk to him.
 *
 * At full size he is 55% of a 390 px screen wide, which was fine when the panel
 * was an opaque sheet he stood in front of and wrong the moment the panel became
 * glass: he sat in the middle of the conversation with his shoulders across the
 * text. Half is small enough to live in the corner beside the composer and still
 * large enough to read as a character rather than an avatar.
 */
const CHAT_COMPACT = 0.5

/**
 * HOW TALL HE IS, and this is the ONLY place that decides.
 *
 * ONE WRITER, which is the part that was learned the hard way. An earlier
 * version had the chat panel set its own height for him, and the two callers
 * fought: every `ResizeObserver` fire — a phone toolbar sliding is enough — put
 * the page's value back and he grew again mid-conversation. So the chat does not
 * set a height; it is an ARGUMENT to the one function that does.
 *
 * The other half of that lesson still stands: `setCharacterHeight` DOLLIES THE
 * CAMERA rather than scaling him, so changing it moves the pixel-to-world
 * mapping for the whole scene and any position solved at the old distance lands
 * somewhere else. Callers must apply the height BEFORE solving a destination
 * against it — see the chat effect below, which does exactly that.
 *
 * 300 px suits a laptop and swallows a 390 px phone, so it scales with the
 * viewport.
 */
function characterHeightFor(w: number, h: number, compact: boolean): number {
  const full = Math.min(300, h * 0.3, w * 0.55)
  return Math.round(compact ? full * CHAT_COMPACT : full)
}

/**
 * How tall he is WHILE THE CHAT IS OPEN, from the composer he stands beside.
 *
 * The old answer was `characterHeightFor(..., compact)`, and `compact` was only
 * ever true below the nav breakpoint — so on a laptop his chat-open height was
 * his idle height, up to 300px. He stood in the middle of the conversation at
 * full size with his shoulders across it, which is the complaint.
 *
 * Sizing him from a viewport fraction was the wrong instinct twice over: it is
 * not what he is next to, and it left desktop and mobile as two unrelated
 * rules. He is beside a composer card. So the card is the ruler, and the
 * viewport is only a CEILING — which is what keeps a phone honest, where 3×
 * the composer would be a third of the screen.
 *
 * 2.9× is chosen so that his head clears the card and roughly half his body
 * overlaps its band, which is the relationship that reads as "standing beside
 * the input" rather than "sitting in a row above it" — the same relationship
 * the mobile park box has always described geometrically.
 */
const COMPOSER_MULTIPLE = 2.9
function characterHeightBeside(composerH: number, w: number, h: number): number {
  return Math.round(Math.min(composerH * COMPOSER_MULTIPLE, w * 0.28, h * 0.24))
}

// The composer-position watch's cadence, settle and threshold live in
// `markWatch.ts` with the decision they belong to — see the effect below, and
// that module's header for why a `.ts` sibling rather than three constants
// here.

/**
 * How the dismissal finds the launcher chip to fly back into.
 *
 * BY ITS ACCESSIBLE NAME, not by a data attribute. `DeckeButton` is icon-only
 * and this label is already the contract the visual harness opens him with
 * (`scripts/visual-harness/lib/session.mjs` — "neither element is guessable"),
 * so it is a name two independent things already depend on rather than a third
 * private hook. If it changes, the harness breaks loudly in the same commit.
 */
const LAUNCHER_SELECTOR = 'button[aria-label="Chat with Deck-E"]'

/**
 * The longest the dismissal will wait for him to land before scaling him away
 * anyway.
 *
 * A GUARD, NOT THE MECHANISM — the mechanism is `flyTo`'s `arrived`. Sampled
 * through a real dismissal at 1440x900, with the engine clock locked to the
 * wall clock so the two are comparable at all, he leaves at t+0 and lands at
 * t+1300..1400 ms. This is more than double that, chosen to be impossible to
 * reach on a flight that is actually flying — a guard that fires first IS the
 * defect it exists to catch, which is how the 520 ms timer it replaced behaved
 * every single time.
 *
 * What it DOES catch is a leg that never lands — the engine's own 600-frame
 * flight cap, or a controller disposed mid-trip. Reaching that state without a
 * timer leaves a full-size character parked over the page for the rest of the
 * session, which is what makes the guard worth having at all.
 */
const EXIT_GUARD_MS = 3000

/**
 * The travel leg launches when his MARK stops moving, not on a clock.
 *
 * The entrance used to wait a fixed 320 ms before doing anything at all —
 * 320 ms of a committed tap with nothing on screen but the panel sliding —
 * and a fixed number is also simply wrong on a slow first paint, where the
 * sheet is still mid-translate when it fires (probed: the park box read at
 * y≈1038 of a 664 px viewport, and he flew off the bottom). He grows at the
 * launcher from frame zero now, and the park is launched by watching the
 * mark's rect settle: STEP is the poll cadence, MIN is the floor (a cut
 * entrance still gets a readable beat at the chip), CAP is the give-up bound
 * after which he parks against whatever the page is doing and the composer
 * watch takes it from there.
 */
const PARK_SETTLE_STEP_MS = 90
const PARK_SETTLE_MIN_MS = 240
const PARK_SETTLE_CAP_MS = 2400

/**
 * How long the speech bubble stays after his last line, per character of it.
 *
 * "Show them the screen. Short line of text. Stays just long enough to read.
 * Small text bubble animates away. Then Deck-E himself hops back down to the
 * bottom corner to 'become' the chat bubble again." Reading pace is ~17
 * characters a second; 45 ms/char with a floor and a ceiling means a short
 * line breathes and a long one does not squat on the page for a minute — the
 * recorded wall of text sat unchanged for 63 seconds because nothing ever
 * dismissed it.
 */
const BUBBLE_READ_BASE_MS = 2600
const BUBBLE_READ_PER_CHAR_MS = 45
const BUBBLE_READ_MIN_MS = 4000
const BUBBLE_READ_MAX_MS = 10000
/** The bubble's own animate-away, before he flies. See `DeckeBubble`. */
const BUBBLE_OUT_MS = 260
/**
 * A presentation with NOTHING TO READ still ends. A turn that highlighted
 * something and said nothing used to leave him parked beside it for the life
 * of the page — the read-timer keyed off the bubble's text, and no text meant
 * no timer. The ring deserves a beat of attention; then he goes.
 */
const SILENT_RETIRE_MS = 3600
/**
 * The chat open/close legs play at twice pace — the owner: "I'd like his
 * travel from the chat bubble to the chat window and vice versa be twice as
 * fast … nice and snappy." A playback rate, not a physics change, and scoped
 * to exactly these legs: presentations, journeys and re-parks keep the
 * distance-ramped pace they had. See `FlyOptions.rate`.
 */
const SNAP_RATE = 2

type Phase = 'idle' | 'loading' | 'ready' | 'failed'

export function DeckeHost() {
  // NOT ON THE CHROMELESS ROUTES, and `/dev/decke` is the one that proves the
  // rule: that page builds its OWN controller on its OWN canvas, so mounting
  // this host there puts two Deck-Es and two WebGL contexts on one page. It is
  // not a theoretical clash — it hung the route hard enough to time out a 30 s
  // navigation the first time this host shipped without the guard.
  //
  // The rest of the list wants him gone for ordinary reasons: `/auth`,
  // `/signed-out` and `/authorize` are signed-out surfaces, `/design` is a
  // full-screen tool, and `/` is the marketing landing. Reusing the existing
  // predicate rather than writing a second list is deliberate — `landingRoute.ts`
  // says in as many words that the call sites MUST agree, and a private copy of
  // this set is exactly how they stop agreeing.
  const chromeless = useRouterState({
    select: (s) => isChromelessPathname(s.location.pathname),
  })
  /**
   * Has this reader asked not to have him on screen?
   *
   * READ SYNCHRONOUSLY IN THE INITIALISER, not in an effect. An effect would
   * mount the launcher, paint it, and then remove it — so someone who has
   * already said "hide him" would see him flash on every single navigation,
   * which is a worse insult than never having offered the setting.
   */
  const [hidden, setHidden] = useState(deckeHidden)
  useEffect(() => onDeckeVisibilityChange(() => setHidden(deckeHidden())), [])
  const [entitled, setEntitled] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [beacon, setBeacon] = useState<Beacon | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  /**
   * Where the launcher was when it was pressed, for the entrance to grow from.
   *
   * A ref rather than state: nothing renders from it, and it is read inside an
   * effect that must not re-run when it changes.
   */
  const launchRectRef = useRef<DOMRect | null>(null)
  const [live, setLive] = useState<DeckEInstance | null>(null)
  /** His on-screen height in CSS px, published so the chat can leave room. */
  const [charPx, setCharPx] = useState(0)
  /**
   * Wide enough for the desktop composition?
   *
   * Held HERE rather than in the panel, because crossing the breakpoint is not
   * only a layout change: it changes his size and moves his mark from a DOM box
   * in the panel's corner to a fraction of the open page. The panel used to own
   * this and the host re-read `window.innerWidth` inside its flight, so a
   * rotation while the chat was open re-laid the panel and left him where he
   * was — pinned to a landmark that had just unmounted, which `solveStation`
   * correctly refuses to re-solve. One writer, and the flight depends on it.
   */
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= NAV_BREAKPOINT,
  )
  /** Where he is on screen, sampled while he is out on the page. */
  const [himRect, setHimRect] = useState<Rect | null>(null)
  /**
   * The line he leaves behind on his way back to his corner.
   *
   * *"He can kind of go back over into his chat bubble and maybe a little
   * message comes up that's like 'I'll be right here when you need me'."*
   *
   * It lives HERE and not in the panel because `DeckeChat` returns `null` the
   * moment `open` goes false — which is the same tick the farewell has to
   * appear. The words, the pool and the no-repeat rule are `deckeVoice.ts`.
   */
  const [farewell, setFarewell] = useState<{
    text: string
    at: number
    /** The launcher chip's box at the moment he tucked into it — the line
     *  belongs to the chip he just became, not to wherever he was sampled
     *  mid-session. Null only if the chip could not be measured, and the
     *  farewell is simply skipped then: a line floating in the top-left
     *  corner (the old null-rect fallback) is worse than no line. */
    rect: Rect | null
  } | null>(null)
  /**
   * The farewell line, PICKED at close and SPOKEN at arrival.
   *
   * The owner: *"his message has appeared long before he's actually gone into
   * the chat button, which is also wrong."* Picking has side effects (the
   * no-repeat rule persists the id) and must happen while the close is still
   * an event; showing must wait ~700 ms for the flight home to land. A ref
   * carries the text across that gap, and the exit's `arrived` publishes it.
   */
  const pendingFarewellRef = useRef<string | null>(null)

  /**
   * Put him away, with a line.
   *
   * ONE function for both routes out — the ✕ or the background, and "take me to
   * my decks" — because they are the same event to a reader and a second copy is
   * a second place for the no-repeat rule to be forgotten.
   *
   * The last id is persisted rather than kept in a ref: the rule is about what a
   * PERSON last heard, and they close the panel far more often than they reload,
   * so a ref would let the same line greet them twice across two visits and read
   * as canned — the one thing the research says is worse than no line at all.
   */
  const seeYouOut = useCallback(() => {
    const store = openerStore()
    const said = readLastSaid(store)
    const bye = pickFarewell({ avoid: said.farewellId ?? null })
    writeLastSaid(store, { ...said, farewellId: bye.id })
    pendingFarewellRef.current = bye.text
    setChatOpen(false)
  }, [])
  /** True while he is away from the chat doing something on the page. */
  const [travelling, setTravelling] = useState(false)
  /** The bubble is animating away — the beat between "read" and "he leaves".
   *  See the retire effect below. */
  const [bubbleLeaving, setBubbleLeaving] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  /** A zero-width `100svh` strut. The always-visible height has to come from
   *  CSS, not `innerHeight` — see the measurement note below. */
  const probeRef = useRef<HTMLDivElement | null>(null)
  /**
   * The two bands he may not stand in, as ELEMENTS rather than numbers.
   *
   * Sized in CSS from the same custom properties the panel and the scrim use,
   * so the header's height, the notch and a sidebar collapse are all accounted
   * for without this file knowing any of those numbers — `AppShell` publishes
   * 64 on a phone and 78 on desktop, and hardcoding either would be wrong at
   * the other. Measuring an element is also what lets the existing
   * `ResizeObserver` re-fire the whole solve when any of them changes.
   */
  const topBandRef = useRef<HTMLDivElement | null>(null)
  const bottomBandRef = useRef<HTMLDivElement | null>(null)
  const deckeRef = useRef<DeckEInstance | null>(null)
  /**
   * Re-solve his size from the current viewport. Owned by the setup effect,
   * which is where the canvas and the controller are; exposed so the chat effect
   * can force the dolly to settle before it solves a destination against it.
   */
  const measureRef = useRef<(() => void) | null>(null)
  /** Read inside `measure`, which is not re-created when the chat opens. */
  const chatOpenRef = useRef(false)
  chatOpenRef.current = chatOpen
  const navigate = useNavigate()
  /** True while a journey step owns the transition. Read by the route watcher
   *  below; written by the chat's sequencer through `onStepping`. */
  const journeyStepRef = useRef(false)
  /** Has this turn navigated yet? Drives push-then-replace; see the navigate
   *  callback below. Reset when a turn starts. */
  const turnNavigatedRef = useRef(false)
  /**
   * The pathname a UI TOOL is navigating to right now, or null.
   *
   * The route watcher's missing distinction, made explicit. `journeyStepRef`
   * covers a journey's own hops, but a bare `goTo` — the tool the prompt tells
   * the model to use for "take me to X", and the one both of the owner's
   * spoken requests actually produced (the recording's own tool chips say so)
   * — navigated with nothing set, so the watcher tidied up mid-hop: stomped
   * `travelling`, which replayed the entrance and remounted the panel. Every
   * tool-driven navigation flows through the navigate callback below (journey
   * `click` steps press real links instead, and `journeyStepRef` covers
   * those), so the callback is the one honest place to mark it. CONSUMED by
   * the watcher on the very next pathname change, match or not — it describes
   * one navigation, never a policy, so it cannot leak an exemption to a
   * person's own click later.
   */
  const toolNavRef = useRef<string | null>(null)
  const chat = useDeckeChat(
    live,
    // PUSH THE FIRST HOP, REPLACE THE REST — and the first version of this got
    // it exactly backwards, in the way the comment it carried predicted.
    //
    // The complaint was that a journey of three hops buries the page someone
    // was actually on three presses back. Replacing unconditionally does not
    // fix that; it makes it worse. History `[A, B]` with the reader on B
    // becomes `[A, C]`, so Back from wherever he took them lands on A and **B
    // — the page they asked from — is unreachable by any number of presses.**
    // The very gesture the fix was written for now skips the very page it was
    // written to protect.
    //
    // So: the first navigation of a turn PUSHES, which keeps their page on the
    // stack and makes one Back return to it. Every hop after that within the
    // same turn REPLACES, which is what stops a five-step escort accreting five
    // entries. One Back to undo Deck-E, however far he walked.
    //
    // `firstHopRef` resets at the start of each turn, not on a timer: "one
    // turn" is the unit a reader thinks in — they asked once, so one Back
    // should undo it.
    //
    // KNOWN GAP, stated rather than papered over: a journey's `click` steps
    // press real `<Link>` elements, and those push through the router's own
    // default where this callback never runs. A journey that mixes `goTo` with
    // clicks therefore still accretes an entry per click. Closing that means
    // intercepting navigation at the router rather than at this seam, which is
    // a larger change than this pass should make on its way past.
    (to) => {
      const first = !turnNavigatedRef.current
      turnNavigatedRef.current = true
      // The PATH half only: the watcher compares this against the router's
      // `pathname`, which never carries a query — and a `goTo` may (the card
      // spotlight rides `?card=`). Comparing path-to-path or the exemption
      // silently stops matching the moment a query appears.
      toolNavRef.current = to.split('?')[0].split('#')[0]
      navigate({ to, replace: !first })
    },
    () => setTravelling(true),
    // THE EXEMPTION THE ROUTE WATCHER WAS WAITING FOR. Between a journey's own
    // hops the tidy-up is wrong: it would clear the ring he had just drawn and
    // pull him back to the composer before the next step could point at
    // anything. Between a PERSON's navigations it is exactly right. Nothing set
    // this until the sequencer existed, which is why the watcher shipped with
    // the flag already read.
    (on) => {
      journeyStepRef.current = on
    },
    () => {
      turnNavigatedRef.current = false
    },
    // ── HE TOOK THEM SOMEWHERE, SO HE GETS OUT OF THE WAY ────────────────────
    //
    // "You're on the decks page now" — said by a panel covering the decks page.
    // The owner: *"he didn't ever leave the chat. He's supposed to actually go
    // on to the next page."* Asked to choose, he picked the chat closing with a
    // line over the page changing behind it.
    //
    // A hop inside a journey or an escort does not reach here; only a standalone
    // arrival does, and only at the turn boundary, so whatever he said about
    // arriving is already in the transcript to come back to.
    //
    // UNLESS HE IS PRESENTING. A turn can navigate AND then point at something
    // on the destination page (`goTo` with a selector, or `goTo` then `flyTo`)
    // — and closing at the turn boundary would cut the bubble off unread, over
    // the very thing he flew there to show. A live presentation owns its own
    // ending now: the bubble's read-timer retires him through the same
    // `seeYouOut`, just after a person could actually have read the line.
    () => {
      const s = deckeRef.current?.getState()
      if (s && (s.flying || s.highlighting || s.highlighted)) return
      seeYouOut()
    },
  )

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${NAV_BREAKPOINT}px)`)
    const on = () => setWide(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  useEffect(() => {
    let live = true
    const ask = () =>
      void deckeEntitled().then((ok) => {
        if (live) setEntitled(ok)
      })
    ask()
    // RE-ASKED WHEN THE IDENTITY CHANGES, and without this the answer is
    // whatever was true when the page loaded. Signed out on `/auth` that is
    // `false` — cached, because the gate fails closed — and signing in is a
    // client-side navigation, so nothing ever asked again and the launcher
    // never appeared.
    const off = onDeckeEntitlementChange(ask)
    return () => {
      live = false
      off()
    }
  }, [])

  // HE DOES NOT LOAD UNTIL SOMEBODY WANTS HIM, and there used to be an effect
  // here that broke that. It set `phase='loading'` on a `requestIdleCallback`
  // (4 s timeout) or a 1.5 s fallback, gated only on `entitled && !chromeless`
  // — never on a click, never on a hover. Every entitled visitor downloaded the
  // whole character on every page, whether or not they ever spoke to him.
  //
  // MEASURED, not estimated: 5,905,250 bytes of assets — glb 2,918,432, HDR
  // 1,608,057, atlas 1,069,793, playbook 186,833, cards 44,311, card back
  // 77,824 — plus the ~1.14 MB runtime chunk in a production build. It is the
  // owner's stated number-one complaint about this feature.
  //
  // DELETING IT RESTORES TWO DECISIONS THIS FILE ALREADY MADE, which is why it
  // is a restoration rather than a reversal, and why it is low risk:
  //
  //   1. The launcher is hidden while the chat is open because "two Deck-Es …
  //      is the exact thing the whole well design exists to avoid" (see the
  //      `DeckeButton` call below). The timer broke that invariant in the
  //      opposite direction: on the DEFAULT closed state of every page, the 3D
  //      body and the chip were both on screen at once. Reproduced on demand by
  //      `scripts/visual-harness/capture-decke.mjs --scene idle`, which reports
  //      `twoDeckEs: true` on desktop and mobile alike.
  //   2. `vite.config.ts:163-166` excludes these assets from precache on the
  //      premise that "the route is lazy, so the cost is paid only by whoever
  //      actually opens it." That premise was false. This makes it true.
  //
  // Loading now starts in exactly two places, both of them intent:
  // `DeckeButton`'s `onWarm` (pointer-enter, touch-start, focus) and `onOpen`.
  //
  // THE ACCEPTED COST, stated rather than discovered: a phone has no hover, and
  // `touchstart` beats `click` by around 100 ms, so mobile trades "already
  // there" for "tap, then wait" — a beat on a good connection and possibly
  // several seconds on a bad one. Nobody who never taps pays anything, which
  // was the point. The chip's loading state below is what covers that wait, and
  // it is load-bearing UI now rather than decoration.
  //
  // It also removed the only thing that ever loaded him before a booster-pack
  // rip. That killed rip-watching, deliberately and with the owner's ruling —
  // see `ripPresence.ts`.

  // WHEN THE PAGE CHANGES UNDER HIM, HE HAS TO NOTICE.
  //
  // Until this existed, the ONLY route subscription in the whole character host
  // was the `chromeless` selector above — a boolean deciding whether to render
  // at all. Nothing reacted to navigation. So when the reader moved to another
  // page:
  //
  //   - the speech bubble stayed pinned, holding an answer about a page that is
  //     no longer on screen. The owner saw exactly this;
  //   - the minimised bar survived, still describing a journey that had ended;
  //   - and his parked station still held a selector for an element on the page
  //     he had just left, so his anchor pointed at a ghost. `solveStation`
  //     correctly refuses to re-solve a landmark that has unmounted, which
  //     means he does not move — he simply stands where the old page used to
  //     have something.
  //
  // This has to land BEFORE the wayfinding work, not after. That phase makes
  // route changes routine *mid-turn*, and its sequencer will carry its own
  // private version of this rule for its own hops — which would have left the
  // common case, a person clicking a nav link themselves, still broken while
  // the rare case was handled.
  //
  // THE EXEMPTION IS A JOURNEY STEP, NOT `travelling`, and the distinction is
  // the whole point. `travelling` only means "a UI tool moved him at some point
  // this turn", so exempting on it would exempt precisely the case the owner
  // hit — navigating himself while Deck-E was out on the page with a bubble up.
  // A journey step owns its own transition and is expected to navigate; nothing
  // sets this yet, and the sequencer will.
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const travellingRef = useRef(false)
  travellingRef.current = travelling
  useEffect(() => {
    // Consumed FIRST, unconditionally: the token describes exactly one
    // navigation — this one — whether or not it matches, whether or not the
    // engine is even alive. A token left lying around is an exemption a
    // person's own later click could inherit.
    const toolDrove = toolNavRef.current === pathname
    toolNavRef.current = null
    const d = deckeRef.current
    if (!d) return
    // A journey step owns its transition COMPLETELY — the sequencer draws and
    // clears its own rings between its own hops.
    if (journeyStepRef.current) return
    if (toolDrove) {
      // A tool's own `goTo` owns the TIDY-UP — stomping `travelling` under its
      // pending flight is the measured teleport-back-and-regrow churn — but
      // not the ring: whatever was ringed lived on the page that just left,
      // and `travelAfterRoute` re-rings its own target on arrival if it has
      // one.
      try {
        d.clearHighlight()
      } catch {
        /* An engine that has gone away must not take a navigation with it. */
      }
      return
    }
    try {
      // The ring is the most obviously wrong thing to leave behind: it is
      // drawn around a rectangle that no longer means anything.
      d.clearHighlight()
    } catch {
      /* An engine that has gone away must not take a navigation with it. */
    }
    // Dropping `travelling` is what retires the speech bubble and gives the
    // transcript back — the bubble is derived from it, and the re-park effect
    // below is what flies him back to his chat mark once it flips.
    if (travellingRef.current) setTravelling(false)
    else if (!chatOpenRef.current && d.entryScale > 0.05) {
      // Defensive, not a code path the machine can reach: closed means the
      // exit tucked him away, so a VISIBLE character on a closed chat is a
      // failure being recovered from, and the corner is the honest recovery.
      try {
        d.returnHome()
      } catch {
        /* as above */
      }
    }
  }, [pathname])

  // SAMPLE HIS POSITION WHILE HE IS OUT, and only while he is out.
  //
  // Polled at 8 Hz rather than bound to the render loop. Re-rendering React
  // sixty times a second to move one bubble is the kind of thing that makes a
  // 3D character feel expensive, and a bubble that lags his flight by an eighth
  // of a second is not something anyone can see — the engine's own dev page
  // polls its readouts at 5 Hz for the same reason.
  useEffect(() => {
    if (!live || !travelling) {
      setHimRect(null)
      return
    }
    const tick = () => setHimRect(live.screenRect())
    tick()
    const id = window.setInterval(tick, 125)
    return () => window.clearInterval(id)
  }, [live, travelling])

  // He is "travelling" from the moment a UI tool moves him until the chat is
  // closed. That is what minimises the transcript and hands his words to the
  // bubble instead.
  useEffect(() => {
    if (!chatOpen) setTravelling(false)
  }, [chatOpen])

  // ── THE CHOREOGRAPHY: ONE MACHINE, TWO EDGES ────────────────────────────
  //
  // The old shape here was a single effect keyed on `[chatOpen, live, wide,
  // travelling]` whose body replayed the FULL entrance whenever any dependency
  // moved. A `travelling` flip with the chat already open therefore cut him to
  // a stale launcher rect, regrew him from nothing and re-parked — the
  // measured "hiccup", fired by nothing the user did — and a close flipped
  // `chatOpen` and `travelling` one render apart, so the exit tore down and
  // relaunched mid-flight with a fresh anticipation dip. WHAT IS ON SCREEN had
  // several authorities that could disagree; presence now has ONE.
  // `presenceRef` records whether he is in or out of the chat composition, the
  // effect below acts only on the EDGE, and everything that merely wants him
  // re-parked goes through the re-park effect after it instead of replaying an
  // entrance.
  //
  // The dolly ordering the old version enforced by hand — measure, THEN solve
  // a destination — still binds and is still honoured here, and
  // `DeckE.setCharacterHeight` now re-solves his station itself, so the
  // ordering is belt and the engine is braces.

  /**
   * Put him on his chat mark.
   *
   * A callback rather than a closure inside the effect because three things
   * run it: the entrance (once the panel has settled), the re-park effect (a
   * breakpoint crossing, or coming back from a presentation) and the composer
   * watch (his mark moving under him). `parkRef` mirrors it for callers that
   * must not capture a stale `wide`. `rate` is the entrance's snap — the
   * chip→mark leg plays at `SNAP_RATE`; every other caller parks at the
   * ordinary pace.
   */
  const park = useCallback((opts: { rate?: number } = {}) => {
    const d = deckeRef.current
    if (!d) return
    // A MARK THAT IS NOT ON SCREEN IS NOT A MARK. Probed on a cold mobile
    // load: the glb parse chokes the main thread while the sheet's entrance
    // animation is mid-translate, so the park box reads at y≈1044 of a 664 px
    // viewport — stable, because the animation itself is stalled — and a park
    // solved against it flew him off the bottom of the screen (the beacon
    // fired, truthfully). The engine also fails silently on a zero-area rect,
    // into the top-left keep-out corner. So every landmark park is gated on
    // the landmark actually being inside the viewport, and anything else
    // falls through to the fraction park, which is sane by construction —
    // the composer watch re-parks him onto the real mark once it settles.
    const onScreen = (el: Element | null): el is Element => {
      if (!el) return false
      const r = el.getBoundingClientRect()
      return (
        r.width > 0 &&
        r.top > -8 &&
        r.left > -8 &&
        r.bottom < window.innerHeight + 8 &&
        r.right < window.innerWidth + 8
      )
    }
    // The park box only exists while the phone panel is mounted AND he has
    // a measured size. `flyTo` THROWS on a selector that resolves to
    // nothing, so this asks rather than assumes — and falls back to the
    // same corner expressed as a fraction.
    if (!wide && onScreen(document.querySelector(`[${PARK_LANDMARK}]`))) {
      d.flyTo(
        { selector: `[${PARK_LANDMARK}]` },
        // `facing: -1` is screen-RIGHT. He stands in the panel's bottom-left
        // corner with the composer to his right, and a centre park returns no
        // facing (a point has no inward) — so without this, `flyTo`
        // re-asserts the boot default of screen-left and he stands with his
        // back to the conversation. The first thing the owner says in the
        // recording, said four times; the desktop call three branches down
        // was already fixed for exactly this and the fix never reached here.
        { depth: 'foreground', highlight: false, centre: true, facing: -1, rate: opts.rate },
      )
      return
    }
    // DESKTOP PARKS HIM BESIDE THE COMPOSER, not on a viewport fraction.
    //
    // An ordinary beside-park is what `flyTo` is FOR: `side: 'left'` puts him
    // outboard of the card's left edge with the usual gap, and a beside-park
    // is the branch of `solvePark` that RETURNS A FACING, so he turns to face
    // the thing he is standing next to.
    if (wide) {
      // `flyTo` THROWS on a selector that resolves to nothing, so ask — and
      // the same on-screen gate as the phone box, for the same stalled-
      // entrance reason.
      const composer = document.querySelector(`[${COMPOSER_LANDMARK}]`)
      if (onScreen(composer)) {
        d.flyTo(
          { selector: `[${COMPOSER_LANDMARK}]` },
          // `anchor: 'optical'`, not `centre` and not `bottom`.
          //
          // `centre` was the first version: the composer is 58px and he is
          // ~216 drawn, so matching middles hangs ~79px of him below it, and
          // against the bottom of the window that is off the edge —
          // "too low, and going off the bottom edge. Cut off."
          //
          // `bottom` fixed that and overshot. A base flush with the card's
          // baseline reads as him standing ON the card: "strictly aligned
          // with his very bottom corner, which makes him look like he's kind
          // of above the thing." `optical` sinks him far enough that the
          // card's baseline crosses his body. See `OPTICAL_OVERLAP`.
          { depth: 'foreground', highlight: false, side: 'left', anchor: 'optical', rate: opts.rate },
        )
        return
      }
    }
    const at = wide ? STAND_DESKTOP : STAND_MOBILE
    d.flyTo(
      { x: window.innerWidth * at.x, y: window.innerHeight * at.y },
      { depth: 'foreground', highlight: false, centre: true, rate: opts.rate },
    )
  }, [wide])
  const parkRef = useRef(park)
  parkRef.current = park

  /** Is he IN the chat composition or OUT of it? The edge detector: presence
   *  is the thing the entrance and the exit actually change, and a re-render
   *  is not an edge. */
  const presenceRef = useRef<'in' | 'out'>('out')
  /** Has this visit's first park happened yet? The re-park effect must not
   *  race the entrance's own scheduled park. */
  const parkedRef = useRef(false)
  /**
   * While true, `measure()` must not run.
   *
   * The close flips the bottom keep-out band, which fires the ResizeObserver,
   * which used to re-dolly the camera to the full-page height MID-EXIT — the
   * measured 260 → 452 px balloon on his way back into the button, and a
   * keep-out clamp that would shove his destination off the chip. The exit
   * holds the camera where the chat put it until he is gone, then restores
   * the page size while he is invisible, where a dolly costs nothing to see.
   */
  const holdMeasureRef = useRef(false)

  useEffect(() => {
    const d = deckeRef.current
    if (!live || !d) return

    if (chatOpen) {
      // ── THE WAY IN: grow WHILE the panel opens, travel as it settles. ────
      //
      // Measured before this existed: 1.30 s from committed tap to landed, of
      // which 0.43 s was dead air and 0.27 s a static scale-up — "chat window
      // up → wait → 'ok, I'm coming.'" The fix is concurrency, not haste: the
      // grow starts the same frame the panel starts opening, the hop launches
      // as the panel settles, and the grow's tail overlaps the hop — "he
      // should just be scaling up during the hop, really." Scale and flight
      // are independent per-frame machines composed in `applyPose`; nothing
      // fights.
      holdMeasureRef.current = false
      pendingFarewellRef.current = null
      setFarewell(null)
      // Measure FIRST: `setCharacterHeight` dollies the camera, and a
      // destination solved before the dolly lands somewhere else after it.
      // The composer is measurable the frame the panel mounts — its entrance
      // is a translate, which moves its box without changing its height.
      measureRef.current?.()
      let t = 0
      let raf = 0
      const schedulePark = () => {
        // WATCHED SETTLED, NOT WAITED OUT. `getBoundingClientRect` on an
        // element mid-transform reports where it IS, not where it lands — and
        // the fixed 320 ms this used to wait was a lie on a slow first paint:
        // probed on the mobile emulation, the sheet was still translating up
        // when the timer fired, the park solved against the box's
        // mid-transform rect at y≈1038 of a 664 px viewport, and he flew off
        // the bottom of the screen (the off-screen beacon fired, truthfully).
        // So the marks are POLLED until two consecutive reads agree — a
        // translate moves every frame, so agreement means the entrance is
        // actually over — with a floor so a cut (reduced motion) still gets a
        // beat of him at the chip, and a cap so a pathological page cannot
        // strand him there. The grow is playing the whole time, so a slower
        // panel costs a longer grow at the chip, never dead air.
        const read = () => {
          const key = (el: Element | null) => {
            if (!el) return 'x'
            const r = el.getBoundingClientRect()
            // An off-viewport mark can be perfectly STABLE — probed: the glb
            // parse stalls the sheet's entrance animation mid-translate for
            // hundreds of milliseconds, and two agreeing reads of a frozen
            // wrong place are not "settled". Flag it so stability cannot be
            // reached until the mark is actually where a mark can be.
            const off =
              r.top < -8 || r.left < -8 || r.bottom > window.innerHeight + 8
                ? '!'
                : ''
            return `${off}${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.height)}`
          }
          return (
            key(document.querySelector(`[${PARK_LANDMARK}]`)) +
            '|' +
            key(document.querySelector(`[${COMPOSER_LANDMARK}]`))
          )
        }
        let last = ''
        let waited = 0
        const tick = () => {
          waited += PARK_SETTLE_STEP_MS
          const now = read()
          const settled = now === last && !now.includes('!')
          last = now
          // At the cap he parks REGARDLESS — `park()` itself now refuses an
          // off-screen landmark and takes the fraction fallback, and the
          // composer watch re-parks him onto the real mark once it settles.
          if ((settled && waited >= PARK_SETTLE_MIN_MS) || waited >= PARK_SETTLE_CAP_MS) {
            raf = requestAnimationFrame(() => {
              measureRef.current?.()
              // The chip→mark leg, at snap pace — the entrance is the owner's
              // "twice as fast" leg. Every other park stays ordinary.
              parkRef.current({ rate: SNAP_RATE })
              parkedRef.current = true
            })
            return
          }
          t = window.setTimeout(tick, PARK_SETTLE_STEP_MS)
        }
        t = window.setTimeout(tick, PARK_SETTLE_STEP_MS)
      }
      if (presenceRef.current === 'out') {
        presenceRef.current = 'in'
        parkedRef.current = false
        const rect = launchRectRef.current
        const stillVisible = d.entryScale > 0.05 || d.getState().flying
        if (stillVisible) {
          // A reopen caught him mid-exit. He is on screen, so cutting him to
          // the launcher to regrow would be exactly the churn this machine
          // exists to end — he simply turns around: regrow from whatever
          // scale the dive left him at, and fly straight back to his mark.
          if (d.entryScale < 1) d.playEntry({ from: d.entryScale })
          parkRef.current({ rate: SNAP_RATE })
          parkedRef.current = true
        } else if (rect && rect.width > 0) {
          // Absent → grows out of the button → travels. The placement is a
          // cut, not a flight: he was never anywhere before this.
          d.flyTo({ rect }, { centre: true, highlight: false, instant: true })
          d.playEntry()
          schedulePark()
        } else {
          // Opened by something other than the button. Nothing to grow from,
          // so he simply takes his mark.
          d.setEntryScale(1)
          parkRef.current()
          parkedRef.current = true
        }
      } else if (!parkedRef.current) {
        // The effect re-ran mid-entrance (a dependency moved under it). The
        // grow is the engine's and survives; the park promise is ours and is
        // re-made.
        schedulePark()
      }
      return () => {
        window.clearTimeout(t)
        cancelAnimationFrame(raf)
      }
    }

    // ── THE WAY OUT: dive into the button, shrinking as he goes. ──────────
    //
    // "He should remain exactly where he was but quickly jump back to his
    // chat bubble and scale down to zero so that it looks like he's jumping
    // into his chat bubble/hiding." `scaleTo: 0` rides the flight itself, so
    // "gone" and "landed" are the same frame BY CONSTRUCTION — the 520 ms
    // timer that once vanished him in mid-air is not approximated better
    // here, it is structurally impossible. The destination is the chip, not
    // `returnHome`'s abstract corner, because "his spot" IS the chip.
    //
    // Reduced motion ships inside the same call, no second path: `flyTo`
    // cuts, the scale arrives with it, and `arrived` fires synchronously.
    if (presenceRef.current !== 'in') return
    presenceRef.current = 'out'
    parkedRef.current = false
    holdMeasureRef.current = true
    try {
      d.clearHighlight()
    } catch {
      /* an engine mid-teardown must not take the close with it */
    }
    const chip = document.querySelector(LAUNCHER_SELECTOR)
    const rect = chip?.getBoundingClientRect() ?? launchRectRef.current
    let finished = false
    const finish = (aborted: boolean) => {
      if (finished) return
      finished = true
      // A reopen took the flight over; the entrance owns every flag now.
      if (aborted) return
      const away = deckeRef.current
      holdMeasureRef.current = false
      if (away) {
        // BACK TO NOTHING, at a station the collapsed state can live with: a
        // `{rect}` station is a remembered box that every later resize would
        // re-solve an invisible character toward. Home is viewport-relative
        // and sane forever. Safe from inside `arrived` — the arrival branch
        // clears the track before it fires.
        away.setEntryScale(0)
        away.returnHome({ instant: true })
      }
      // Restore the page-size dolly while he is invisible, where a camera
      // move costs nothing to look at. The engine re-solves his (home)
      // station itself now.
      measureRef.current?.()
      // The farewell, AT the arrival, not at the click: he becomes the chat
      // bubble and THEN the bubble gets its line — "his message has appeared
      // long before he's actually gone into the chat button" was the
      // complaint. Anchored to the chip he just became; no chip, no line,
      // because a farewell floating in a corner is worse than none.
      const bye = pendingFarewellRef.current
      pendingFarewellRef.current = null
      const at = document.querySelector(LAUNCHER_SELECTOR)?.getBoundingClientRect() ?? rect
      if (bye && at && at.width > 0) {
        setFarewell({
          text: bye,
          at: Date.now(),
          rect: {
            left: at.left,
            top: at.top,
            right: at.right,
            bottom: at.bottom,
            width: at.width,
            height: at.height,
          },
        })
      }
    }
    if (rect && rect.width > 0) {
      d.flyTo(
        { rect },
        // `rate: SNAP_RATE` — the dive back into the chip is the other half of
        // the owner's "twice as fast" ask, and a quick exit is also what makes
        // "jumping into his chat bubble/hiding" read as one gesture.
        { centre: true, highlight: false, scaleTo: 0, rate: SNAP_RATE, arrived: finish },
      )
    } else {
      // No launcher to dive into — hidden by preference, or a close on a
      // route that never rendered one. He still leaves like somebody: shrink
      // on his own clock while flying to the corner, then settle.
      d.returnHome()
      d.playEntry({ from: d.entryScale, to: 0, durationMs: 420, onDone: () => finish(false) })
    }
    // A GUARD, NOT THE MECHANISM — see `EXIT_GUARD_MS`. What it catches is a
    // leg that never lands: the engine's own flight cap, or a controller
    // disposed mid-trip. Reaching that state without the guard leaves a
    // full-size character parked over the page for the rest of the session.
    const guard = window.setTimeout(() => finish(false), EXIT_GUARD_MS)
    return () => window.clearTimeout(guard)
  }, [chatOpen, live])

  // ── RE-PARK, WITHOUT RE-ENTERING ────────────────────────────────────────
  //
  // Everything that used to replay the whole entrance because it shared the
  // entrance's effect: crossing the breakpoint swaps which mark he stands on,
  // and coming back from a presentation (`travelling` → false) re-mounts the
  // panel and his mark with it. Both want exactly a measure and a park — a
  // flight from wherever he is to where he now belongs — and neither is an
  // entrance. `parkedRef` keeps this from racing the entrance's own first
  // park.
  useEffect(() => {
    if (!live || !chatOpen || travelling) return
    if (!parkedRef.current) return
    measureRef.current?.()
    parkRef.current()
  }, [live, chatOpen, wide, travelling])

  // ── THE ENDING A PRESENTATION NEVER HAD ─────────────────────────────────
  //
  // "Show them the screen. Short line of text. Stays just long enough to
  // read. Small text bubble animates away. Then Deck-E himself hops back down
  // to the bottom corner to 'become' the chat bubble again with something
  // like 'You know where to find me!' … the user's message bubble at the
  // bottom of the screen should go away too." Every piece of that already
  // existed — the farewell pool, the flight home, the dive — but only a full
  // manual close ever fired it, so a presentation just SAT there: the
  // recorded bubble was pixel-identical 63 seconds later, over the content it
  // described. This gives "finished showing something" the same graceful
  // ending as ✕: read-time passes, the bubble animates away, and `seeYouOut`
  // runs the close choreography — panel state retired, him diving into the
  // chip, farewell on arrival.
  //
  // Only an IDLE presentation retires: a turn still running (`busy`), a
  // pending approval (`asking`), or the reader pulling the transcript back up
  // (`travelling` → false) each cancel it by moving a dependency.
  const closeChatRef = useRef(chat.close)
  closeChatRef.current = chat.close
  const lastAssistant = chat.messages.filter((m) => m.role === 'assistant').at(-1)
  const bubbleText = chatOpen && travelling && lastAssistant ? messageText(lastAssistant) : ''
  useEffect(() => {
    setBubbleLeaving(false)
    if (!chatOpen || !travelling || chat.busy || chat.asking) return
    // A WORDLESS presentation retires too — on a shorter clock, because there
    // is nothing to read, only a ring to glance at. Keying the timer on the
    // bubble having text was how a highlight-and-say-nothing turn left him
    // parked beside a card for the life of the page ("he never left. He just
    // stayed parked there").
    const text = bubbleText.trim()
    const readMs = text
      ? Math.min(
          BUBBLE_READ_MAX_MS,
          Math.max(BUBBLE_READ_MIN_MS, BUBBLE_READ_BASE_MS + text.length * BUBBLE_READ_PER_CHAR_MS),
        )
      : SILENT_RETIRE_MS
    let out = 0
    const read = window.setTimeout(() => {
      if (!text) {
        // No bubble to animate away; he simply goes.
        closeChatRef.current()
        seeYouOut()
        return
      }
      setBubbleLeaving(true)
      out = window.setTimeout(() => {
        closeChatRef.current()
        seeYouOut()
      }, BUBBLE_OUT_MS)
    }, readMs)
    return () => {
      window.clearTimeout(read)
      window.clearTimeout(out)
    }
  }, [chatOpen, travelling, chat.busy, chat.asking, bubbleText, seeYouOut])

  // ── HIS MARK CAN MOVE WITHOUT ANYTHING TELLING HIM ──────────────────────────
  //
  // THE DEFECT, reported twice from two separate recordings: "okay so he should
  // have gone down with this and he did not, so he should be down here now" /
  // "Deck-E didn't ever come down to this bar, he's up here. Yeah, he needs to
  // move down."
  //
  // MEASURED, not reasoned about. Signed in at 1440x900, parked beside the
  // centred composer, then a message sent and the whole thing driven from the
  // live DOM:
  //
  //   composer   511.5 -> 822.0  (its bottom edge fell 310.5 px)
  //   his drawn  363-562 -> 362-561   (unchanged, to the pixel)
  //   resize()   0 calls   setKeepOut() 0 calls   flyTo() 0 calls
  //
  // So it was never a stale rect, never a `ResizeObserver` reporting the same
  // box, and never a park skipped because he was "already parked". NOTHING
  // ASKED. Setting `stationDirty` by hand in the same session moved him to
  // 668-882, correctly against the dropped composer — the solve was right all
  // along and only the trigger was missing.
  //
  // WHY EVERY EXISTING TRIGGER MISSES IT. `DeckE.resize` re-parks on a window
  // resize; `setKeepOut` re-parks when a band changes; the scroll listener
  // marks the station dirty. The empty -> conversation transition is none of
  // those: it swaps `justify-center` off the chat column, which moves the
  // composer 310 px down the pane without changing the window, the bands, the
  // scroll offset, or the composer's own box — so the host's `ResizeObserver`,
  // which watches the canvas, the svh probe and the two bands, never fires.
  //
  // WHY A POLL AND NOT AN OBSERVER. There is no observer for "this element
  // moved": `ResizeObserver` fires on size, and the size is identical.
  // `IntersectionObserver` would need a threshold ladder to approximate a
  // position. So this reads ONE rect at 10 Hz, only while the chat is open and
  // he is not out on the page — the same shape, and a lower rate, than the 8 Hz
  // sample the speech bubble already runs while he travels.
  //
  // A TRAILING DEBOUNCE, exactly as `DeckE.resize` uses and for the same
  // reason. The composer's first-message drop is a 360 ms keyframe animation,
  // so `getBoundingClientRect` reports it MID-FLIGHT for a third of a second; a
  // leading-edge park would aim him at a position the composer is still leaving.
  // The timer is restarted by every observed move, so the move that gets chased
  // is the last one.
  //
  // It also catches the cases nobody has complained about yet, which is the
  // point of fixing the class rather than the instance: the composer growing as
  // someone types a long message, an approval card appearing above it, the
  // openers disappearing, a phone's software keyboard.
  useEffect(() => {
    if (!live || !chatOpen || travelling) return
    const read = (): MarkBox | null => {
      const el = document.querySelector(`[${COMPOSER_LANDMARK}]`)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { top: Math.round(r.top), left: Math.round(r.left), h: Math.round(r.height) }
    }
    let last = read()
    let settle = 0
    const parkNow = () => {
      const d = deckeRef.current
      if (!d) return
      // NOT WHILE HE IS STILL ARRIVING. The panel has its own entrance, so the
      // composer moves during it too — and the entrance already ends in a park
      // solved against the settled rect. Re-arming rather than skipping is what
      // keeps a real move that lands mid-flight from being dropped.
      if (d.entryScale < 1 || d.getState().flying) {
        settle = window.setTimeout(parkNow, MARK_SETTLE_MS)
        return
      }
      // MEASURE, THEN MOVE — the order the chat effect above spells out.
      // `setCharacterHeight` dollies the camera, so a destination solved before
      // it lands somewhere else after it. This path can change the height as
      // well as the position: he is sized from the composer, and a composer
      // that grew a line is both taller and higher up.
      measureRef.current?.()
      parkRef.current()
    }
    const id = window.setInterval(() => {
      const was = last
      last = read()
      if (!markMoved(was, last)) return
      window.clearTimeout(settle)
      settle = window.setTimeout(parkNow, MARK_SETTLE_MS)
    }, MARK_WATCH_MS)
    return () => {
      window.clearInterval(id)
      window.clearTimeout(settle)
    }
    // `wide` because the two platforms park him on different marks, and the
    // watcher has to be rebuilt around whichever one is current.
  }, [live, chatOpen, travelling, wide])

  // ONE BOOLEAN, not `phase`, drives the setup effect.
  //
  // Keying it on `phase` directly is wrong twice over. It would re-run on the
  // loading -> ready transition this effect itself performs, tearing the
  // controller down and rebuilding it in a loop; and it would NOT re-run when a
  // chromeless route unmounts the canvas and a later navigation mounts a new
  // one, because `phase` is still 'ready' — leaving a live controller bound to a
  // canvas node that is no longer in the document, and a blank new canvas.
  // `!hidden` is here as well as at the early return. Today it is redundant —
  // a hidden launcher never renders, so nothing sets `phase` past `idle` —
  // but that is an accident of one code path, and this is the line that
  // decides whether a WebGL context exists. Someone who asked not to have him
  // should not get a canvas because a future effect learned to warm him.
  const active =
    !hidden && entitled && !chromeless && (phase === 'loading' || phase === 'ready')

  // Held once and shared, because the constructor below reads it and the effect
  // after it subscribes to it — two `matchMedia` calls for one question is two
  // answers that can disagree for a render.
  const reduceQuery = useRef<MediaQueryList | null>(null)
  if (!reduceQuery.current && typeof window !== 'undefined') {
    reduceQuery.current = window.matchMedia('(prefers-reduced-motion: reduce)')
  }

  // IT CAN CHANGE UNDER HIM. Someone turning the preference on mid-session is
  // asking for the motion to stop now, not at the next reload — and this is the
  // only place that can tell him, because he does not look.
  useEffect(() => {
    const mq = reduceQuery.current
    if (!mq) return
    const on = (e: MediaQueryListEvent) => deckeRef.current?.setReducedMotion(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  useEffect(() => {
    if (!active) return
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false

    let decke: DeckEInstance | null = null
    let ro: ResizeObserver | null = null
    let dprQuery: MediaQueryList | null = null
    let onDpr: (() => void) | null = null

    void (async () => {
      let runtime
      try {
        runtime = await loadDeckeRuntime()
      } catch {
        if (!cancelled) setPhase('failed')
        return
      }
      if (cancelled) return

      const acquired = acquireDeckE(canvas, (c) =>
        new runtime.DeckE({
          canvas: c,
          baseUrl: import.meta.env.BASE_URL,
          characterHeightPx: 300,
          startAt: 'home',
          clearColor: null,
          // THE HOST OWNS THE MEDIA QUERY, THE ENGINE OWNS THE BEHAVIOUR.
          //
          // Nothing in `character/decke/` reads `matchMedia`, deliberately —
          // the engine's own note about smooth scrolling says it honours the
          // preference "without this module having to know that exists", and
          // that philosophy is kept. It is handed a flag instead, and decides
          // for itself what an instant entrance and a cut arrival mean.
          reduced: reduceQuery.current?.matches ?? false,
          onError: () => setPhase('failed'),
          onBeacon: setBeacon,
        }),
      )
      decke = acquired.decke
      deckeRef.current = decke
      // A FRESH controller knows nothing, so neither may the choreography: a
      // reused one (StrictMode's synchronous remount, a quick canvas swap)
      // keeps his pose and his presence, but a fresh one boots at scale 0 —
      // and if the chat was open across the teardown (a chromeless route and
      // back), a stale presence of 'in' would skip the entrance and re-park a
      // character nobody can see. Reset, and the entrance effect brings him
      // in properly once `live` lands.
      if (acquired.fresh) {
        presenceRef.current = 'out'
        parkedRef.current = false
        holdMeasureRef.current = false
      }

      // MEASURE THE CANVAS, NOT THE WINDOW.
      //
      // `window.innerHeight` is the VISUAL viewport and moves by the height of
      // Safari's toolbars every time they slide. The canvas is `100lvh`, so its
      // box does not. Keying the drawing buffer to the number that moves, then
      // stretching it into a box sized by one that does not, is what "he becomes
      // more thin" was. A ResizeObserver on the canvas is both the right trigger
      // and the right value; a `resize` listener is neither.
      const measure = () => {
        if (!decke) return
        // NOT DURING THE EXIT. The close itself flips the bottom keep-out
        // band, which fires the ResizeObserver that calls this — and a
        // re-dolly plus a re-clamp mid-dive is the measured balloon-and-miss.
        // The exit's `arrived` runs the deferred measure once he is invisible.
        if (holdMeasureRef.current) return
        const w = Math.round(canvas.clientWidth) || window.innerWidth
        // TWO HEIGHTS, both CSS-derived. The canvas is `100lvh` (covers the
        // screen once the toolbar slides away); the probe is `100svh` (the part
        // visible whatever the toolbar is doing), and that is what he is placed
        // against. See `character/decke/viewport.ts`.
        const canvasH = Math.round(canvas.clientHeight) || window.innerHeight
        const h = Math.round(probeRef.current?.clientHeight ?? 0) || canvasH
        decke.resize(w, h, canvasH)
        // WHILE THE CHAT IS OPEN HE IS SIZED FROM THE COMPOSER, on both
        // platforms — one rule rather than a desktop branch and a phone branch
        // that were free to disagree, and did.
        //
        // The fallback is not defensive noise: `flyTo` and this measure both
        // run on the frame the panel mounts, and if the card has not laid out
        // yet a rect of zero would collapse him to nothing. The old formula is
        // the right thing to fall back TO, because it is what he was before.
        const composer = chatOpenRef.current
          ? document.querySelector<HTMLElement>(`[${COMPOSER_LANDMARK}]`)
          : null
        const composerH = composer?.getBoundingClientRect().height ?? 0
        const px =
          composerH > 0
            ? characterHeightBeside(composerH, w, h)
            : characterHeightFor(w, h, chatOpenRef.current && w < NAV_BREAKPOINT)
        // The PUBLIC method, not `decke.stage`'s: the dolly moves the camera,
        // and the controller's own wrapper is what re-solves his station in
        // the same frame — the invariant this file used to enforce by
        // hand-ordering call sites, now owned by the engine.
        decke.setCharacterHeight(px)
        // ── WHERE HE MAY NOT STAND ────────────────────────────────────────
        //
        // His canvas is at z-30, above the app chrome at 20, and that is
        // deliberate — "he has to be able to park beside and point at a nav
        // item." Phase B then made the chat's scrim stop covering the header,
        // and excluding the header from the SCRIM does not exclude it from HIM:
        // he would still paint over the thing that change exists to keep
        // prominent. `parkBeside` has clamped him HORIZONTALLY since it was
        // written; there was no vertical equivalent, and being clipped by the
        // top of the viewport is that missing clamp seen from the other side.
        //
        // It is a clamp, not a veto. Asked to present a nav item in the header
        // he is pushed DOWN until his head rests on the band and stays in the
        // item's column, still turned back across it — "beside" gains a
        // vertical component exactly when the horizontal one is forbidden.
        //
        // THE BOTTOM BAND IS ZERO WHILE THE CHAT IS OPEN, and that is not an
        // oversight. His phone park box deliberately overlaps the composer —
        // "about half of him overlaps it. That overlap is the point" — so a
        // composer-sized band would shove him off his own mark and re-break the
        // one placement the owner asked for by name. The exemption lives in the
        // moment rather than in a per-call flag.
        //
        // No horizontal band: the sidebar is a quarter of a desktop window and
        // it is WHERE THE NAV ITEMS ARE, and `parkBeside`'s edge exception
        // already flips him inboard of anything near an edge.
        decke.setKeepOut({
          top: Math.round(topBandRef.current?.clientHeight ?? 0),
          bottom: Math.round(bottomBandRef.current?.clientHeight ?? 0),
        })
        setCharPx((prev) => (prev === px ? prev : px))
      }
      measureRef.current = measure

      if (acquired.fresh) {
        try {
          await decke.load()
          if (cancelled) return
          // NOT OPTIONAL: he is metallic 0.85, and metal with nothing to reflect
          // renders near-black. Loaded after the mesh so he appears sooner.
          const hdr = await runtime.loadEnvironment(import.meta.env.BASE_URL)
          if (cancelled) return
          decke.setEnvironment(hdr)
        } catch {
          if (!cancelled) setPhase('failed')
          return
        }
      }

      measure()
      ro = new ResizeObserver(measure)
      ro.observe(canvas)
      if (probeRef.current) ro.observe(probeRef.current)
      // The bands too, so collapsing the sidebar or rotating into a different
      // safe area re-solves where he is allowed to be.
      if (topBandRef.current) ro.observe(topBandRef.current)
      if (bottomBandRef.current) ro.observe(bottomBandRef.current)

      // Watch the pixel ratio separately: dragging the window to an external
      // display changes `devicePixelRatio` without changing the canvas's CSS box
      // by a pixel, so the observer never fires. A `resolution` query is the
      // only event for it, and it must be re-armed after each change because the
      // query names the ratio it was built for.
      onDpr = () => {
        measure()
        arm()
      }
      const arm = () => {
        if (onDpr) dprQuery?.removeEventListener('change', onDpr)
        dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
        if (onDpr) dprQuery.addEventListener('change', onDpr)
      }
      arm()

      // HE FINISHES LOADING AT NOTHING, and this closes a hole that opening the
      // load up to intent would otherwise have punched straight back through
      // the invariant it was meant to restore.
      //
      // Warming is a HOVER. Before, the runtime arrived on a timer and the
      // canvas faded him in at his home corner — which, with the launcher chip
      // still sitting in that same corner, is the two-Deck-Es defect. Deleting
      // the timer fixed it for someone who never touches the button and
      // recreated it exactly for someone who hovers and then does not click:
      // half a second later he would simply appear, unbidden, beside his own
      // chip.
      //
      // So the last thing loading does is scale him to nothing. He is present,
      // started, and rendering — and a third of a pixel tall, until an
      // entrance is played. `playEntry` on open is what brings him.
      decke.setEntryScale(0)
      decke.start()
      if (!cancelled) {
        setPhase('ready')
        setLive(decke)
      }

      // A handle for verification harnesses, DEV ONLY — stripped from the
      // production bundle by the constant folding on `import.meta.env.DEV`.
      // Headless Chromium runs rAF at about 1 Hz, so a screenshot taken after a
      // wall-clock wait captures a still frame of a frozen loop. The only way to
      // photograph him is the recipe in `character/decke/README.md`: stop the
      // loop and step it by hand. That needs a reference, and unlike `/dev/decke`
      // this host has no route of its own to hang one off.
      if (import.meta.env.DEV) {
        ;(window as unknown as { __decke?: DeckEInstance }).__decke = decke
      }
    })()

    return () => {
      cancelled = true
      ro?.disconnect()
      if (onDpr) dprQuery?.removeEventListener('change', onDpr)
      measureRef.current = null
      deckeRef.current = null
      setLive(null)
      // Back to "no size", which is what the chat reads as "nothing to leave
      // room for". A stale height would reserve a gutter for a character that is
      // no longer on the page.
      setCharPx(0)
      // Deferred inside `releaseDeckE`, so StrictMode's synchronous remount
      // reclaims the same controller instead of reloading the character.
      releaseDeckE(canvas)
    }
  }, [active])

  // ── HE CAN BE TURNED OFF, AND THAT IS THE POINT ────────────────────────────
  //
  // Snapchat pinned My AI with no way to remove it: 3.05 -> 1.67 stars, one-star
  // share 35% -> 75%. The anger was measured to be about being unable to remove
  // it, not about answer quality — so being good is not protection, and this
  // guard is the whole remedy. Restored from Profile.
  //
  // Placed beside `entitled` and `chromeless` deliberately: this returns before
  // the canvas, the launcher and every effect that reaches for the runtime, so
  // hiding him also stops him costing anything.
  if (hidden) return null
  if (!entitled || chromeless) return null

  return (
    <>
      <div
        ref={probeRef}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 h-[100svh] w-0 invisible"
      />
      {/* The keep-out bands, measured rather than computed. Zero-width and
          behind everything, so they cost a layout box and nothing else. */}
      <div
        ref={topBandRef}
        aria-hidden
        className="pointer-events-none invisible fixed left-0 top-0 -z-10 w-0"
        style={{ height: 'calc(var(--app-header-h) + env(safe-area-inset-top))' }}
      />
      <div
        ref={bottomBandRef}
        aria-hidden
        className="pointer-events-none invisible fixed bottom-0 left-0 -z-10 w-0"
        style={{
          // Open: nothing, so his overlap with the composer survives. Closed:
          // enough to clear the PWA install pill, which is the only bottom
          // chrome he shares a corner with.
          height: chatOpen ? '0px' : 'calc(50px + env(safe-area-inset-bottom))',
        }}
      />
      {/* z-30 keeps him ABOVE the app chrome (`--z-chrome: 20`) on purpose: he
          has to be able to park beside and point at a nav item. Modals (100)
          and toasts (9999) still take precedence, which is correct. */}
      <canvas
        ref={canvasRef}
        aria-hidden
        className={
          'pointer-events-none fixed inset-0 z-30 h-[100lvh] w-full transition-opacity duration-500 ' +
          (phase === 'ready' ? 'opacity-100' : 'opacity-0')
        }
      />
      {/* Sits UNDER the canvas at z-25 and draws a ring with nothing in the
          middle — the character himself is rendered into that rectangle by a
          second scissored pass on the same canvas. It is a hole, not a picture. */}
      <DeckeBeacon beacon={beacon} onClick={() => deckeRef.current?.scrollIntoView()} />

      {/* The entry point. Hidden while the chat is open, because he has left
          the button and is standing in the panel — leaving a second copy of him
          in the corner would be two Deck-Es, which is the exact thing the whole
          well design exists to avoid. */}
      <DeckeButton
        // HIDDEN ONLY ONCE HE HAS ACTUALLY ARRIVED. `hidden={chatOpen}` was
        // right while the runtime was pre-warmed on a timer and wrong the
        // moment it stopped being: it unmounted the chip about 100 ms after the
        // tap, so the loading state would have been a flash and the panel would
        // have stood empty for the rest of the download. Keeping it until
        // `ready` is what makes the chip cover the wait, which is the whole of
        // the trade A1 accepted. On `failed` it stays too, as the way back.
        hidden={chatOpen && (phase === 'ready' || phase === 'idle')}
        loading={phase === 'loading'}
        failed={phase === 'failed'}
        overChat={chatOpen}
        onOpen={(rect) => {
          launchRectRef.current = rect
          setChatOpen(true)
        }}
        onWarm={() => setPhase((p) => (p === 'idle' ? 'loading' : p))}
        onRetry={() => setPhase('loading')}
      />

      <DeckeChat
        open={chatOpen}
        minimised={travelling}
        onExpand={() => setTravelling(false)}
        onClose={() => {
          // ENDS THE TURN, and settles anything he was waiting on. Closing used
          // to do neither, so closing while he was asking permission parked the
          // turn for the life of the page — verified, not suspected.
          chat.close()
          // HIS LINE IS PICKED BEFORE THE PANEL GOES, because picking it after
          // means picking it on a tick where nothing is left to say it.
          //
          // The last id is persisted rather than held in a ref: the no-repeat
          // rule is about what a PERSON last heard, and they close the panel far
          // more often than they reload the page — a ref would let the same line
          // greet them twice across two visits and read as a canned response,
          // which the research says is the one thing worse than no line at all.
          seeYouOut()
        }}
        decke={live}
        messages={chat.messages}
        onSend={chat.send}
        onStop={chat.stop}
        busy={chat.busy}
        asking={chat.asking}
        onApprove={chat.approve}
        onDeny={chat.deny}
        approvalPreview={chat.approvalPreview}
        approvalChoices={chat.approvalChoices}
        onApprovalChoice={chat.onApprovalChoice}
        approvalBusy={chat.approvalBusy}
        // THE LAST HOP. `creditState.ts`, `CreditChip` and the composer
        // replacement were all built and tested before this line existed, which
        // is the shape of defect this pass has now produced seven times: the
        // panel rendered `unknown` forever and looked completely correct.
        credits={chat.credits}
        // So the history list can mark the row the reader is actually in. It
        // cannot be inferred from the list itself — see `liveId`.
        conversationId={chat.conversationId}
        onNewChat={chat.newConversation}
        onRetryTool={chat.retry}
        desktop={wide}
        characterPx={charPx}
      />

      {/* His words while the transcript is minimised. Anchored to him and
          solved against the highlight AND his own silhouette so it can cover
          neither — see DeckeBubble. `leaving` is the retire effect's
          animate-away beat, played before he flies. */}
      {chatOpen && travelling ? (
        <DeckeBubble
          text={bubbleText}
          himRect={himRect}
          avoidSelector={live?.getState().highlighted ?? null}
          leaving={bubbleLeaving}
        />
      ) : null}

      {/* The line he leaves as he goes. Survives the panel unmounting — that is
          the whole reason it is mounted out here — and retires itself after
          `FAREWELL_MS`. Anchored to the LAUNCHER CHIP he just tucked into,
          captured by the exit's `arrived`: the live `himRect` is null by then
          (he is a third of a pixel tall), and the old null fallback was the
          top-left corner of the screen. */}
      {farewell ? (
        <DeckeFarewell
          key={farewell.at}
          text={farewell.text}
          himRect={farewell.rect}
          onDone={() => setFarewell(null)}
        />
      ) : null}
    </>
  )
}
