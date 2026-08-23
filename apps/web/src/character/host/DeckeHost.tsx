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
import { useEffect, useRef, useState } from 'react'
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
import { DeckeBubble, type Rect } from './DeckeBubble'
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
  /** True while he is away from the chat doing something on the page. */
  const [travelling, setTravelling] = useState(false)
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
    const d = deckeRef.current
    if (!d) return
    if (journeyStepRef.current) return
    try {
      // The ring is the most obviously wrong thing to leave behind: it is
      // drawn around a rectangle that no longer means anything.
      d.clearHighlight()
    } catch {
      /* An engine that has gone away must not take a navigation with it. */
    }
    // Dropping `travelling` is what retires the speech bubble and gives the
    // transcript back — the bubble is derived from it, so there is no separate
    // thing to clear.
    if (travellingRef.current) setTravelling(false)
    // RE-SOLVE, OR GO HOME. Standing beside a remembered rectangle on a page
    // that has been replaced is worse than standing in his corner, because it
    // looks deliberate.
    if (chatOpenRef.current) parkForChatRef.current?.()
    else {
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

  // OPENING THE CHAT RESIZES HIM, THEN MOVES HIM — in that order, and the order
  // is load-bearing.
  //
  // `setCharacterHeight` dollies the camera, so it changes the mapping between
  // screen pixels and world units for the whole scene. A destination solved
  // before the dolly lands somewhere else after it. `measure()` first therefore
  // is not tidiness: it is the difference between him standing in the corner and
  // him standing wherever that corner used to be.
  //
  // On the way back out the same order runs in reverse — restore the page size,
  // THEN send him home, because `homeCorner` unprojects through the camera too.
  //
  // He flies to a spot beside the panel using the same `flyTo` that parks him
  // next to a deck list. On a phone that spot is the panel's own park box, so
  // the layout and the character are working from one geometry; on desktop it is
  // a viewport fraction out on the open page. `centre: true` either way, because
  // a stand point is a place to BE — the default parks him outboard of a target
  // with a gap, which is right for pointing at something and wrong for "stand
  // here".
  //
  // The 320 ms wait is the panel's entrance: `getBoundingClientRect` on an
  // element mid-transform reports where it IS, not where it lands, and the rAF
  // after it lets the dolly settle before the park is solved against it.
  /**
   * Put him on his chat mark, re-solvable.
   *
   * Held in a ref rather than inlined in the effect below because the route
   * watcher needs to run exactly this again after a navigation: his mark on a
   * phone is a box inside the panel and on desktop a fraction of the open page,
   * and both want re-solving once the page underneath has been replaced.
   */
  const parkForChatRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const d = deckeRef.current
    if (!d) return
    measureRef.current?.()
    if (!chatOpen) {
      parkForChatRef.current = null
      d.returnHome()
      // BACK TO NOTHING, once he is off screen. He has to end where the next
      // entrance begins, or the second open finds him already at full size and
      // there is nothing to grow. The delay is the canvas's own opacity fade —
      // shrinking him instantly on close would snap him out mid-fade, which is
      // the "it just snaps to a stop" note this codebase already has about the
      // talk animation.
      const t = window.setTimeout(() => deckeRef.current?.setEntryScale(0), 520)
      return () => window.clearTimeout(t)
    }
    // HE IS OUT ON THE PAGE. Leave him there.
    //
    // While `travelling` the transcript collapses to a bar and the panel —
    // including the composer he anchors to — is not in the DOM at all. Parking
    // him against a mark that does not exist is how he ends up standing on a
    // viewport fraction chosen for a layout that no longer applies.
    if (travelling) return

    const park = () => {
      // The park box only exists while the phone panel is mounted AND he has
      // a measured size. `flyTo` THROWS on a selector that resolves to
      // nothing, so this asks rather than assumes — and falls back to the
      // same corner expressed as a fraction.
      if (!wide && document.querySelector(`[${PARK_LANDMARK}]`)) {
        d.flyTo(
          { selector: `[${PARK_LANDMARK}]` },
          { depth: 'foreground', highlight: false, centre: true },
        )
        return
      }
      // DESKTOP PARKS HIM BESIDE THE COMPOSER, not on a viewport fraction.
      //
      // `STAND_DESKTOP` was `{x: 0.36, y: 0.58}` — a spot chosen when the panel
      // was a 420px card in the bottom-right corner and the rest of the page
      // was empty. The panel is the content pane now and the composer is
      // centred in it, so that fraction puts him standing ON the conversation.
      //
      // The right primitive was already here and is what `flyTo` is FOR: an
      // ordinary beside-park. `side: 'left'` puts him outboard of the card's
      // left edge with the usual gap, and — the part worth having — a
      // beside-park is the branch of `solvePark` that RETURNS A FACING, so he
      // turns to face the thing he is standing next to. Both chat-open calls
      // used to pass `centre: true`, whose branch deliberately returns no
      // facing because a point has no inward, and `flyTo` then re-asserted the
      // boot default of screen-left. That is why he stood with his back to the
      // composer: not a facing bug, a consequence of asking to stand ON a
      // point instead of BESIDE a thing.
      if (wide) {
        // `flyTo` THROWS on a selector that resolves to nothing, so ask.
        const composer = document.querySelector(`[${COMPOSER_LANDMARK}]`)
        if (composer) {
          d.flyTo(
            { selector: `[${COMPOSER_LANDMARK}]` },
            // `anchor: 'bottom'` — his BASE on the composer's bottom edge, not
            // his middle on its middle. The composer is 58px and he is ~216
            // drawn, so centring hangs ~79px of him below it; with the composer
            // against the bottom of the window that is off the edge, and the
            // clamp then rescues him by pinning his feet to the window bottom.
            // Reported as "too low, and going off the bottom edge. Cut off."
            { depth: 'foreground', highlight: false, side: 'left', anchor: 'bottom' },
          )
          return
        }
      }
      const at = wide ? STAND_DESKTOP : STAND_MOBILE
      d.flyTo(
        { x: window.innerWidth * at.x, y: window.innerHeight * at.y },
        { depth: 'foreground', highlight: false, centre: true },
      )
    }
    parkForChatRef.current = park

    // THE ENTRANCE: absent → grows from nothing at the button → travels.
    //
    // The order is the whole of it. He is placed at the launcher's rect with
    // `instant: true` — a cut, not a flight, because he was never anywhere
    // before this and flying him from his home corner would be a journey from
    // a place he had not been. Then he grows. Then, and only when the grow has
    // landed, he sets off for his mark.
    //
    // `playEntry` returns the milliseconds it will take and calls `onDone` on
    // the frame it lands, so the travel is sequenced off the engine's own clock
    // rather than a second copy of the duration living here. Under reduced
    // motion it returns 0 and calls `onDone` synchronously — which makes this
    // the reduce path as well, with no branch: he is simply already there and
    // then travels, or under a reduced-motion flight, cuts.
    const rect = launchRectRef.current
    let raf = 0
    const t = window.setTimeout(() => {
      raf = requestAnimationFrame(() => {
        if (rect && rect.width > 0) {
          d.flyTo({ rect }, { centre: true, highlight: false, instant: true })
          d.playEntry({ onDone: park })
        } else {
          // No rect means he was opened by something other than the button.
          // Nothing to grow from, so he simply takes his mark.
          d.setEntryScale(1)
          park()
        }
      })
    }, 320)
    return () => {
      window.clearTimeout(t)
      cancelAnimationFrame(raf)
    }
    // `wide` is a dependency, not a value read inside: crossing the breakpoint
    // with the chat open swaps which mark he is standing on, and re-running is
    // what moves him to the new one.
    //
    // AND `travelling`, which was missing and is the more common case. Coming
    // back from a journey re-mounts the panel and with it his mark — and until
    // this dependency existed, NOTHING re-parked him. He simply stayed wherever
    // the journey had left him, which after a `goTo` is a position solved
    // against a page that is no longer on screen: standing over the
    // conversation he had just been asked to come back to.
  }, [chatOpen, live, wide, travelling])

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
        decke.stage.setCharacterHeight(px)
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
          setChatOpen(false)
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
        onRetryTool={chat.retry}
        desktop={wide}
        characterPx={charPx}
      />

      {/* His words while the transcript is minimised. Anchored to him and
          solved against the highlight so it can never cover what he is
          pointing at — see DeckeBubble. */}
      {chatOpen && travelling ? (
        <DeckeBubble
          text={(() => {
            const last = chat.messages.filter((m) => m.role === 'assistant').at(-1)
            return last ? messageText(last) : ''
          })()}
          himRect={himRect}
          avoidSelector={live?.getState().highlighted ?? null}
        />
      ) : null}
    </>
  )
}
