/**
 * /dev/decke — the Deck-E preview and control surface.
 *
 * Two jobs. First, let a human drive every part of the character so it can be
 * eyeballed against Blender. Second, and more importantly, be the exact surface
 * an LLM will drive later: the JSON console at the bottom posts through the SAME
 * validator the eventual tool layer uses, so both paths are exercised from day
 * one rather than the agent path being written blind months later.
 *
 * Always available in dev; in production it ships but is OWNER-ONLY, gated in
 * main.tsx on the server-verified `owner` flag from GET /me, following the
 * /design precedent — this repo also ships the live product.
 */
import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { DeckE } from '../../character/decke/DeckE'
import { BLENDER_BACKDROP_LINEAR } from '../../character/decke/stage'
import { runCommands, type Command } from '../../character/decke/commands'
import { BATCH_MAX, MAX_RUN } from '../../character/decke/cards'
import type { CardArt, CardSlot } from '../../character/decke/cardArt'
import {
  applyDefaultCards,
  artForIds,
  defaultStash,
  randomCatalog,
  recentlyAdded,
} from '../../character/cardSource'
import { api } from '../../lib/api'
import { DeckeBeacon } from '../../components/ui/DeckeBeacon'
import type { Beacon } from '../../character/beacon'
import { DeckeDiag, diagMode } from './DeckeDiag'

/**
 * `?parity=1` reproduces Blender's staging exactly for a frame-by-frame
 * comparison: his own camera distance (not the dollied UI framing), the flat
 * backdrop Blender shows to camera rays, and no page chrome to occlude him.
 * Without the matching backdrop the image diff is dominated by the background
 * rather than by the character.
 */
function parityMode(): boolean {
  return new URLSearchParams(window.location.search).get('parity') === '1'
}

/** Grouped so the panel reads like the character's own vocabulary rather than
 *  an alphabetical dump. Mirrors the roster in the animation wiki. */
const STATE_GROUPS: { label: string; states: string[] }[] = [
  // `idle` leads, because it is where he lives and because it is the button that
  // makes every other one releasable by hand: "we need to have a button here for
  // idle, so it can trigger to go back to idle."
  { label: 'Rest & lifecycle', states: ['idle', 'boot', 'listening', 'thinking', 'sleep'] },
  {
    label: 'Emotes',
    states: ['happy', 'sad', 'confused', 'frustrated', 'embarrassed', 'curious', 'proud'],
  },
  { label: 'Response', states: ['nod_yes', 'shake_no'] },
  {
    label: 'Alert (a mode, not an emotion)',
    states: [
      'alert_money',
      'alert_star',
      'alert_warn',
      'alert_error',
      'alert_dizzy',
      'alert_scribble',
    ],
  },
  { label: 'Actions', states: ['loading', 'card_stash', 'card_show', 'card_present', 'point'] },
  // Not destinations — these are the BODY LANGUAGE of a flight, authored against
  // two specific Blender legs, and they are the only states besides `boot` that
  // deliberately play once and hand back to idle. `travel_point` also gates a
  // loose card, which is why it reads as a presentation rather than a point;
  // that is authored, not a bug.
  { label: 'Travel (flight body language, plays once)', states: ['travel_point', 'travel_far'] },
]

/** Channels worth exposing as continuous sliders — the ones an LLM would plausibly
 *  hold at a partial value rather than driving through a whole state. */
const CHANNEL_SLIDERS: { ch: string; min: number; max: number; label: string }[] = [
  { ch: 'bend', min: -1, max: 1, label: 'bend  (fwd / back)' },
  { ch: 'lean', min: -1, max: 1, label: 'lean  (toward +X)' },
  { ch: 'twist', min: -1, max: 1, label: 'twist' },
  { ch: 'sq', min: -0.3, max: 0.6, label: 'squash / stretch' },
  { ch: 'mouth', min: 0, max: 2.09, label: 'mouth  (2.09 = full gape)' },
  { ch: 'm_curve', min: -1, max: 2, label: 'mouth curve  (smile → frown)' },
  { ch: 'lid_u', min: 0, max: 1, label: 'upper lids' },
  { ch: 'lid_l', min: 0, max: 1, label: 'lower lids' },
  { ch: 'brow', min: -1, max: 1, label: 'brows' },
  { ch: 'alert', min: -0.2, max: 1.2, label: 'alert reel  (position, not opacity)' },
]

type Status = 'loading' | 'ready' | 'error'

export default function Decke() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  /** A zero-width `100svh` strut, so the always-visible height is measured from
   *  CSS rather than from `innerHeight`, which moves as the toolbar slides. */
  const probeRef = useRef<HTMLDivElement | null>(null)
  const deckeRef = useRef<DeckE | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState<string | null>(null)
  const [current, setCurrent] = useState('boot')
  const [phase, setPhase] = useState('intro')
  /** How the state buttons drive `setState`. The whole point of the sustain work
   *  is that these are three different behaviours and all three have to be
   *  checkable by hand, not just by the agent. */
  const [mode, setMode] = useState<'sustain' | 'once' | 'timed'>('sustain')
  const [facing, setFacing] = useState(1)
  const [talking, setTalking] = useState(false)
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [json, setJson] = useState(
    JSON.stringify(
      {
        commands: [
          { op: 'state', value: 'happy' },
          { op: 'facing', value: 'left' },
          { op: 'flyTo', selector: '#target-b', depth: 'foreground', side: 'auto' },
          { op: 'talk', value: true },
        ],
      },
      null,
      2,
    ),
  )
  const [jsonResult, setJsonResult] = useState<string | null>(null)
  const [beacon, setBeacon] = useState<Beacon | null>(null)
  const [stashCount, setStashCount] = useState(5)
  const [autoClose, setAutoClose] = useState(false)
  /** What the last card action did, in one line. The card paths do network I/O
   *  and can legitimately come back empty — signed out, empty collection — and a
   *  button that silently does nothing is indistinguishable from a broken one. */
  const [cardNote, setCardNote] = useState<string | null>(null)
  const [slot, setSlot] = useState<CardSlot>('card_r')
  const [slotQuery, setSlotQuery] = useState('')
  const [slotHits, setSlotHits] = useState<CardArt[]>([])
  /** "His real cards", cached once fetched — so the ACTIONS `card_stash`
   *  button (which names no cards at all) does not re-fetch on every press,
   *  and so a press that beat the network the first time benefits from
   *  whatever a slower press's wait already picked up. */
  const defaultStashRef = useRef<CardArt[] | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false

    const parity = parityMode()
    const decke = new DeckE({
      canvas,
      baseUrl: import.meta.env.BASE_URL,
      // null keeps Blender's exact staging distance.
      characterHeightPx: parity ? null : 300,
      // Parity mode compares against Blender's own staging, which is the world
      // origin — and it is the one position where the framing solve is the
      // identity. Everywhere else he starts at home.
      startAt: parity ? 'staging' : 'home',
      clearColor: parity ? BLENDER_BACKDROP_LINEAR : null,
      onError: (e) => {
        setError(String(e))
        setStatus('error')
      },
      onBeacon: setBeacon,
    })
    deckeRef.current = decke
    // A handle for the screenshot harness and the browser console. Dev route
    // only, and torn down with the controller.
    ;(window as unknown as { __decke?: DeckE }).__decke = decke

    // MEASURE THE CANVAS, NOT THE WINDOW.
    //
    // `window.innerHeight` is the VISUAL viewport, and on an iPhone it changes
    // by the height of Safari's toolbars every time they slide away and come
    // back. The canvas is `fixed inset-0` at `100lvh`, so its box does not — and
    // three sizes downstream of this used to be keyed to the number that moves:
    // the drawing buffer (which is then stretched into a box that did NOT move,
    // so he rendered non-uniformly scaled — "he becomes more thin"), the camera
    // dolly, and his own target height in pixels. That is the whole of "his
    // height scales with that going away, and then he readjusts and snaps back
    // to his proper size".
    //
    // A ResizeObserver on the canvas is both the right trigger and the right
    // value: it fires when the surface actually changes and hands us the size it
    // actually is, so the buffer and the box cannot disagree. A `resize`
    // listener is neither — it fires for toolbar chrome that changes nothing
    // about the canvas, and it tells you about the window rather than about the
    // thing being drawn into.
    const measure = () => {
      const w = Math.round(canvas.clientWidth) || window.innerWidth
      // TWO HEIGHTS. The canvas is `100lvh` so it covers the screen even once
      // the toolbar has slid away; the probe is `100svh`, the part of the screen
      // that is visible whatever the toolbar is doing, and that is what he is
      // placed against. Both are CSS-derived and therefore stable — the number
      // that moves, `innerHeight`, is used for neither. See `viewport.ts`.
      const canvasH = Math.round(canvas.clientHeight) || window.innerHeight
      const h = Math.round(probeRef.current?.clientHeight ?? 0) || canvasH
      decke.resize(w, h, canvasH)
      // Scale him to the viewport rather than pinning a fixed pixel height: 300px
      // is right on a laptop and swallows a 390px phone. Parity mode opts out
      // entirely, since it needs Blender's exact staging distance.
      if (!parity) {
        decke.setCharacterHeight(Math.round(Math.min(300, h * 0.3, w * 0.55)))
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(canvas)
    if (probeRef.current) ro.observe(probeRef.current)

    // AND WATCH THE PIXEL RATIO SEPARATELY. Dragging the window from a Retina
    // display to an external one changes `devicePixelRatio` without changing the
    // canvas's CSS box by a single pixel, so the observer never fires and
    // `setPixelRatio` is never called again — he keeps rendering at the old
    // resolution until something else resizes him. A `resolution` media query is
    // the only event for it, and it has to be re-armed after each change because
    // the query names the ratio it was built for.
    //
    // UNVERIFIED HERE, deliberately noted: Chromium's `setDeviceMetricsOverride`
    // changes `devicePixelRatio` and updates `matches` on both an exact
    // `resolution` query and a `min-resolution` one, but fires no `change` event
    // for either — and a `device-pixel-content-box` ResizeObserver does not fire
    // under it either. So the emulator cannot exercise this path at all; it is
    // the standard recipe, applied on the standard event, and the only way to
    // confirm it is a real second display.
    let dprQuery: MediaQueryList | null = null
    const onDpr = () => {
      measure()
      armDpr()
    }
    const armDpr = () => {
      dprQuery?.removeEventListener('change', onDpr)
      dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      dprQuery.addEventListener('change', onDpr)
    }
    armDpr()

    ;(async () => {
      try {
        await decke.load()
        if (cancelled) return
        // The environment is NOT optional: his body is metallic 0.85, and metal
        // with nothing to reflect renders near-black. Loaded second so the
        // character appears as soon as possible.
        const hdr = await new HDRLoader().loadAsync(
          `${import.meta.env.BASE_URL}models/decke/studio_small_09_1k.hdr`,
        )
        if (cancelled) return
        decke.setEnvironment(hdr)
        decke.start()
        setStatus('ready')
        // THE CARDS HE IS HOLDING ARE THE USER'S OWN, from the first frame. Not
        // awaited and not allowed to fail loudly: this is decoration, and the
        // placeholder art it replaces is perfectly good decoration.
        void applyDefaultCards(decke).then((cards) => {
          // `c?.name ?? c?.id` rather than trusting the array is exactly
          // `CardArt[]`: this note is the one place a malformed entry would
          // otherwise throw during the RENDER it triggers, and a decorative
          // status line is not worth taking the page down over.
          if (cards.length) {
            setCardNote(`loaded ${cards.map((c) => c?.name ?? c?.id ?? 'a card').join(', ')}`)
          }
        })
        // A handle for the screenshot harness and for driving him from the
        // console. This DOES exist in production — but only inside a route that
        // no one but the owner can load, and it exposes the character, not any
        // user data.
        ;(window as unknown as { deckE?: DeckE }).deckE = decke

        // `?present=<selector>` — set him presenting straight from the URL.
        //
        // THIS EXISTS BECAUSE THE PHONE CANNOT BE DRIVEN. The scroll defect this
        // page is for only reproduces on a real iPhone, the only way in is
        // iPhone Mirroring, and getting from a cold tab to "parked on an element
        // and scrolling" through that took a dozen mis-aimed taps and several
        // minutes — every time. A URL that arrives already presenting turns the
        // whole setup into one paste of an address, which is the difference
        // between checking the phone and not bothering.
        //
        // Deliberately after `setStatus('ready')`, so a bad selector leaves a
        // working page with a note rather than a blank one.
        const wanted = new URLSearchParams(window.location.search).get('present')
        if (wanted) {
          const el = document.querySelector(wanted)
          if (!el) setCardNote(`present: no element matches ${wanted}`)
          else {
            // Scrolled to the middle FIRST: he only hands himself to the
            // compositor while he is comfortably on screen, so arriving with the
            // target off the bottom would measure the fallback path instead.
            el.scrollIntoView({ block: 'center' })
            requestAnimationFrame(() => {
              if (!cancelled) decke.flyTo({ selector: wanted }, { depth: 'foreground' })
            })
          }
        }
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setStatus('error')
      }
    })()

    return () => {
      cancelled = true
      ro.disconnect()
      dprQuery?.removeEventListener('change', onDpr)
      decke.dispose()
      deckeRef.current = null
      delete (window as unknown as { __decke?: DeckE }).__decke
    }
  }, [])

  // Poll the controller for display only — never bind React state to the
  // animation loop, which would re-render sixty times a second.
  useEffect(() => {
    const id = setInterval(() => {
      const d = deckeRef.current
      if (!d) return
      const s = d.getState()
      setCurrent(s.state)
      setPhase(s.phase)
      setFacing(Number(s.facing.toFixed(3)))
      setTalking(s.talking)
    }, 200)
    return () => clearInterval(id)
  }, [])

  const play = useCallback(
    (name: string) => {
      deckeRef.current?.setState(name, {
        mode: mode === 'once' ? 'once' : 'sustain',
        durationMs: mode === 'timed' ? 2500 : undefined,
      })
    },
    [mode],
  )

  const onSlider = useCallback((ch: string, v: number | null) => {
    deckeRef.current?.setChannel(ch, v)
    setOverrides((o) => {
      const next = { ...o }
      if (v === null) delete next[ch]
      else next[ch] = v
      return next
    })
  }, [])

  /**
   * Play a stash run from a list of cards.
   *
   * `setStashCards` then `setState` in that order, always: a run lands on the
   * next ENTRY, so setting it after the state change would show this run's cards
   * on the NEXT one. The textures are warmed first for the same reason the card
   * system warms the next batch — a card that pops in on a placeholder and
   * swaps a frame later reads as a glitch.
   */
  const playStash = useCallback(
    async (arts: (CardArt | null)[], label: string) => {
      const d = deckeRef.current
      if (!d) return
      setCardNote(`${label}: ${arts.length} card${arts.length === 1 ? '' : 's'}…`)
      // WARM, BUT ON A DEADLINE. The card system warms each batch behind the one
      // on screen, so only the FIRST batch has nothing ahead of it — worth
      // waiting for, because a card that pops in on a placeholder and swaps a
      // frame later reads as a glitch. Worth waiting for is not worth waiting
      // indefinitely for: on a slow connection an unbounded await is a button
      // that does nothing, and the art lands correctly whenever it arrives
      // anyway. The first card does not leave the mouth for `gapeMs` regardless.
      await Promise.race([
        d.art.preload(arts.slice(0, BATCH_MAX)),
        new Promise((r) => setTimeout(r, 700)),
      ])
      d.setStashCards(arts, { autoClose })
      d.setState('card_stash')
      const batches = Math.ceil(Math.min(arts.length, MAX_RUN) / BATCH_MAX)
      setCardNote(
        `${label}: ${Math.min(arts.length, MAX_RUN)} card${arts.length === 1 ? '' : 's'}` +
          ` in ${batches} batch${batches === 1 ? '' : 'es'}${autoClose ? ', closing at the end' : ''}`,
      )
    },
    [autoClose],
  )

  /** A guard for every card button: they all do network I/O and they can all
   *  legitimately return nothing, and "nothing happened" has to be readable. */
  const cardAction = useCallback(async (label: string, run: () => Promise<void>) => {
    try {
      await run()
    } catch (e) {
      setCardNote(`${label} failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [])

  /**
   * "His real cards", for anything that plays `card_stash` without naming
   * which — the ACTIONS panel's bare button below. "For some reason, these
   * are all fake cards... default needs to not be fake cards": the
   * AI-generated placeholders baked into the glb are the fallback now, never
   * the picture, here as everywhere else this character shows a card.
   *
   * BOUNDED, the same shape as the texture-preload race in `playStash`: a
   * press must not hang on a slow network. A draw not back within 700ms
   * plays with nothing THIS press — which lands on the existing placeholder
   * fallback below — but the draw is not abandoned, and it caches itself for
   * the next press either way.
   */
  const playDefaultStash = useCallback(async () => {
    let cards = defaultStashRef.current ?? []
    if (!cards.length) {
      const draw = defaultStash(Math.max(stashCount, BATCH_MAX)).then((c) => {
        if (c.length) defaultStashRef.current = c
        return c
      })
      cards = await Promise.race([
        draw,
        new Promise<CardArt[]>((r) => setTimeout(() => r([]), 700)),
      ])
    }
    await playStash(
      cards.length ? cards.slice(0, stashCount) : new Array(stashCount).fill(null),
      cards.length ? 'his own cards' : 'placeholder art (no cards yet)',
    )
  }, [playStash, stashCount])

  const findCards = useCallback(
    () =>
      cardAction('search', async () => {
        const res = await api.searchCards(new URLSearchParams({ q: slotQuery, pageSize: '8' }))
        // OPTIONAL-CHAINED ON PURPOSE, even though `SearchCard.images` is typed
        // non-nullable: a card missing its images is a card this panel must
        // still be able to draw a button for (skipped, rather than a
        // `<button>` whose `<img>` has no src) rather than a reason to take
        // the page down.
        setSlotHits(
          res.cards.flatMap((c) => {
            const front = c.images?.low ?? c.images?.high
            if (!front) return []
            return [{ id: c.cardId, front, frontLarge: c.images?.high ?? front, name: c.name }]
          }),
        )
        setCardNote(`${res.cards.length} result(s) for \u201c${slotQuery}\u201d`)
      }),
    [cardAction, slotQuery],
  )

  const runJson = useCallback(async () => {
    const d = deckeRef.current
    if (!d) return
    try {
      const parsed = JSON.parse(json) as { commands?: Command[] }
      // Awaited now that naming cards is a catalog lookup — the console has to
      // show what a model would be told, and a model is told after the lookup.
      const result = await runCommands(d, parsed.commands ?? [])
      const lines = [
        result.errors.length
          ? `${result.applied} applied, ${result.errors.length} rejected:`
          : `${result.applied} command(s) applied.`,
        ...result.errors,
        ...result.notes.map((n) => `note: ${n}`),
      ]
      setJsonResult(lines.join('\n'))
    } catch (e) {
      setJsonResult(`Parse error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [json])

  const stateNames = useMemo(
    () => new Set(STATE_GROUPS.flatMap((g) => g.states)),
    [],
  )

  const parity = typeof window !== 'undefined' && parityMode()

  return (
    <div className={'min-h-screen text-text-primary ' + (parity ? '' : 'bg-surface-primary')}>
      {/* The character composites OVER the page — that is the whole product
          idea, so the canvas sits ABOVE the content, not behind it. It is
          `pointer-events-none`, so every click passes straight through to the
          controls underneath. */}
      {/* `100svh`, NOT `h-full`.

          `h-full` on a `fixed inset-0` box resolves to the DYNAMIC viewport, and
          on an iPhone that is the number that moves: measured on iOS 18 Safari,
          `100lvh` is 760 and `100svh`, `100dvh`, `innerHeight`, the fixed box
          and `documentElement.clientHeight` are all 678 — an 82px toolbar, and
          five of the six metrics ride it. The renderer was sized from one of
          them and stretched into another, and the two do not update on the same
          frame, which is the transient "he becomes more thin" before the resize
          handler catches up and he "snaps back to his proper size".

          BOTH, FOR DIFFERENT JOBS, because picking one loses either his feet or
          his size. The canvas is `100lvh` — the screen with the toolbar hidden —
          so there is never a strip of visible screen it does not reach. The
          earlier `100svh` canvas left exactly that: a bar's height at the bottom
          with no surface in it, which clipped him well short of the edge and was
          reported as "it's always cut off at the bottom where the full height of
          the bottom bar in Safari would be... and then sometimes he's just cut
          off a bit at the bottom even in the middle of the screen."

          But he is still PLACED against `100svh`, measured by the strut below,
          because that is the part of the screen visible whatever the toolbar is
          doing — park him in the large viewport and his lower body sits behind
          the toolbar whenever it is showing. Both units are stable; the one that
          moves, `innerHeight`, is used for neither. On desktop they are the same
          number and all of this is a no-op. */}
      <div
        ref={probeRef}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 h-[100svh] w-0 invisible"
      />
      <canvas
        ref={canvasRef}
        className="pointer-events-none fixed inset-0 z-30 h-[100lvh] w-full"
      />

      {/* Sits UNDER the canvas at z-25, so the second render pass draws him
          inside it. See `DeckeBeacon`. */}
      <DeckeBeacon beacon={beacon} onClick={() => deckeRef.current?.scrollIntoView()} />

      {/* `?diag=1` — the on-page instrument. The scroll-tracking defect only
          reproduces on a real phone, which has no console a harness can drive,
          so the measurements have to render themselves. See `DeckeDiag`. */}
      {diagMode() ? <DeckeDiag deckeRef={deckeRef} /> : null}

      <div
        className="relative z-20 mx-auto max-w-[1200px] px-[16px] py-[20px]"
        style={parity ? { display: 'none' } : undefined}
      >
        <header className="mb-[16px]">
          <h1 className="text-[18px] font-bold">Deck-E — three.js preview</h1>
          <p className="mt-[2px] font-mono text-[11px] text-text-muted">
            state <span className="text-text-primary">{current}</span>
            <span className="text-text-muted">·{phase}</span> · facing{' '}
            <span className="text-text-primary">{facing}</span>
            {talking ? ' · talking' : ''} ·{' '}
            {status === 'ready' ? (
              <span className="text-text-primary">ready</span>
            ) : status === 'loading' ? (
              'loading…'
            ) : (
              <span className="text-action-danger-text">error</span>
            )}
          </p>
          {error ? (
            <pre className="mt-[8px] max-w-[720px] overflow-x-auto rounded border border-border-default bg-surface-secondary p-[8px] text-[11px] text-text-muted">
              {error}
            </pre>
          ) : null}
        </header>

        <div className="grid gap-[16px] lg:grid-cols-[380px_1fr]">
          {/* ---------------------------------------------------- controls */}
          <div className="flex flex-col gap-[12px]">
            <Panel title="Facing">
              <p className="mb-[8px] text-[11px] text-text-muted">
                A yaw, never a mirror — he turns in full view. Asymmetry is authored
                near/far, not left/right, so the pose resolves automatically.
                <br />
                <b>The sign is in HIS frame.</b> +1 turns him to his own right,
                which you see as him facing screen&nbsp;left. Getting that
                backwards is what made him present things with his back to them.
              </p>
              <div className="flex gap-[8px]">
                <Btn onClick={() => deckeRef.current?.setFacing(1)}>
                  +1 · his right ↖ screen left
                </Btn>
                <Btn onClick={() => deckeRef.current?.setFacing(-1)}>
                  −1 · his left ↗ screen right
                </Btn>
              </div>
              <input
                aria-label="facing"
                type="range"
                min={-1}
                max={1}
                step={0.01}
                value={facing}
                onChange={(e) =>
                  deckeRef.current?.setFacing(Number(e.target.value), { animate: false })
                }
                className="mt-[8px] w-full"
              />
            </Panel>

            <Panel title="Talk overlay">
              <p className="mb-[8px] text-[11px] text-text-muted">
                An overlay, not a state — he has to be able to talk while happy, while
                presenting, while thinking.
              </p>
              <div className="flex gap-[8px]">
                <Btn onClick={() => deckeRef.current?.setOverlay('talk', 1)}>Start talking</Btn>
                <Btn onClick={() => deckeRef.current?.setOverlay(null)}>Stop</Btn>
              </div>
            </Panel>

            <Panel title="How a state is entered">
              <p className="mb-[8px] text-[11px] text-text-muted">
                A state SUSTAINS by default — it loops its own window until something
                else is asked for. The other two are what the agent uses for a beat
                rather than a mood.
              </p>
              <div className="flex gap-[6px]">
                {(
                  [
                    ['sustain', 'sustain (hold)'],
                    ['once', 'once → idle'],
                    ['timed', '2.5 s → idle'],
                  ] as const
                ).map(([m, label]) => (
                  <Btn key={m} active={mode === m} onClick={() => setMode(m)}>
                    {label}
                  </Btn>
                ))}
              </div>
            </Panel>

            {/* CARD DATA CAN SURPRISE THIS PANEL PAIR IN A WAY NOTHING ELSE ON
                THE ROUTE CAN: everything else here is static UI, and these
                two render whatever the catalog and the user's own collection
                hand back. A render throw anywhere below `Decke` normally
                takes the WHOLE route down to TanStack Router's catch
                boundary — `CardPanelBoundary` is the local one, so a
                card-shaped surprise costs this pair, never the page. */}
            <CardPanelBoundary>
            <Panel title="Cards in a stash">
              <p className="mb-[8px] text-[11px] text-text-muted">
                The real use is &ldquo;they add a whole bunch of cards to their
                collection, and this is his way of showing the actual cards they added
                going down into the deck box&rdquo;. So the cards are an input, not a
                property of the five meshes in the glb — anything past the fifth is a
                clone, and anything past{' '}
                <b>{BATCH_MAX}</b> is a second batch: a batch comes up, files in, and
                the top of the stack in his box becomes whichever card went in last.
                He does not close until every batch is in.
              </p>
              <div className="flex items-center gap-[8px]">
                <input
                  aria-label="stash cards"
                  type="range"
                  min={1}
                  max={MAX_RUN}
                  step={1}
                  value={stashCount}
                  onChange={(e) => setStashCount(Number(e.target.value))}
                  className="w-full"
                />
                <span className="w-[52px] shrink-0 text-right font-mono text-[11px]">
                  {stashCount}
                  <span className="text-text-muted">
                    /{Math.ceil(stashCount / BATCH_MAX)}b
                  </span>
                </span>
              </div>
              <label className="mt-[6px] flex items-center gap-[6px] text-[11px] text-text-muted">
                <input
                  type="checkbox"
                  checked={autoClose}
                  onChange={(e) => setAutoClose(e.target.checked)}
                />
                close by himself once every batch is in
              </label>
              <div className="mt-[8px] flex flex-wrap gap-[6px]">
                <Btn
                  onClick={() =>
                    void cardAction('recently added', async () => {
                      const cards = await recentlyAdded(stashCount)
                      if (!cards.length) {
                        setCardNote('no recent additions to show — signed out, or nothing added yet')
                        return
                      }
                      await playStash(cards, 'recently added')
                    })
                  }
                >
                  cards I just added
                </Btn>
                <Btn
                  onClick={() =>
                    void cardAction('random catalog', async () => {
                      const cards = await randomCatalog(stashCount)
                      if (!cards.length) {
                        setCardNote('the catalog returned nothing')
                        return
                      }
                      await playStash(cards, 'random catalog')
                    })
                  }
                >
                  random from catalog
                </Btn>
                <Btn
                  onClick={() =>
                    void cardAction('surprise me', async () => {
                      // A RANDOM NUMBER TOO, which is the point: the counts that
                      // break a layout are the ones nobody thinks to type. This
                      // is the button that found the batch-boundary skip.
                      const n = 1 + Math.floor(Math.random() * MAX_RUN)
                      setStashCount(n)
                      const cards = await randomCatalog(n)
                      if (!cards.length) {
                        setCardNote('the catalog returned nothing')
                        return
                      }
                      await playStash(cards, `surprise (${n})`)
                    })
                  }
                >
                  surprise me
                </Btn>
                <Btn
                  onClick={() =>
                    // Through `cardAction` like every other card button here:
                    // `playStash` does its own network I/O (texture preload)
                    // and an unwrapped `void` on that would turn a failure
                    // into a silent, unreported promise rejection instead of
                    // a note the reader can see.
                    void cardAction('placeholder art', () =>
                      playStash(new Array(stashCount).fill(null), 'placeholder art'),
                    )
                  }
                >
                  placeholder art
                </Btn>
              </div>
            </Panel>

            <Panel title="Card art">
              <p className="mb-[8px] text-[11px] text-text-muted">
                The four faces he shows, and what is on them.{' '}
                <code>card_r</code> is the card he holds up in{' '}
                <code>card_present</code> — L and R are <b>his</b>, as everywhere
                else here. <code>deck</code> is the top of the stack in his box, which
                the stash flight rewrites as cards land on it.
              </p>
              <div className="mb-[8px] flex flex-wrap gap-[6px]">
                {(['card_l', 'card_r', 'single', 'deck'] as CardSlot[]).map((sl) => (
                  <Btn key={sl} active={slot === sl} onClick={() => setSlot(sl)}>
                    {sl}
                  </Btn>
                ))}
                <Btn
                  onClick={() => {
                    deckeRef.current?.setCardArt(slot, null)
                    setCardNote(`${slot}: back to placeholder art`)
                  }}
                >
                  placeholder
                </Btn>
              </div>
              <form
                className="flex gap-[6px]"
                onSubmit={(e) => {
                  e.preventDefault()
                  void findCards()
                }}
              >
                <input
                  aria-label="card search"
                  value={slotQuery}
                  onChange={(e) => setSlotQuery(e.target.value)}
                  placeholder="charizard"
                  className="w-full rounded border border-border-default bg-surface-secondary px-[6px] py-[3px] font-mono text-[11px]"
                />
                {/* `Btn` renders type="button", which does NOT submit a form — so
                    this calls the search itself rather than relying on the
                    submit it looks like it would trigger. */}
                <Btn onClick={() => void findCards()}>find</Btn>
              </form>
              {slotHits.length ? (
                <div className="mt-[8px] flex flex-wrap gap-[6px]">
                  {slotHits.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      title={`${c.name} — put on ${slot}`}
                      onClick={() => {
                        deckeRef.current?.setCardArt(slot, c)
                        setCardNote(`${slot}: ${c.name}`)
                      }}
                      className="overflow-hidden rounded border border-border-default"
                    >
                      <img src={c.front} alt={c.name} className="block h-[64px] w-auto" />
                    </button>
                  ))}
                </div>
              ) : null}
              {cardNote ? (
                <p className="mt-[8px] font-mono text-[11px] text-text-muted">{cardNote}</p>
              ) : null}
            </Panel>
            </CardPanelBoundary>

            {STATE_GROUPS.map((g) => (
              <Panel key={g.label} title={g.label}>
                <div className="flex flex-wrap gap-[6px]">
                  {g.states.map((s) => (
                    <Btn
                      key={s}
                      active={current === s}
                      onClick={() =>
                        // `card_stash` names no cards at all, so left to `play`
                        // it would show whatever the character already had —
                        // the model's placeholders, on a fresh load. Every
                        // other state has no cards to default.
                        s === 'card_stash'
                          ? void cardAction('card_stash', playDefaultStash)
                          : play(s)
                      }
                    >
                      {s}
                    </Btn>
                  ))}
                </div>
              </Panel>
            ))}

            <Panel title="Direct channel control">
              <p className="mb-[8px] text-[11px] text-text-muted">
                Pins a raw channel on top of whatever state is playing. This is how an
                LLM holds a partial expression.
              </p>
              {CHANNEL_SLIDERS.map((c) => (
                <div key={c.ch} className="mb-[6px]">
                  <div className="flex items-baseline justify-between">
                    <label htmlFor={`ch-${c.ch}`} className="font-mono text-[11px]">
                      {c.label}
                    </label>
                    <span className="font-mono text-[11px] text-text-muted">
                      {c.ch in overrides ? overrides[c.ch].toFixed(2) : 'auto'}
                    </span>
                  </div>
                  <div className="flex items-center gap-[6px]">
                    <input
                      id={`ch-${c.ch}`}
                      type="range"
                      min={c.min}
                      max={c.max}
                      step={0.01}
                      value={overrides[c.ch] ?? 0}
                      onChange={(e) => onSlider(c.ch, Number(e.target.value))}
                      className="w-full"
                    />
                    <button
                      type="button"
                      onClick={() => onSlider(c.ch, null)}
                      className="shrink-0 rounded border border-border-default px-[6px] py-[2px] text-[10px] text-text-muted"
                    >
                      release
                    </button>
                  </div>
                </div>
              ))}
            </Panel>
          </div>

          {/* ------------------------------------------------ demo targets */}
          <div className="flex flex-col gap-[16px]">
            <Panel title="Fly to a DOM element">
              <p className="mb-[8px] text-[11px] text-text-muted">
                He parks OUTBOARD of the element — right of it if it is on the right
                half of the screen, left of it if it is on the left — and faces back
                inward across it, so the element sits between him and the middle of
                the page. The only exception is an element against a viewport edge,
                where he takes the other side rather than leaving the screen. Depth
                chooses the foreground plane or the background plane at ⅓ apparent
                scale. <b>present</b> flies, rings the element and points at it.
                <br />
                <b>fly here</b> and <b>present</b> target the BUTTON, not the card —
                a target is whatever selector you hand it, and the smaller it is the
                closer he stands. <b>background</b> targets the whole card, for
                comparison.
              </p>
              <div className="grid grid-cols-2 gap-[10px]">
                {['a', 'b', 'c', 'd'].map((id) => (
                  <div
                    key={id}
                    id={`target-${id}`}
                    className="rounded border border-border-default bg-surface-secondary p-[16px]"
                  >
                    <p className="text-[12px] font-semibold">Target {id.toUpperCase()}</p>
                    <div className="mt-[8px] flex flex-wrap gap-[6px]">
                      {/* THE BUTTON, NOT THE CARD. "I would make it so it's
                          actually the button that was clicked, and I would put
                          him right next to it, like on the 'fly here'." Parking
                          beside a 400px card puts him a long way from the thing
                          the reader just touched; parking beside the control
                          itself is the behaviour the product will actually want,
                          since an agent presenting a row means a cell, not the
                          table. */}
                      <Btn
                        id={`fly-${id}`}
                        onClick={() =>
                          deckeRef.current?.flyTo(
                            { selector: `#fly-${id}` },
                            { depth: 'foreground' },
                          )
                        }
                      >
                        fly here
                      </Btn>
                      <Btn
                        onClick={() =>
                          deckeRef.current?.flyTo(
                            { selector: `#target-${id}` },
                            { depth: 'background' },
                          )
                        }
                      >
                        background
                      </Btn>
                      <Btn
                        id={`present-${id}`}
                        onClick={() =>
                          deckeRef.current?.flyTo(
                            { selector: `#present-${id}` },
                            { depth: 'foreground', then: 'point' },
                          )
                        }
                      >
                        present
                      </Btn>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-[10px] flex flex-wrap gap-[8px]">
                <Btn onClick={() => deckeRef.current?.returnHome()}>
                  Return home (bottom right)
                </Btn>
                <Btn onClick={() => deckeRef.current?.highlight('#target-c')}>
                  Highlight C only
                </Btn>
                <Btn onClick={() => deckeRef.current?.clearHighlight()}>Clear highlight</Btn>
              </div>
            </Panel>

            <Panel title="LLM command console">
              <p className="mb-[8px] text-[11px] text-text-muted">
                The same validator the agent tool layer will call. Unknown ops and
                out-of-range values are rejected with a readable reason rather than
                silently clamped — a model needs the feedback.
              </p>
              <textarea
                aria-label="commands"
                value={json}
                onChange={(e) => setJson(e.target.value)}
                spellCheck={false}
                rows={12}
                className="w-full rounded border border-border-default bg-surface-secondary p-[8px] font-mono text-[11px]"
              />
              <div className="mt-[8px] flex items-center gap-[8px]">
                <Btn onClick={runJson}>Run</Btn>
                {jsonResult ? (
                  <pre className="whitespace-pre-wrap font-mono text-[11px] text-text-muted">
                    {jsonResult}
                  </pre>
                ) : null}
              </div>
            </Panel>

            <Panel title="Notes">
              <ul className="list-disc pl-[16px] text-[11px] text-text-muted">
                <li>
                  {stateNames.size} states are grouped here: the 26 drivable ones from
                  the playbook — <code>talk</code> is the 27th and is an OVERLAY, not a
                  state — plus the synthesized <code>idle</code>, which is where he
                  lives when nothing else is asked of him.
                </li>
                <li>
                  A state SUSTAINS: it plays in, then loops a window of itself forever.
                  Only <code>boot</code> and the two <code>travel_*</code> clips end by
                  themselves.
                </li>
                <li>
                  The idle float, blink and gaze layers run underneath everything and are
                  generated from a seeded PRNG, so they match Blender frame for frame.
                </li>
                <li>
                  Alert states freeze the float and suppress blinking entirely — the
                  absence of motion is what makes the mode switch read, and the pupils
                  let go of the gaze so the reel runs straight.
                </li>
                <li>
                  His pupils aim at the CAMERA, in each eye's own frame, clamped to the
                  authored roam ellipse — so he keeps looking at you through a turn,
                  a flight and a scroll.
                </li>
                <li>
                  The status line shows the phase: <code>intro</code> plays in,{' '}
                  <code>sustain</code> loops forever, <code>outro</code> is the way out
                  that <code>loading</code> and <code>card_stash</code> owe you.
                </li>
                <li>
                  A sustain is its OWN cyclic clip, not a pair of times into the
                  authored one: its two ends are the same beat by construction, so the
                  loop cannot pop. The ticks that survive — the stepped register on{' '}
                  <code>confused</code> and <code>frustrated</code>, the alerts&rsquo;
                  vibrate — are authored and deliberate.
                </li>
                <li>
                  Wherever he parks, he is turned to present the SAME view of himself:
                  canonical yaw, no lean. Only the vertical angle follows his height on
                  the page — high on screen you look up at him, low you look down. The
                  lighting rig and the environment ride along, so he is lit identically
                  in a corner and at the background plane.
                </li>
                <li>
                  A presentation is anchored to the ELEMENT, so he scrolls with it. Go
                  far enough and he leaves the viewport and a small beacon appears at
                  the edge, showing what he is doing live; click it to scroll him back.
                </li>
              </ul>
              <p className="mt-[8px] text-[11px] text-text-muted">
                Scroll this page while he is parked beside a target to see both.
              </p>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * A local error boundary around the two card-data panels — see the comment
 * where it is used. React error boundaries can only be classes; there is no
 * hook equivalent.
 */
class CardPanelBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown) {
    console.error('decke: card panel crashed', error)
  }

  render() {
    if (this.state.error) {
      return (
        <section className="rounded border border-action-danger-text/50 bg-surface-secondary/90 p-[12px]">
          <h2 className="mb-[8px] text-[12px] font-semibold uppercase tracking-wide text-action-danger-text">
            Card panel crashed
          </h2>
          <p className="mb-[8px] font-mono text-[11px] text-text-muted">
            {this.state.error.message}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="rounded border border-border-default bg-surface-tertiary px-[8px] py-[4px] font-mono text-[11px] text-text-primary hover:bg-surface-quaternary"
          >
            Try again
          </button>
        </section>
      )
    }
    return this.props.children
  }
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-border-default bg-surface-secondary/90 p-[12px] backdrop-blur-sm">
      <h2 className="mb-[8px] text-[12px] font-semibold uppercase tracking-wide text-text-muted">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Btn({
  children,
  onClick,
  active,
  id,
}: {
  children: React.ReactNode
  onClick: () => void
  active?: boolean
  id?: string
}) {
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      className={
        'rounded border px-[8px] py-[4px] font-mono text-[11px] transition-colors ' +
        (active
          ? 'border-action-primary bg-action-primary text-action-primary-text'
          : 'border-border-default bg-surface-tertiary text-text-primary hover:bg-surface-quaternary')
      }
    >
      {children}
    </button>
  )
}
