/**
 * /dev/decke-compare — the shipped Deck-E beside an optimized one, in lockstep.
 *
 * The character's glb is the heaviest thing the chat opens with, and every
 * proposal to shrink it trades bytes for fidelity somewhere: quantised
 * positions, coarser morph normals, a grain map with fewer texels. Those trades
 * are cheap to argue about and expensive to judge from a still, because what
 * they actually change is how he MOVES — a morph normal only matters while the
 * mouth is opening, and a quantisation error only shows on a surface that is
 * turning.
 *
 * So this page runs two complete controllers, hands them the same commands in
 * the same tick, and steps them from ONE animation frame with the same `dt`.
 * That last part is the whole reason the page is worth having: with two
 * `start()` loops each controller gets its own `Clock`, they drift apart inside
 * a second, and every difference you see is timing rather than the asset. Frame
 * locking makes the two images differ only where the geometry and the textures
 * differ.
 *
 * TWO IFRAMES, NOT TWO CONTROLLERS IN ONE DOCUMENT, and that is not fastidiousness.
 * `viewport.ts` is a module singleton and its own header says two controllers in
 * one document "is not a configuration that exists". The size half of it is
 * harmless here — both canvases are the same size — but `setCanvasOrigin` is
 * per-canvas and the second mount wins, so his station is solved against the
 * OTHER canvas's origin and he is drawn hundreds of pixels off. Measured: with
 * both controllers in one document, he rendered clipped to a sliver at the left
 * edge of both canvases, identically, because both were placed for the
 * right-hand one.
 *
 * An iframe is a document, so each side gets its own module instances and its
 * own correct origin. They are same-origin, so the shell reaches straight into
 * `contentWindow` and drives both from one rAF — no postMessage handshake, and
 * the lockstep survives.
 *
 * The cost is that the character runtime and three.js are instantiated twice.
 * That is the point of the page, and it is owner-only.
 *
 * The dropdown offers three files. Only `decke.glb` is tracked; the other two
 * are gitignored build artifacts, so a fresh clone sees this page with one
 * working option and two that report a 404 until they are regenerated:
 *
 *   # the "before" — recover the pre-optimization asset from git
 *   git show 30efc6e:apps/web/public/models/decke/decke.glb \
 *     > apps/web/public/models/decke/decke.orig.glb
 *
 *   # the "too far" — morph normals dropped, for the regression below
 *   node apps/web/scripts/decke/optimize.mjs \
 *     apps/web/public/models/decke/decke.orig.glb \
 *     apps/web/public/models/decke/decke.min.glb --tier=c
 *
 * Tier c is on the menu on purpose. It is the one change that is visibly worse,
 * so having it a dropdown away is what makes "you cannot see the difference" a
 * claim you can check rather than one you have to take on trust: switch the
 * right-hand side to it, hold `bend` at +1, and the shading goes wrong.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { DeckE } from '../../character/decke/DeckE'

/** The candidates, and what each one gives up. Kept here rather than derived so
 *  the page states the trade rather than just the filename. */
const MODELS: { file: string; label: string; note: string }[] = [
  {
    file: 'decke.orig.glb',
    label: 'decke.orig.glb (before)',
    note: 'float32 geometry · 1024² grain · 2850 KB, 1963 KB on the wire',
  },
  {
    file: 'decke.glb',
    label: 'decke.glb (shipped — tier b)',
    note: '12-bit positions, 8-bit normals, 256² grain · 592 KB, 337 KB on the wire',
  },
  {
    file: 'decke.min.glb',
    label: 'decke.min.glb (tier c — too far)',
    note: 'morph normals DROPPED · smaller, but bend repaints ~30% of him',
  },
]

/** Mirrors `/dev/decke`'s roster. Grouped so the panel reads like the
 *  character's vocabulary rather than an alphabetical dump. */
const STATE_GROUPS: { label: string; states: string[] }[] = [
  { label: 'Rest & lifecycle', states: ['idle', 'boot', 'listening', 'thinking', 'sleep'] },
  {
    label: 'Emotes',
    states: ['happy', 'sad', 'confused', 'frustrated', 'embarrassed', 'curious', 'proud'],
  },
  { label: 'Response (once, then idle)', states: ['nod_yes', 'shake_no'] },
  {
    label: 'Alert (a mode, not an emotion)',
    states: ['alert_money', 'alert_star', 'alert_warn', 'alert_error', 'alert_dizzy', 'alert_scribble'],
  },
  { label: 'Actions', states: ['loading', 'card_stash', 'card_show', 'card_present', 'point'] },
  { label: 'Travel (plays once)', states: ['travel_point', 'travel_far'] },
]

/**
 * The channels worth scrubbing by hand.
 *
 * `mouth` leads on purpose: it is the state under which the two cheapest wins
 * in `optimize.mjs` are most likely to show. Dropping morph normals leaves
 * shading at the closed-mouth pose while the lid swings open, and he is metallic
 * 0.85 with an HDRI, so if that is going to be visible anywhere it is here.
 */
const CHANNELS: { ch: string; min: number; max: number; label: string }[] = [
  { ch: 'mouth', min: 0, max: 2.09, label: 'mouth  (2.09 = full gape)' },
  { ch: 'm_curve', min: -1, max: 2, label: 'mouth curve  (smile → frown)' },
  { ch: 'bend', min: -1, max: 1, label: 'bend  (fwd / back)' },
  { ch: 'lean', min: -1, max: 1, label: 'lean' },
  { ch: 'twist', min: -1, max: 1, label: 'twist' },
  { ch: 'sq', min: -0.3, max: 0.6, label: 'squash / stretch' },
  { ch: 'lid_u', min: 0, max: 1, label: 'upper lids' },
  { ch: 'lid_l', min: 0, max: 1, label: 'lower lids' },
  { ch: 'brow', min: -1, max: 1, label: 'brows' },
  { ch: 'alert', min: -0.2, max: 1.2, label: 'alert reel  (position, not opacity)' },
]

type Side = { bytes: number | null; ms: number | null; error: string | null }

const fmtBytes = (n: number | null) =>
  n === null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(2)} MB` : `${(n / 1024).toFixed(0)} KB`

/** What one frame publishes for the shell to drive. */
type FrameApi = { decke: DeckE; bytes: number | null; ms: number }
type FrameWindow = Window & { __deckeFrame?: FrameApi; __deckeFrameError?: string }

export default function DeckeCompare() {
  // One route, two roles. `?frame=` renders a single bare canvas; without it we
  // are the shell that embeds two of those and drives them.
  const frame = new URLSearchParams(window.location.search).get('frame')
  if (frame) return <DeckeFrame />
  return <CompareShell />
}

/**
 * One canvas, one controller, nothing else — the thing the shell embeds.
 *
 * It publishes itself on `window.__deckeFrame` rather than posting messages:
 * the frames are same-origin with the shell by construction (it points them at
 * its own path), so the shell can hold the real object and call it in the same
 * tick as the other side. A message channel would put an async boundary in the
 * middle of the one thing this page exists to keep synchronous.
 */
function DeckeFrame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const params = new URLSearchParams(window.location.search)
    const modelFile = params.get('model') || 'decke.glb'
    let cancelled = false

    const decke = new DeckE({
      canvas,
      baseUrl: import.meta.env.BASE_URL,
      modelFile,
      characterHeightPx: 230,
      onError: (e) => {
        setError(String(e))
        ;(window as FrameWindow).__deckeFrameError = String(e)
      },
    })

    const measure = () => {
      const w = Math.round(canvas.clientWidth) || 400
      const h = Math.round(canvas.clientHeight) || 400
      decke.resize(w, h, h)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(canvas)
    ;(async () => {
      try {
        const t0 = performance.now()
        const bytes = await fetch(`${import.meta.env.BASE_URL}models/decke/${modelFile}`, {
          method: 'HEAD',
        })
          .then((r) => (r.ok ? Number(r.headers.get('content-length')) || null : null))
          .catch(() => null)
        await decke.load()
        if (cancelled) return
        // Not optional: he is metallic 0.85 and renders near-black with nothing
        // to reflect.
        const hdr = await new HDRLoader().loadAsync(
          `${import.meta.env.BASE_URL}models/decke/studio_small_09_256.hdr`,
        )
        if (cancelled) return
        decke.setEnvironment(hdr)
        // NEVER `start()`. The shell owns the clock — see this file's header.
        decke.step(1 / 60)
        ;(window as FrameWindow).__deckeFrame = {
          decke,
          bytes,
          ms: Math.round(performance.now() - t0),
        }
      } catch (e) {
        setError(String(e))
        ;(window as FrameWindow).__deckeFrameError = String(e)
      }
    })()

    return () => {
      cancelled = true
      ro.disconnect()
      decke.dispose()
      delete (window as FrameWindow).__deckeFrame
    }
  }, [])

  return (
    <div className="h-screen w-screen overflow-hidden bg-surface-primary">
      {/* Each frame is a whole app instance, so each one also renders
          `DevBackendRibbon` — three copies of the same banner, two of them
          sitting on top of the thing being compared. The shell keeps its own. */}
      <style>{'[role="status"].fixed.bottom-0{display:none!important}'}</style>
      {error ? (
        <pre className="p-[8px] text-[10px] text-action-danger-text">
          {error}
          {'\n\n'}If this is a 404, the candidate has not been generated yet — see
          DeckeCompare.tsx's header for the command.
        </pre>
      ) : null}
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  )
}

function CompareShell() {
  const leftFrame = useRef<HTMLIFrameElement | null>(null)
  const rightFrame = useRef<HTMLIFrameElement | null>(null)

  const [leftFile, setLeftFile] = useState('decke.orig.glb')
  const [rightFile, setRightFile] = useState('decke.glb')
  const [left, setLeft] = useState<Side>({ bytes: null, ms: null, error: null })
  const [right, setRight] = useState<Side>({ bytes: null, ms: null, error: null })
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [current, setCurrent] = useState('—')
  const [talking, setTalking] = useState(false)
  const [held, setHeld] = useState<Record<string, number>>({})
  const [rate, setRate] = useState(1)
  const rateRef = useRef(1)
  rateRef.current = rate

  const apis = useCallback((): DeckE[] => {
    const out: DeckE[] = []
    for (const f of [leftFrame.current, rightFrame.current]) {
      const api = (f?.contentWindow as FrameWindow | undefined)?.__deckeFrame
      if (api) out.push(api.decke)
    }
    return out
  }, [])

  /** Every control goes through here. Both controllers get the call in the SAME
   *  tick, which is what keeps their state machines aligned. */
  const both = useCallback(
    (fn: (d: DeckE) => void) => {
      for (const d of apis()) {
        try {
          fn(d)
        } catch (e) {
          console.error('decke-compare: command failed', e)
        }
      }
    },
    [apis],
  )

  // Wait for both frames to publish, then own the clock for both of them.
  useEffect(() => {
    let cancelled = false
    let raf = 0
    let last = performance.now()

    const read = (f: HTMLIFrameElement | null) =>
      (f?.contentWindow as FrameWindow | undefined)?.__deckeFrame

    const tick = () => {
      if (cancelled) return
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      const dt = Math.min((now - last) / 1000, 0.1) * rateRef.current
      last = now
      // ONE dt, BOTH controllers, same tick. Neither frame ever calls `start()`.
      for (const f of [leftFrame.current, rightFrame.current]) read(f)?.decke.step(dt)
    }

    // Poll for readiness rather than waiting on `load`: the iframe's document
    // fires `load` long before the glb, the HDRI and the first frame are done.
    const poll = window.setInterval(() => {
      const l = read(leftFrame.current)
      const r = read(rightFrame.current)
      const lErr = (leftFrame.current?.contentWindow as FrameWindow | undefined)?.__deckeFrameError
      const rErr = (rightFrame.current?.contentWindow as FrameWindow | undefined)?.__deckeFrameError
      if (lErr) setLeft((s) => (s.error === lErr ? s : { ...s, error: lErr }))
      if (rErr) setRight((s) => (s.error === rErr ? s : { ...s, error: rErr }))
      if (lErr || rErr) setStatus('error')
      if (!l || !r) return
      window.clearInterval(poll)
      setLeft({ bytes: l.bytes, ms: l.ms, error: null })
      setRight({ bytes: r.bytes, ms: r.ms, error: null })
      setStatus('ready')
      last = performance.now()
      raf = requestAnimationFrame(tick)
    }, 120)

    return () => {
      cancelled = true
      window.clearInterval(poll)
      cancelAnimationFrame(raf)
    }
  }, [leftFile, rightFile])

  const setState = useCallback(
    (name: string) => {
      setCurrent(name)
      both((d) => d.setState(name))
    },
    [both],
  )

  const holdChannel = useCallback(
    (ch: string, v: number | null) => {
      setHeld((h) => {
        const next = { ...h }
        if (v === null) delete next[ch]
        else next[ch] = v
        return next
      })
      both((d) => d.setChannel(ch, v))
    },
    [both],
  )

  const sizes = useMemo(() => {
    if (left.bytes === null || right.bytes === null || !left.bytes) return null
    const pct = (1 - right.bytes / left.bytes) * 100
    return { pct, delta: left.bytes - right.bytes }
  }, [left.bytes, right.bytes])

  return (
    <div className="min-h-screen bg-surface-primary p-[16px]">
      <header className="mb-[12px]">
        <h1 className="text-[18px] font-bold">Deck-E — shipped vs optimized</h1>
        <p className="mt-[2px] font-mono text-[11px] text-text-muted">
          both controllers stepped from ONE rAF with the same dt · state{' '}
          <span className="text-text-primary">{current}</span>
          {talking ? ' · talking' : ''} ·{' '}
          {status === 'ready' ? (
            <span className="text-text-primary">ready</span>
          ) : status === 'loading' ? (
            'loading…'
          ) : (
            <span className="text-action-danger-text">error</span>
          )}
          {sizes ? (
            <>
              {' · '}
              <span className="text-text-primary">
                {sizes.pct.toFixed(1)}% smaller ({fmtBytes(sizes.delta)} saved)
              </span>
            </>
          ) : null}
        </p>
      </header>

      {/* ------------------------------------------------------ the two views */}
      <div className="grid grid-cols-2 gap-[12px]">
        {([
          { side: left, file: leftFile, setFile: setLeftFile, ref: leftFrame, key: 'L' },
          { side: right, file: rightFile, setFile: setRightFile, ref: rightFrame, key: 'R' },
        ] as const).map((pane) => {
          const meta = MODELS.find((m) => m.file === pane.file)
          return (
            <div
              key={pane.key}
              className="rounded border border-border-default bg-surface-secondary p-[8px]"
            >
              <div className="mb-[6px] flex items-center gap-[8px]">
                <select
                  aria-label={`model ${pane.key}`}
                  value={pane.file}
                  onChange={(e) => pane.setFile(e.target.value)}
                  className="rounded border border-border-default bg-surface-primary px-[6px] py-[3px] font-mono text-[11px]"
                >
                  {MODELS.map((m) => (
                    <option key={m.file} value={m.file}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <span className="font-mono text-[11px] text-text-primary">
                  {fmtBytes(pane.side.bytes)}
                </span>
                <span className="font-mono text-[11px] text-text-muted">
                  {pane.side.ms === null ? '' : `${pane.side.ms} ms`}
                </span>
              </div>
              <p className="mb-[6px] font-mono text-[10px] text-text-muted">{meta?.note}</p>
              {pane.side.error ? (
                <pre className="mb-[6px] overflow-x-auto rounded border border-border-default p-[6px] text-[10px] text-action-danger-text">
                  {pane.side.error}
                  {'\n\n'}
                  If this is a 404, the candidate has not been generated yet — see this file's
                  header for the two commands.
                </pre>
              ) : null}
              {/* Same origin by construction — the src is this route's own
                  path — which is what lets the shell hold the controller
                  object and step both sides in one tick. */}
              <iframe
                ref={pane.ref}
                title={`deck-e ${pane.key}`}
                src={`${window.location.pathname}?frame=${pane.key.toLowerCase()}&model=${encodeURIComponent(pane.file)}`}
                className="block h-[520px] w-full rounded border-0 bg-black/20"
              />
            </div>
          )
        })}
      </div>

      {/* -------------------------------------------------------- the controls */}
      <div className="mt-[12px] grid gap-[12px] lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-[10px]">
          {STATE_GROUPS.map((g) => (
            <Panel key={g.label} title={g.label}>
              <div className="flex flex-wrap gap-[6px]">
                {g.states.map((s) => (
                  <Btn key={s} active={current === s} onClick={() => setState(s)}>
                    {s}
                  </Btn>
                ))}
              </div>
            </Panel>
          ))}

          <Panel title="Overlay, facing and cards">
            <div className="flex flex-wrap items-center gap-[6px]">
              <Btn
                active={talking}
                onClick={() => {
                  const next = !talking
                  setTalking(next)
                  both((d) => d.setOverlay(next ? 'talk' : null, 1))
                }}
              >
                talk overlay
              </Btn>
              <Btn onClick={() => both((d) => d.setFacing(1))}>facing +1</Btn>
              <Btn onClick={() => both((d) => d.setFacing(0))}>facing 0</Btn>
              <Btn onClick={() => both((d) => d.setFacing(-1))}>facing −1</Btn>
              {[0, 1, 5, 12].map((n) => (
                <Btn key={n} onClick={() => both((d) => d.setStashCount(n))}>
                  stash {n}
                </Btn>
              ))}
            </div>
          </Panel>
        </div>

        <div className="flex flex-col gap-[10px]">
          <Panel title="Playback">
            <label className="block font-mono text-[11px] text-text-muted">
              rate ×{rate.toFixed(2)} — slow it down to watch a morph cross the pose
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
                className="mt-[4px] w-full"
              />
            </label>
            <div className="mt-[6px] flex flex-wrap gap-[6px]">
              <Btn onClick={() => setRate(1)}>1×</Btn>
              <Btn onClick={() => setRate(0.25)}>¼×</Btn>
              <Btn
                onClick={() => {
                  // One 60 Hz frame into both, while the rate is at zero — the
                  // only way to step a transition beat by beat.
                  both((d) => d.step(1 / 60))
                }}
              >
                step 1 frame
              </Btn>
              <Btn onClick={() => setRate(0)}>pause</Btn>
            </div>
          </Panel>

          <Panel title="Channels (held on both until released)">
            <p className="mb-[6px] text-[11px] text-text-muted">
              A held channel pins the raw value through every state.{' '}
              <b>mouth is the one that matters</b> for morph-normal changes: the lid swings
              through its whole range and the shading has to follow it.
            </p>
            {CHANNELS.map((c) => (
              <div key={c.ch} className="mb-[6px]">
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span className="text-text-muted">{c.label}</span>
                  <span className="text-text-primary">
                    {held[c.ch] === undefined ? 'free' : held[c.ch].toFixed(3)}
                  </span>
                </div>
                <div className="flex items-center gap-[6px]">
                  <input
                    aria-label={c.ch}
                    type="range"
                    min={c.min}
                    max={c.max}
                    step={0.001}
                    value={held[c.ch] ?? 0}
                    onChange={(e) => holdChannel(c.ch, Number(e.target.value))}
                    className="w-full"
                  />
                  <Btn onClick={() => holdChannel(c.ch, null)}>free</Btn>
                </div>
              </div>
            ))}
            <Btn
              onClick={() => {
                setHeld({})
                both((d) => d.clearOverrides())
              }}
            >
              release all
            </Btn>
          </Panel>
        </div>
      </div>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded border border-border-default bg-surface-secondary p-[10px]">
      <h2 className="mb-[6px] text-[12px] font-bold">{title}</h2>
      {children}
    </section>
  )
}

function Btn({
  children,
  onClick,
  active,
}: {
  children: ReactNode
  onClick: () => void
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'rounded border px-[8px] py-[3px] font-mono text-[11px] ' +
        (active
          ? 'border-border-default bg-surface-primary text-text-primary'
          : 'border-border-default text-text-muted hover:text-text-primary')
      }
    >
      {children}
    </button>
  )
}
