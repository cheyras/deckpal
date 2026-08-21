import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearch, useNavigate } from '@tanstack/react-router'
import { api, type ScanMatch, type ScanResponse } from '../lib/api'
import {
  chooseVariant,
  emptyRip,
  onFrame,
  removeEntry,
  setQuantity,
  setVariants,
  type RipState,
} from '../character/host/ripSession'
import { commitRip } from '../character/host/ripCommit'
import { attendRip, reactToPull, RIP_LANDMARK } from '../character/host/ripPresence'
import { Content, Spinner, ProgressBar } from '../components/ui'
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
// Consecutive failed frame scans before the live loop admits something is wrong.
// The loop used to swallow every error to avoid nagging over one dropped frame,
// which is exactly how a totally broken scanner presented as "isn't detecting any
// card" with no error anywhere (issue #20). One blip is still silent; three in a
// row is a fact the user deserves.
const FRAME_FAIL_LIMIT = 3

// Upload normalisation. Two hard limits meet here: the hosted API rejects a
// request body over 4.5 MB before our handler ever sees it, and an iPhone's photo
// library hands out HEIC, which the server-side decoder does not read. Both are
// the same fix — draw the picture into a canvas and re-encode it as a modest
// JPEG, which also strips EXIF and bakes in the rotation. Files that are already
// small and in a format we decode go over the wire byte-for-byte, so scanning a
// catalog image still lands at distance 0.
const DIRECT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const DIRECT_MAX_BYTES = 3 * 1024 * 1024
const NORMALIZED_EDGE = 1400

function confidencePct(c: number): number {
  return Math.round(c * 100)
}

/** Decode a picked file to something drawable, honouring EXIF orientation. */
async function decodeForCanvas(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      /* Safari has refused blobs it can still render in an <img>; fall through. */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('that file could not be read as an image'))
      img.src = url
    })
    return { ...(img as unknown as CanvasImageSource), width: img.naturalWidth, height: img.naturalHeight } as never
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** The bytes to POST for a picked file — original when safe, re-encoded when not. */
async function toScanBytes(file: File): Promise<{ bytes: ArrayBuffer; type: string }> {
  if (DIRECT_TYPES.has(file.type) && file.size <= DIRECT_MAX_BYTES) {
    return { bytes: await file.arrayBuffer(), type: file.type || 'image/jpeg' }
  }
  const src = await decodeForCanvas(file)
  const scale = Math.min(1, NORMALIZED_EDGE / Math.max(src.width, src.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(src.width * scale))
  canvas.height = Math.max(1, Math.round(src.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('this browser could not prepare the image')
  ctx.drawImage(src as CanvasImageSource, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85))
  if (!blob) throw new Error('this browser could not prepare the image')
  return { bytes: await blob.arrayBuffer(), type: 'image/jpeg' }
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
        <span className="absolute left-[8px] top-[8px] rounded-md bg-action-primary-strong px-[8px] py-[3px] text-[14px] font-bold leading-[16px] text-action-primary-strong-text shadow-panel">
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
        <div className="flex items-center justify-between text-[14px] text-text-muted">
          <span className="truncate">{match.setName} · {fmtNumber(match.number)}</span>
          {match.rarity && <span className="shrink-0">{match.rarity}</span>}
        </div>
      </div>

      {/* confidence meter — honest bit-similarity, distance shown raw */}
      <div>
        <div className="mb-[3px] flex items-center justify-between text-[14px]">
          <span className="text-text-muted">Match</span>
          <span className="font-bold text-text-primary">
            {pct}% <span className="font-normal text-text-muted">· dist {match.distance}</span>
          </span>
        </div>
        <ProgressBar pct={pct} height={5} fill={best ? 'var(--color-change-positive)' : 'var(--color-action-brand)'} />
      </div>

      <button
        onClick={add}
        disabled={state === 'adding' || state === 'added'}
        className={`flex h-[38px] items-center justify-center gap-[7px] rounded-full text-[14px] font-bold transition-colors disabled:opacity-70 ${
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
      <div className="absolute bottom-[14px] left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-[14px] py-[6px] text-[14px] font-semibold text-white backdrop-blur">
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
  const cancelledRef = useRef(false)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const busyRef = useRef(false) // single in-flight frame scan
  const frameFailRef = useRef(0) // consecutive failed frame scans
  const abortRef = useRef<AbortController | null>(null)
  const stableRef = useRef<{ cardId: string; count: number }>({ cardId: '', count: 0 })
  const pausedRef = useRef(false) // freeze the loop while a result is shown

  // ── Rip mode ────────────────────────────────────────────────────────────────
  //
  // The single-card flow above STOPS once a match is stable, which is right when
  // you are checking one card and wrong for a pack. Rip mode keeps the loop
  // running and accumulates distinct cards instead; `ripSession.ts` owns the
  // "distinct" part, which is the hard half — a card held steady re-stabilises
  // about every 1.4 s, so the obvious dedup rule logs one card three times.
  const [rip, setRip] = useState(false)
  const [ripState, setRipState] = useState<RipState>(emptyRip)
  const ripRef = useRef<RipState>(ripState)
  ripRef.current = ripState
  const ripOnRef = useRef(false)
  ripOnRef.current = rip

  // He comes over when there is a list to stand next to, and goes back to his
  // own business when it is gone. Keyed on the list EXISTING rather than on rip
  // mode being on, because the panel is what he flies to and it is not in the
  // DOM until the first card lands.
  const hasRipList = rip && ripState.entries.length > 0
  useEffect(() => {
    attendRip(hasRipList)
    return () => attendRip(false)
  }, [hasRipList])

  // Cards whose variants have been requested, so a card re-shown after leaving
  // the frame does not fire a second identical lookup.
  const variantsAsked = useRef(new Set<string>())
  /**
   * Start a fresh session.
   *
   * The two must be cleared TOGETHER. `variantsAsked` exists so a card re-shown
   * during one rip does not refetch, but it outlived the session it belonged to:
   * on the second pack the same card early-returned, so its row kept
   * `variants: []`, no printing selector rendered, and it committed as the
   * primary printing — reinstating, from pack two onwards, the exact mis-filing
   * the selector was added to prevent.
   */
  const resetRip = useCallback(() => {
    setRipState(emptyRip())
    variantsAsked.current.clear()
  }, [])
  const loadVariants = useCallback(async (cardId: string) => {
    if (variantsAsked.current.has(cardId)) return
    variantsAsked.current.add(cardId)
    try {
      const card = await api.card(cardId)
      // He reacts on the CATALOG's answer rather than on the commit, because the
      // commit knows a name and a hash and not whether the pull was worth
      // anything. One reaction per card, chosen once the rarity is known.
      reactToPull(card.card.rarity)
      setRipState((st) =>
        setVariants(
          st,
          cardId,
          card.variants.map((v) => ({
            variantId: v.variantId,
            displayName: v.displayName,
            isPrimary: v.isPrimary,
          })),
        ),
      )
    } catch {
      // Left silent on purpose. The row still commits — `commitRip` falls back to
      // resolving the primary printing itself — so a failed lookup costs the
      // reader the CHOICE, not the card.
      variantsAsked.current.delete(cardId)
    }
  }, [])
  const [committing, setCommitting] = useState(false)

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
      frameFailRef.current = 0
      setError(null)
      const top = res.matched ? res.matches[0] : undefined

      // RIP MODE NEVER PAUSES. Every frame is fed to the session machine, which
      // decides whether anything new arrived; the loop just keeps going.
      if (ripOnRef.current) {
        const { state, committed } = onFrame(
          ripRef.current,
          top ? { cardId: top.cardId, name: top.name, distance: top.distance } : null,
          Date.now(),
        )
        ripRef.current = state
        setRipState(state)
        // Ask the catalog what printings this card has, once, as it lands. Doing
        // it here rather than at commit means the reader can correct a reverse
        // holo while the pack is still in their hand, which is the only moment
        // they actually remember which one it was.
        if (committed) void loadVariants(committed.cardId)
        setHint(
          committed
            ? `Got it — ${committed.name}`
            : top
              ? 'Hold steady…'
              : 'Show me the next card',
        )
        return
      }

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
        // One blip is transient — keep looping. A run of them is not the user
        // holding the card badly, it is the scanner being down, and pretending
        // otherwise is what made issue #20 look like "detects nothing".
        frameFailRef.current += 1
        if (frameFailRef.current >= FRAME_FAIL_LIMIT) {
          if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
          setHint('Scanning is unavailable')
          setError((e as Error).message)
        }
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
      if (cancelledRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream
      const video = videoRef.current
      if (!video) { stream.getTracks().forEach((t) => t.stop()); return }
      video.srcObject = stream
      await video.play().catch(() => {})
      setCamState('live')
      pausedRef.current = false
      stableRef.current = { cardId: '', count: 0 }
      frameFailRef.current = 0
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
    cancelledRef.current = false
    if (supportsCamera) void startCamera()
    else setCamState('unavailable')
    return () => {
      cancelledRef.current = true
      stopStream()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Resume scanning after a result (from camera or upload) is dismissed.
  const scanAnother = useCallback(() => {
    setResult(null)
    setPreview(null)
    setError(null)
    stableRef.current = { cardId: '', count: 0 }
    frameFailRef.current = 0
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
      const { bytes, type } = await toScanBytes(file)
      const res = await api.scan(bytes, type, 5, 'low')
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

      {/* ── rip mode: the running list ──────────────────────────────────
          BESIDE the camera, never over it. The whole point of the visual
          feedback is knowing he got the card so you know to move on, and a
          list that covers the lens defeats the thing it is confirming. */}
      {showStage && supportsCamera && (
        <div className="mx-auto mb-[12px] flex w-full max-w-[440px] items-center justify-between gap-[10px]">
          <button
            type="button"
            onClick={() => { setRip((r) => !r); resetRip(); setResult(null) }}
            className={[
              'h-[36px] rounded-full px-[14px] text-[13px] font-semibold transition-colors',
              rip
                ? 'bg-action-primary text-action-primary-text'
                : 'bg-surface-secondary text-text-body hover:text-text-primary',
            ].join(' ')}
          >
            {rip ? 'Ripping a pack' : 'Rip a pack'}
          </button>
          {rip && (
            <span className="text-[13px] text-text-muted">
              {ripState.entries.length === 0
                ? 'Show me each card as you pull it'
                : `${ripState.entries.reduce((n, e) => n + e.quantity, 0)} card${
                    ripState.entries.reduce((n, e) => n + e.quantity, 0) === 1 ? '' : 's'
                  } so far`}
            </span>
          )}
        </div>
      )}

      {rip && ripState.entries.length > 0 && (
        <div
          {...{ [RIP_LANDMARK]: '' }}
          className="mx-auto mb-[12px] w-full max-w-[440px] rounded-2xl border border-border-default bg-surface-secondary p-[10px]"
        >
          <ul className="flex max-h-[220px] flex-col gap-[6px] overflow-y-auto">
            {ripState.entries.map((e) => (
              <li
                key={e.cardId}
                className="flex flex-col gap-[6px] rounded-lg bg-surface-primary px-[10px] py-[7px] motion-safe:animate-[sheet-panel-in_200ms_ease-out_both]"
              >
                <div className="flex items-center gap-[8px]">
                <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">{e.name}</span>
                {/* The confidence of the frame that committed it. Surfaced
                    because the rare wrong top-1 is a near-identical same-art
                    reprint at distance 1-6, and a list presented as fact with
                    no way to see which rows were marginal is worse than a
                    list you can audit. */}
                <span className="shrink-0 font-mono text-[11px] text-text-muted" title="match distance — lower is more certain">
                  d{e.distance}
                </span>
                <input
                  type="number"
                  min={1}
                  value={e.quantity}
                  aria-label={`How many ${e.name}`}
                  onChange={(ev) =>
                    setRipState((st) =>
                      setQuantity(st, e.cardId, ev.target.value === '' ? NaN : Number(ev.target.value)),
                    )
                  }
                  className="h-[28px] w-[52px] shrink-0 rounded bg-surface-secondary px-[6px] text-center text-[13px] text-text-primary"
                />
                <button
                  type="button"
                  aria-label={`Remove ${e.name}`}
                  onClick={() => setRipState((st) => removeEntry(st, e.cardId))}
                  className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full text-icon-muted hover:bg-surface-secondary hover:text-icon-hover"
                >
                  <Icon name="close" size={14} />
                </button>
                </div>
                {/* WHICH PRINTING. Shown only when there is a real choice — a
                    card with one printing gets no control, because a select with
                    a single option is furniture that teaches the reader to stop
                    reading this row. The scanner matches artwork, and a card and
                    its reverse holo share artwork, so this cannot be inferred:
                    every pack has reverse holos in it, and without this the whole
                    pack files as normal.

                    Sized 13px to match the quantity input beside it. Below the
                    nav breakpoint `theme.css` forces every form control to 16px
                    so iOS Safari does not auto-zoom on focus, so 13px is what
                    desktop sees — anything smaller would only show up there, as
                    a control quietly out of step with its own row. */}
                {e.variants.length > 1 && (
                  <select
                    value={e.variantId ?? ''}
                    aria-label={`Printing of ${e.name}`}
                    onChange={(ev) =>
                      setRipState((st) => chooseVariant(st, e.cardId, Number(ev.target.value)))
                    }
                    className="h-[28px] w-full rounded bg-surface-secondary px-[6px] text-[13px] text-text-body"
                  >
                    {e.variants.map((v) => (
                      <option key={v.variantId} value={v.variantId}>
                        {v.displayName}
                      </option>
                    ))}
                  </select>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={committing}
            onClick={async () => {
              setCommitting(true)
              try {
                const committedNow = ripState.entries
                const r = await commitRip(committedNow)
                // ONLY WHAT WAS COMMITTED. `commitRip` closed over the list as
                // it was at click time, and rip mode never pauses — a card shown
                // while the request was in flight is in `ripState` but was not
                // written. Emptying the whole session here threw that card away
                // silently, which is the one outcome a scanner must never have.
                const done = new Set(committedNow.map((e) => e.cardId))
                setRipState((st) => ({
                  ...st,
                  entries: st.entries.filter((e) => !done.has(e.cardId)),
                }))
                for (const e of committedNow) variantsAsked.current.delete(e.cardId)
                setHint(
                  r.unresolved.length
                    ? `Added ${r.applied}. I could not place ${r.unresolved.map((u) => u.name).join(', ')}.`
                    : `Added ${r.applied} to your collection`,
                )
              } catch (err) {
                setError(err instanceof Error ? err.message : 'that did not save')
              } finally {
                setCommitting(false)
              }
            }}
            className="mt-[8px] h-[40px] w-full rounded-full bg-action-primary text-[14px] font-semibold text-action-primary-text disabled:opacity-50"
          >
            {committing ? 'Adding…' : `Add ${ripState.entries.reduce((n, e) => n + e.quantity, 0)} to my collection`}
          </button>
        </div>
      )}

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
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-[10px] bg-black/70 p-[20px] text-center text-[14px] text-white">
              <Icon name="camera" size={30} />
              <div>Camera access was blocked. Allow it in your browser, or upload an image below.</div>
              <button
                onClick={() => void startCamera()}
                className="rounded-full bg-white/15 px-[16px] py-[8px] text-[14px] font-bold text-white hover:bg-white/25"
              >
                Try camera again
              </button>
            </div>
          )}
          {camState === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-[10px] bg-black/70 p-[20px] text-center text-[14px] text-white">
              <Icon name="alert" size={28} />
              <div>Couldn’t start the camera.</div>
              <button
                onClick={() => void startCamera()}
                className="rounded-full bg-white/15 px-[16px] py-[8px] text-[14px] font-bold text-white hover:bg-white/25"
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
            <div className="w-full rounded-xl border border-border-default bg-surface-secondary p-[14px] text-center text-[14px] text-text-muted">
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
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const file = e.dataTransfer.files?.[0]
            if (file) void runScan(file)
          }}
          className="mt-[16px] flex min-h-[200px] flex-col items-center justify-center gap-[10px] rounded-2xl border-2 border-dashed border-action-ghost-border bg-surface-secondary/50 p-[20px] text-center hover:border-border-focus"
        >
          {preview ? (
            <img src={preview} alt="Card to scan" className="max-h-[300px] rounded-lg object-contain" />
          ) : (
            <>
              <Icon name="camera" size={40} className="text-icon-muted" />
              <div className="text-[15px] font-semibold text-text-primary">Drop an image here</div>
              <div className="text-[12px] text-text-muted">JPEG, PNG or WebP · a clear, straight-on shot works best</div>
            </>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-full bg-surface-tertiary px-[16px] py-[8px] text-[14px] font-bold text-text-primary hover:bg-action-default-hover"
          >
            Browse images
          </button>
        </div>
      )}

      {/* status while an upload scan runs */}
      {scanning && (
        <div className="mt-[24px] flex items-center justify-center gap-[12px] py-[24px] text-text-muted">
          <Spinner inline size={28} className="text-action-primary" />
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
            <div className="flex items-center gap-[8px] text-[14px] font-bold text-text-secondary">
              <span className="uppercase tracking-wide">{result!.matched ? 'Matches' : 'Closest guesses'}</span>
              <span className="text-text-muted">({result!.matches.length})</span>
            </div>
            <button
              onClick={scanAnother}
              className="flex h-[38px] items-center gap-[7px] rounded-full bg-action-primary px-[16px] text-[14px] font-bold text-action-primary-text hover:bg-action-primary-hover"
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
