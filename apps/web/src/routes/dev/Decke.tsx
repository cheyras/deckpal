/**
 * /dev/decke — the Deck-E preview and control surface.
 *
 * Two jobs. First, let a human drive every part of the character so it can be
 * eyeballed against Blender. Second, and more importantly, be the exact surface
 * an LLM will drive later: the JSON console at the bottom posts through the SAME
 * validator the eventual tool layer uses, so both paths are exercised from day
 * one rather than the agent path being written blind months later.
 *
 * Dev-only. `beforeLoad` in main.tsx throws notFound() in production, following
 * the /design precedent — this repo also ships the live product.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { DeckE } from '../../character/decke/DeckE'
import { BLENDER_BACKDROP_LINEAR } from '../../character/decke/stage'
import { runCommands, type Command } from '../../character/decke/commands'

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
  { label: 'Rest & lifecycle', states: ['boot', 'listening', 'thinking', 'sleep'] },
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
  { label: 'Travel', states: ['travel_point', 'travel_far'] },
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
      clearColor: parity ? BLENDER_BACKDROP_LINEAR : null,
      onError: (e) => {
        setError(String(e))
        setStatus('error')
      },
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
        // console. Dev-only route, so this leaks nothing to production.
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
      setFacing(Number(s.facing.toFixed(3)))
      setTalking(s.talking)
    }, 200)
    return () => clearInterval(id)
  }, [])

  const play = useCallback((name: string) => {
    deckeRef.current?.setState(name)
  }, [])

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

      <div
        className="relative z-20 mx-auto max-w-[1200px] px-[16px] py-[20px]"
        style={parity ? { display: 'none' } : undefined}
      >
        <header className="mb-[16px]">
          <h1 className="text-[18px] font-bold">Deck-E — three.js preview</h1>
          <p className="mt-[2px] font-mono text-[11px] text-text-muted">
            state <span className="text-text-primary">{current}</span> · facing{' '}
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
              </p>
              <div className="flex gap-[8px]">
                <Btn onClick={() => deckeRef.current?.setFacing(1)}>Face right (+1)</Btn>
                <Btn onClick={() => deckeRef.current?.setFacing(-1)}>Face left (−1)</Btn>
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
                He parks beside the element — never on it — and faces inward. Depth
                chooses the foreground plane or the background plane at ⅓ apparent
                scale.
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
                      <Btn
                        onClick={() =>
                          deckeRef.current?.flyTo(
                            { selector: `#target-${id}` },
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
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-[10px]">
                <Btn onClick={() => deckeRef.current?.returnHome()}>Return home</Btn>
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
                  Every state button above is in the playbook; {stateNames.size} of the 27
                  are grouped here.
                </li>
                <li>
                  The idle float, blink and gaze layers run underneath everything and are
                  generated from a seeded PRNG, so they match Blender frame for frame.
                </li>
                <li>
                  Alert states freeze the float and suppress blinking entirely — the
                  absence of motion is what makes the mode switch read.
                </li>
              </ul>
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
}: {
  children: React.ReactNode
  onClick: () => void
  active?: boolean
}) {
  return (
    <button
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
