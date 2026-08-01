import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearch, useNavigate } from '@tanstack/react-router'
import { api, type ScanMatch, type ScanResponse } from '../lib/api'
import { Content } from '../components/ui'
import { CardImage } from '../components/CardImage'
import { CardSheet } from './CardDetail'
import { Icon } from '../components/Icon'
import { fmtNumber } from '../lib/format'

// The scanner (Phase 8 flagship). A live rear-camera view is embedded in the page
// with a card-shaped alignment guide; frames are grabbed continuously, cropped to
// the guide, and POSTed to /scan. When a confident match (Hamming distance ≤
// threshold) repeats across two consecutive frames, the result auto-appears with a
// one-tap "Add to collection" — no shutter button. Where the camera is unavailable
// (desktop, or a non-secure http:// origin where getUserMedia is blocked) it falls
// back cleanly to the original file-upload path.

// ── tuning ──────────────────────────────────────────────────────────────────
const FRAME_MS = 700 // how often we grab + send a frame while live
const STABLE_FRAMES = 2 // identical confident matches in a row before we commit
const CARD_ASPECT = 63 / 88 // TCG card width:height — the guide + capture aspect
// Capture MARGIN beyond the guide (each dimension, total). A card that's tilted
// or a touch outside the brackets gets clipped by an exact-guide crop, and no
// server-side probe can recover pixels that were never sent — a 4°-tilted card
// filling the guide already overflows it. The server trims the extra background
// away and probes rotations, so loose framing costs nothing (measured: exact-
// guide crop of an overflowing card ~81% top-1; margin+trim ~98%).
const CAPTURE_MARGIN = 1.14

function confidencePct(c: number): number {
  return Math.round(c * 100)
}

// Crop the live video frame to the on-screen alignment guide plus a small
// margin, mapping through the <video>'s object-fit:cover scaling so what the
// user frames is what we hash. The margin keeps a tilted or slightly-misplaced
// card fully inside the sent frame; the server's background trim + rotation
// probes take it from there. Returns a JPEG blob; null until the stream has
// real pixels.
async function captureGuide(video: HTMLVideoElement, guide: HTMLElement): Promise<Blob | null> {
  const VW = video.videoWidth
  const VH = video.videoHeight
  if (!VW || !VH) return null
  const vr = video.getBoundingClientRect()
  const gr = guide.getBoundingClientRect()
  if (!vr.width || !vr.height) return null
  // object-fit: cover — the video is scaled by `s` and centre-cropped in its box.
  const s = Math.max(vr.width / VW, vr.height / VH)
  const dispW = VW * s
  const dispH = VH * s
  const originX = vr.left + (vr.width - dispW) / 2 // css-x of the video's source (0,0)
  const originY = vr.top + (vr.height - dispH) / 2
  // Guide rect, margin-expanded about its centre, back into source-video pixels.
  const mw = (gr.width * (CAPTURE_MARGIN - 1)) / 2
  const mh = (gr.height * (CAPTURE_MARGIN - 1)) / 2
  const sx = Math.max(0, (gr.left - mw - originX) / s)
  const sy = Math.max(0, (gr.top - mh - originY) / s)
  const sw = Math.min(VW - sx, (gr.width + 2 * mw) / s)
  const sh = Math.min(VH - sy, (gr.height + 2 * mh) / s)
  if (sw < 8 || sh < 8) return null
  const outW = 480
  const outH = Math.round((outW * sh) / sw)
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, outW, outH)
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85))
}

function MatchTile({ match, best }: { match: ScanMatch; best: boolean }) {
  const [state, setState] = useState<'idle' | 'adding' | 'added' | 'error'>('idle')
  const pct = confidencePct(match.confidence)

  const add = async () => {
    setState('adding')
    try {
      await api.setCardHave(match.cardId, true)
      setState('added')
    } catch {
      setState('error')
    }
  }

  const tile = (
    <div className="relative">
      <CardImage low={match.images.low} high={match.images.high} alt={`${match.name} — ${fmtNumber(match.number)}`} radius={8} />
      {best && (
        <span className="absolute left-[8px] top-[8px] rounded-md bg-action-primary-strong px-[8px] py-[3px] text-[11px] font-bold leading-[16px] text-action-primary-strong-text shadow-panel">
          Best match
        </span>
      )}
    </div>
  )

  return (
    <div className="flex flex-col gap-[8px] rounded-xl border border-border-default bg-surface-secondary p-[10px]">
      {/* Open the card-detail bottom-sheet over the scanner (a ?card=<cardId>
          search change that keeps Scan mounted → camera/result state survive)
          instead of a full-page navigation to the standalone card route. */}
      <Link
        to="/scan"
        search={((prev: { card?: string }) => ({ ...prev, card: match.cardId })) as never}
        resetScroll={false}
        className="group block"
      >
        {tile}
      </Link>

      <div className="min-w-0">
        <div className="truncate text-[15px] font-semibold leading-[20px] text-text-primary">{match.name}</div>
        <div className="flex items-center justify-between text-[12px] text-text-muted">
          <span className="truncate">{match.setName} · {fmtNumber(match.number)}</span>
          {match.rarity && <span className="shrink-0">{match.rarity}</span>}
        </div>
      </div>

      {/* confidence meter — honest bit-similarity, distance shown raw */}
      <div>
        <div className="mb-[3px] flex items-center justify-between text-[11px]">
          <span className="text-text-muted">Match</span>
          <span className="font-bold text-text-primary">
            {pct}% <span className="font-normal text-text-muted">· dist {match.distance}</span>
          </span>
        </div>
        <div className="h-[5px] w-full overflow-hidden rounded-full bg-[#1a1d24]">
          <div
            className="h-full rounded-full"
            style={{
              width: `${pct}%`,
              background: best ? 'var(--color-change-positive)' : 'var(--color-action-brand)',
            }}
          />
        </div>
      </div>

      <button
        onClick={add}
        disabled={state === 'adding' || state === 'added'}
        className={`flex h-[38px] items-center justify-center gap-[7px] rounded-full text-[13px] font-bold transition-colors disabled:opacity-70 ${
          state === 'added'
            ? 'bg-change-positive text-surface-primary'
            : 'bg-action-primary text-action-primary-text hover:bg-action-primary-hover'
        }`}
      >
        {state === 'added' ? (
          <><Icon name="check" size={16} /> Added</>
        ) : state === 'adding' ? (
          'Adding…'
        ) : state === 'error' ? (
          <><Icon name="alert" size={15} /> Retry</>
        ) : (
          <><Icon name="plus" size={16} /> Add to collection</>
        )}
      </button>
    </div>
  )
}

// ── the live camera stage ─────────────────────────────────────────────────────
type CamState = 'init' | 'requesting' | 'live' | 'denied' | 'unavailable' | 'error'

// Alignment-guide overlay: a card-shaped cutout (dark scrim outside via a huge
// box-shadow) with corner brackets and a sweeping scan line. `hint` narrates state.
function GuideOverlay({ guideRef, hint, active }: { guideRef: React.RefObject<HTMLDivElement | null>; hint: string; active: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div
        ref={guideRef}
        className="relative rounded-2xl"
        style={{
          height: '82%',
          aspectRatio: `${CARD_ASPECT}`,
          maxWidth: '88%',
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
          border: `2px solid ${active ? 'rgba(120,220,160,0.95)' : 'rgba(255,255,255,0.55)'}`,
          transition: 'border-color 200ms',
        }}
      >
        {/* corner brackets */}
        {[
          'left-[-2px] top-[-2px] border-l-[3px] border-t-[3px] rounded-tl-2xl',
          'right-[-2px] top-[-2px] border-r-[3px] border-t-[3px] rounded-tr-2xl',
          'left-[-2px] bottom-[-2px] border-l-[3px] border-b-[3px] rounded-bl-2xl',
          'right-[-2px] bottom-[-2px] border-r-[3px] border-b-[3px] rounded-br-2xl',
        ].map((c) => (
          <span key={c} className={`absolute h-[26px] w-[26px] border-white/90 ${c}`} />
        ))}
        {/* scan sweep while actively looking */}
        {active && (
          <span
            className="absolute inset-x-[6px] h-[2px] rounded-full"
            style={{
              background: 'linear-gradient(90deg, transparent, rgba(120,220,160,0.9), transparent)',
              animation: 'scanSweep 1.8s ease-in-out infinite',
            }}
          />
        )}
      </div>
      <div className="absolute bottom-[14px] left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-[14px] py-[6px] text-[13px] font-semibold text-white backdrop-blur">
        {hint}
      </div>
      <style>{`@keyframes scanSweep{0%{top:6%}50%{top:90%}100%{top:6%}}`}</style>
    </div>
  )
}

export function Scan() {
  const search = useSearch({ from: '/scan' })
  const navigate = useNavigate({ from: '/scan' })
  const [preview, setPreview] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false) // an upload/file scan is in flight
  const [result, setResult] = useState<ScanResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [camState, setCamState] = useState<CamState>('init')
  const [hint, setHint] = useState('Point the camera at a card')

  const fileRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const guideRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const busyRef = useRef(false) // single in-flight frame scan
  const abortRef = useRef<AbortController | null>(null)
  const stableRef = useRef<{ cardId: string; count: number }>({ cardId: '', count: 0 })
  const pausedRef = useRef(false) // freeze the loop while a result is shown

  const supportsCamera = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

  const stopStream = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
    abortRef.current?.abort()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  // One frame: crop to guide → POST → confidence + stability bookkeeping.
  const scanFrame = useCallback(async () => {
    if (busyRef.current || pausedRef.current) return
    const video = videoRef.current
    const guide = guideRef.current
    if (!video || !guide || video.readyState < 2) return
    busyRef.current = true
    try {
      const blob = await captureGuide(video, guide)
      if (!blob) return
      abortRef.current = new AbortController()
      const bytes = await blob.arrayBuffer()
      const res = await api.scan(bytes, 'image/jpeg', 5, 'low', abortRef.current.signal)
      if (pausedRef.current) return
      const top = res.matched ? res.matches[0] : undefined
      if (top) {
        const s = stableRef.current
        s.count = s.cardId === top.cardId ? s.count + 1 : 1
        s.cardId = top.cardId
        if (s.count >= STABLE_FRAMES) {
          // Locked in — stop grabbing frames and surface the result.
          pausedRef.current = true
          if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
          setHint('Match found')
          setResult(res)
          setPreview(null)
        } else {
          setHint('Hold steady…')
        }
      } else {
        stableRef.current = { cardId: '', count: 0 }
        setHint('Point the camera at a card')
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        /* transient decode/network blip — keep looping, don't nag the user */
      }
    } finally {
      busyRef.current = false
    }
  }, [])

  const startCamera = useCallback(async () => {
    if (!supportsCamera) { setCamState('unavailable'); return }
    setCamState('requesting')
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      const video = videoRef.current
      if (!video) { stream.getTracks().forEach((t) => t.stop()); return }
      video.srcObject = stream
      await video.play().catch(() => {})
      setCamState('live')
      pausedRef.current = false
      stableRef.current = { cardId: '', count: 0 }
      setHint('Point the camera at a card')
      if (tickRef.current) clearInterval(tickRef.current)
      tickRef.current = setInterval(() => void scanFrame(), FRAME_MS)
    } catch (e) {
      const name = (e as Error).name
      setCamState(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error')
    }
  }, [supportsCamera, scanFrame])

  // Auto-start on mount when supported; always tear the stream down on unmount.
  useEffect(() => {
    if (supportsCamera) void startCamera()
    else setCamState('unavailable')
    return () => stopStream()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Resume scanning after a result (from camera or upload) is dismissed.
  const scanAnother = useCallback(() => {
    setResult(null)
    setPreview(null)
    setError(null)
    stableRef.current = { cardId: '', count: 0 }
    pausedRef.current = false
    if (camState === 'live') {
      setHint('Point the camera at a card')
      if (!tickRef.current) tickRef.current = setInterval(() => void scanFrame(), FRAME_MS)
    } else if (supportsCamera) {
      void startCamera()
    }
  }, [camState, supportsCamera, startCamera, scanFrame])

  // Upload / file fallback (also the whole experience on desktop / http origins).
  const runScan = useCallback(async (file: File) => {
    setError(null)
    setResult(null)
    pausedRef.current = true // don't let the camera loop clobber an upload result
    setScanning(true)
    const reader = new FileReader()
    reader.onload = () => setPreview(reader.result as string)
    reader.readAsDataURL(file)
    try {
      const bytes = await file.arrayBuffer()
      const res = await api.scan(bytes, file.type || 'image/jpeg', 5, 'low')
      setResult(res)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setScanning(false)
    }
  }, [])

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void runScan(file)
    e.target.value = ''
  }

  // A single <video> stays mounted whenever the camera path is possible and no
  // result is showing — the ref never churns across init→requesting→live→denied.
  const showStage = supportsCamera && !result
  const onStage = camState === 'requesting' || camState === 'live' // camera actually in play
  const showResult = !!result && !scanning

  return (
    <Content cap={1000}>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPick} />

      <div className="mb-[8px] flex items-center gap-[10px]">
        <span className="flex h-[40px] w-[40px] items-center justify-center rounded-lg bg-action-primary text-action-primary-text">
          <Icon name="camera" size={22} />
        </span>
        <h1 className="text-[28px] font-bold leading-[34px] text-text-primary">Scan a card</h1>
      </div>
      <p className="mb-[20px] max-w-[560px] text-[14px] leading-[21px] text-text-muted">
        Line a card up inside the frame and hold steady — we match it against the{' '}
        {result ? result.indexSize.toLocaleString() : '22,770'}-card catalog by perceptual hash and add it to your
        collection in one tap. No shutter button; it triggers on its own.
      </p>

      {/* ── live camera stage (single, always-mounted <video>) ────────── */}
      {showStage && (
        <div className="relative mx-auto aspect-[3/4] w-full max-w-[440px] overflow-hidden rounded-2xl bg-black">
          <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" />
          {onStage && <GuideOverlay guideRef={guideRef} hint={hint} active={camState === 'live'} />}
          {camState === 'requesting' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-[14px] text-white">
              Starting camera…
            </div>
          )}
          {camState === 'denied' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-[10px] bg-black/70 p-[20px] text-center text-[13px] text-white">
              <Icon name="camera" size={30} />
              <div>Camera access was blocked. Allow it in your browser, or upload an image below.</div>
              <button
                onClick={() => void startCamera()}
                className="rounded-full bg-white/15 px-[16px] py-[8px] text-[13px] font-bold text-white hover:bg-white/25"
              >
                Try camera again
              </button>
            </div>
          )}
          {camState === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-[10px] bg-black/70 p-[20px] text-center text-[13px] text-white">
              <Icon name="alert" size={28} />
              <div>Couldn’t start the camera.</div>
              <button
                onClick={() => void startCamera()}
                className="rounded-full bg-white/15 px-[16px] py-[8px] text-[13px] font-bold text-white hover:bg-white/25"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      )}

      {/* controls under the stage */}
      {!result && (
        <div className="mt-[16px] flex flex-wrap items-center justify-center gap-[12px]">
          {camState === 'unavailable' && (
            <div className="w-full rounded-xl border border-border-default bg-surface-secondary p-[14px] text-center text-[13px] text-text-muted">
              Live camera isn’t available here (it needs a secure <span className="font-mono">https</span> connection and a
              rear camera). Upload a photo instead — matching works the same way.
            </div>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            className="flex h-[46px] items-center gap-[8px] rounded-full bg-surface-tertiary px-[20px] text-[14px] font-bold text-text-primary hover:bg-action-default-hover"
          >
            <Icon name="download" size={18} className="rotate-180" /> Upload image
          </button>
        </div>
      )}

      {/* upload preview + drop zone — shown when the live camera isn't in play */}
      {!onStage && !result && (
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const file = e.dataTransfer.files?.[0]
            if (file) void runScan(file)
          }}
          className="mt-[16px] flex min-h-[200px] cursor-pointer flex-col items-center justify-center gap-[10px] rounded-2xl border-2 border-dashed border-action-ghost-border bg-surface-secondary/50 p-[20px] text-center hover:border-border-focus"
        >
          {preview ? (
            <img src={preview} alt="Card to scan" className="max-h-[300px] rounded-lg object-contain" />
          ) : (
            <>
              <Icon name="camera" size={40} className="text-icon-muted" />
              <div className="text-[15px] font-semibold text-text-primary">Drop an image here, or click to browse</div>
              <div className="text-[12px] text-text-muted">JPEG, PNG or WebP · a clear, straight-on shot works best</div>
            </>
          )}
        </div>
      )}

      {/* status while an upload scan runs */}
      {scanning && (
        <div className="mt-[24px] flex items-center justify-center gap-[12px] py-[24px] text-text-muted">
          <div className="h-[28px] w-[28px] animate-spin rounded-full border-2 border-surface-tertiary border-t-action-primary" />
          <span className="text-[14px]">Scanning…</span>
        </div>
      )}

      {error && !scanning && (
        <div className="mt-[24px] flex items-center gap-[10px] rounded-xl border border-border-default bg-surface-secondary p-[16px] text-[14px] text-error">
          <Icon name="alert" size={18} /> Couldn’t scan that image: {error}
        </div>
      )}

      {/* ── result ─────────────────────────────────────────────────────── */}
      {showResult && (
        <div className="mt-[24px]">
          <div className="mb-[14px] flex items-center justify-between">
            <div className="flex items-center gap-[8px] text-[13px] font-bold text-text-secondary">
              <span className="uppercase tracking-wide">{result!.matched ? 'Matches' : 'Closest guesses'}</span>
              <span className="text-text-muted">({result!.matches.length})</span>
            </div>
            <button
              onClick={scanAnother}
              className="flex h-[38px] items-center gap-[7px] rounded-full bg-action-primary px-[16px] text-[13px] font-bold text-action-primary-text hover:bg-action-primary-hover"
            >
              <Icon name="camera" size={16} /> Scan another
            </button>
          </div>

          {!result!.matched && (
            <div className="mb-[16px] flex flex-col items-center gap-[8px] rounded-2xl border border-border-default bg-surface-secondary p-[24px] text-center">
              <Icon name="search" size={30} className="text-icon-muted" />
              <div className="text-[16px] font-bold text-text-primary">No confident match</div>
              <div className="max-w-[420px] text-[13px] text-text-muted">
                Couldn’t confidently identify this card. Fill the frame with the card, straight-on and glare-free.
                {result!.matches.length > 0 && ' The closest guesses are below — treat them with caution.'}
              </div>
            </div>
          )}

          {result!.matches.length > 0 && (
            <div className="grid gap-[16px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
              {result!.matches.map((m, i) => (
                <MatchTile key={m.cardId} match={m} best={result!.matched && i === 0} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Card detail as a bottom-sheet driven by the ?card=<cardId> search param —
          keeps Scan mounted so the camera stream + match list survive the sheet. */}
      {search.card && (
        <CardSheet
          cardId={search.card}
          onClose={() =>
            navigate({ search: ((prev: { card?: string }) => ({ ...prev, card: undefined })) as never, resetScroll: false })
          }
        />
      )}
    </Content>
  )
}
