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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { DeckE } from '../../character/decke/DeckE'
import { BLENDER_BACKDROP_LINEAR } from '../../character/decke/stage'
import { runCommands, type Command } from '../../character/decke/commands'
import { DeckeBeacon } from '../../components/ui/DeckeBeacon'
import type { Beacon } from '../../character/decke/beacon'

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

    const resize = () => {
      decke.resize(window.innerWidth, window.innerHeight)
      // Scale him to the viewport rather than pinning a fixed pixel height: 300px
      // is right on a laptop and swallows a 390px phone. Parity mode opts out
      // entirely, since it needs Blender's exact staging distance.
      if (!parity) {
        const h = Math.round(Math.min(300, window.innerHeight * 0.3, window.innerWidth * 0.55))
        decke.stage.setCharacterHeight(h)
      }
    }
    resize()
    window.addEventListener('resize', resize)

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
        // A handle for the screenshot harness and for driving him from the
        // console. This DOES exist in production — but only inside a route that
        // no one but the owner can load, and it exposes the character, not any
        // user data.
        ;(window as unknown as { deckE?: DeckE }).deckE = decke
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setStatus('error')
      }
    })()

    return () => {
      cancelled = true
      window.removeEventListener('resize', resize)
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

  const runJson = useCallback(() => {
    const d = deckeRef.current
    if (!d) return
    try {
      const parsed = JSON.parse(json) as { commands?: Command[] }
      const result = runCommands(d, parsed.commands ?? [])
      setJsonResult(
        result.errors.length
          ? `${result.applied} applied, ${result.errors.length} rejected:\n` +
              result.errors.join('\n')
          : `${result.applied} command(s) applied.`,
      )
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
      <canvas
        ref={canvasRef}
        className="pointer-events-none fixed inset-0 z-30 h-full w-full"
      />

      {/* Sits UNDER the canvas at z-25, so the second render pass draws him
          inside it. See `DeckeBeacon`. */}
      <DeckeBeacon beacon={beacon} onClick={() => deckeRef.current?.scrollIntoView()} />

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

            <Panel title="Cards in a stash">
              <p className="mb-[8px] text-[11px] text-text-muted">
                How many cards <code>card_stash</code> shows. The real use is
                &ldquo;they add a whole bunch of cards to their collection&rdquo;, so
                the count is an input, not a property of the five meshes in the glb —
                anything past the fifth is a clone. They lay out on a grid in the
                plane you are looking at, so no two ever overlap.
              </p>
              <div className="flex items-center gap-[8px]">
                <input
                  aria-label="stash cards"
                  type="range"
                  min={1}
                  max={12}
                  step={1}
                  value={stashCount}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    setStashCount(n)
                    deckeRef.current?.setStashCount(n)
                  }}
                  className="w-full"
                />
                <span className="w-[24px] shrink-0 text-right font-mono text-[11px]">
                  {stashCount}
                </span>
              </div>
            </Panel>

            {STATE_GROUPS.map((g) => (
              <Panel key={g.label} title={g.label}>
                <div className="flex flex-wrap gap-[6px]">
                  {g.states.map((s) => (
                    <Btn key={s} active={current === s} onClick={() => play(s)}>
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
