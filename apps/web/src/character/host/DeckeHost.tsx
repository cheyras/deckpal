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
import { deckeEntitled } from './entitlement'
import { DeckeButton } from './DeckeButton'
import {
  DeckeChat,
  NAV_BREAKPOINT,
  PARK_LANDMARK,
  STAND_DESKTOP,
  STAND_MOBILE,
} from './DeckeChat'
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
  const [entitled, setEntitled] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [beacon, setBeacon] = useState<Beacon | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
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
  const chat = useDeckeChat(live, (to) => navigate({ to }), () => setTravelling(true))

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${NAV_BREAKPOINT}px)`)
    const on = () => setWide(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  useEffect(() => {
    let live = true
    void deckeEntitled().then((ok) => {
      if (live) setEntitled(ok)
    })
    return () => {
      live = false
    }
  }, [])

  // Warm the engine once the page has settled. Deliberately NOT on mount: the
  // first seconds after navigation belong to the content the reader asked for,
  // and the character is 6.6 MB that nobody is looking at yet.
  useEffect(() => {
    if (!entitled || chromeless || phase !== 'idle') return
    const start = () => setPhase('loading')
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: object) => number }
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(start, { timeout: 4000 })
      return () => (window as unknown as { cancelIdleCallback?: (h: number) => void })
        .cancelIdleCallback?.(id)
    }
    const t = setTimeout(start, 1500)
    return () => clearTimeout(t)
  }, [entitled, chromeless, phase])

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
  useEffect(() => {
    const d = deckeRef.current
    if (!d) return
    measureRef.current?.()
    if (!chatOpen) {
      d.returnHome()
      return
    }
    let raf = 0
    const t = window.setTimeout(() => {
      raf = requestAnimationFrame(() => {
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
        const at = wide ? STAND_DESKTOP : STAND_MOBILE
        d.flyTo(
          { x: window.innerWidth * at.x, y: window.innerHeight * at.y },
          { depth: 'foreground', highlight: false, centre: true },
        )
      })
    }, 320)
    return () => {
      window.clearTimeout(t)
      cancelAnimationFrame(raf)
    }
    // `wide` is a dependency, not a value read inside: crossing the breakpoint
    // with the chat open swaps which mark he is standing on, and re-running is
    // what moves him to the new one.
  }, [chatOpen, live, wide])

  // ONE BOOLEAN, not `phase`, drives the setup effect.
  //
  // Keying it on `phase` directly is wrong twice over. It would re-run on the
  // loading -> ready transition this effect itself performs, tearing the
  // controller down and rebuilding it in a loop; and it would NOT re-run when a
  // chromeless route unmounts the canvas and a later navigation mounts a new
  // one, because `phase` is still 'ready' — leaving a live controller bound to a
  // canvas node that is no longer in the document, and a blank new canvas.
  const active = entitled && !chromeless && (phase === 'loading' || phase === 'ready')

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
        // Compact only on a phone: on desktop the panel is a card in the corner
        // and he stands out on the open page, where there is nothing to crowd.
        const compact = chatOpenRef.current && w < NAV_BREAKPOINT
        const px = characterHeightFor(w, h, compact)
        decke.stage.setCharacterHeight(px)
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

  if (!entitled || chromeless) return null

  return (
    <>
      <div
        ref={probeRef}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 h-[100svh] w-0 invisible"
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
        hidden={chatOpen}
        onOpen={() => setChatOpen(true)}
        onWarm={() => setPhase((p) => (p === 'idle' ? 'loading' : p))}
      />

      <DeckeChat
        open={chatOpen}
        minimised={travelling}
        onExpand={() => setTravelling(false)}
        onClose={() => setChatOpen(false)}
        decke={live}
        messages={chat.messages}
        onSend={chat.send}
        onStop={chat.stop}
        busy={chat.busy}
        asking={chat.asking}
        onApprove={chat.approve}
        onDeny={chat.deny}
        desktop={wide}
        characterPx={charPx}
      />

      {/* His words while the transcript is minimised. Anchored to him and
          solved against the highlight so it can never cover what he is
          pointing at — see DeckeBubble. */}
      {chatOpen && travelling ? (
        <DeckeBubble
          text={chat.messages.filter((m) => m.role === 'assistant').at(-1)?.text ?? ''}
          himRect={himRect}
          avoidSelector={live?.getState().highlighted ?? null}
        />
      ) : null}
    </>
  )
}
