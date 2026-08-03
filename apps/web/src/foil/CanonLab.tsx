// foil/CanonLab.tsx — surface A of the workbench split (/pokedex/foil-lab/canon):
// the pattern-truth room (issues/foil/2026-08-02_12-59-52-368_4aq756).
//
// A plain/empty card — no ink, no artwork scan, just the holofoil pattern
// itself over a blank card base — rendered NEXT TO the real reference clip of
// the pattern being tilted (research/foil-video-reference/<slug>/clip.webm +
// 8 keyframes, streamed by the branch api). Purpose-built for locking down the
// CANONICAL recipe of each of the 43 pattern types: full pattern vocabulary,
// tuning sliders, tilt (pointer / gyro / deterministic manual), and Save canon
// → data/foil-canon/<patternId>.json (a full uniform snapshot that replaces
// the code defaults as the baseline on both surfaces; see foil/canon.ts).
//
// Card-to-card differences (masks, per-card overrides, comments about a
// specific printing) belong on surface B (/pokedex/foil-lab — FoilLab.tsx).

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { foilApi } from './api'
import { PATTERNS, patternById } from './patterns'
import { canonBaseline, canonFor, referenceSlug, sparseDiff } from './canon'
import { maskForScope } from './resolver'
import { useTilt } from './useTilt'
import { CardViewer, type ViewerSettings } from './CardViewer'
import { ActionBtn, Chip, Section, Select, Slider, SurfaceTabs } from './ui'

const LS_PATTERN_KEY = 'foil-lab:canon-pattern'
const LS_TONE_KEY = 'foil-lab:canon-tone'

// ── Blank card bases ────────────────────────────────────────────────────────
// The "empty card" face: a flat tone data-URL fed to the normal CardViewer
// texture path (zero viewer/shader changes). Foil is screen-blended, so dark
// bases show the pattern purely; the white base previews how foil dies over
// light ink. NOTE uArtGate gates on face luminance — on the white base an
// art-gated pattern goes dark by design.
const TONES = {
  black: '#000000',
  dark: '#171921',
  silver: '#8a8f99',
  white: '#f2f2f2',
} as const
type Tone = keyof typeof TONES

const toneUrlCache: Partial<Record<Tone, string>> = {}
function toneUrl(tone: Tone): string {
  let url = toneUrlCache[tone]
  if (!url) {
    const c = document.createElement('canvas')
    c.width = c.height = 8
    const ctx = c.getContext('2d')!
    ctx.fillStyle = TONES[tone]
    ctx.fillRect(0, 0, 8, 8)
    url = c.toDataURL('image/png')
    toneUrlCache[tone] = url
  }
  return url
}

function loadTone(): Tone {
  const t = localStorage.getItem(LS_TONE_KEY)
  return t && t in TONES ? (t as Tone) : 'dark'
}

function loadPatternId(): string {
  return localStorage.getItem(LS_PATTERN_KEY) ?? 'cosmos'
}

// ── The canon lab ───────────────────────────────────────────────────────────

export function CanonLab() {
  const queryClient = useQueryClient()
  const [patternId, setPatternId] = useState<string>(loadPatternId)
  const [tone, setTone] = useState<Tone>(loadTone)
  const [maxTiltDeg, setMaxTiltDeg] = useState(16)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [copied, setCopied] = useState(false)

  // Comments (same queue as surface B; context marks the surface)
  const [commentOpen, setCommentOpen] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentStatus, setCommentStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  useEffect(() => {
    localStorage.setItem(LS_PATTERN_KEY, patternId)
  }, [patternId])
  useEffect(() => {
    localStorage.setItem(LS_TONE_KEY, tone)
  }, [tone])

  const tilt = useTilt()

  const devQ = useQuery({ queryKey: ['foil', 'dev-surface'], queryFn: () => foilApi.devSurface(), staleTime: Infinity })
  const devSurface = devQ.data === true
  const canonQ = useQuery({ queryKey: ['foil', 'canon'], queryFn: ({ signal }) => foilApi.getCanon(signal) })
  const refIndexQ = useQuery({
    queryKey: ['foil', 'reference-index'],
    queryFn: ({ signal }) => foilApi.referenceIndex(signal),
    staleTime: 5 * 60_000,
  })

  const pattern = patternById(patternId) // alias-safe
  const canon = canonFor(canonQ.data ?? undefined, pattern.id)
  const baseline = useMemo(() => canonBaseline(pattern, canon), [pattern, canon])

  // Live sliders; reseed when the pattern changes or a (re)saved canon lands.
  const [uniforms, setUniforms] = useState<Record<string, number>>(baseline)
  const seedKey = `${pattern.id}|${canon?.savedAt ?? 'code'}`
  const lastSeed = useRef<string | null>(null)
  useEffect(() => {
    if (lastSeed.current !== seedKey) {
      lastSeed.current = seedKey
      setUniforms(baseline)
    }
  }, [seedKey, baseline])
  const setU = (k: string, v: number) => setUniforms((u) => ({ ...u, [k]: v }))

  // Unsaved-vs-canon state (the dot on Save; per-slider marks).
  const dirtyKeys = useMemo(() => Object.keys(sparseDiff(uniforms, baseline)), [uniforms, baseline])
  const dirty = dirtyKeys.length > 0

  // Full-face mask, era-agnostic (the canon room has no card, no art window).
  const mask = useMemo(() => maskForScope('full', 'wotc'), [])
  const settingsRef = useRef<ViewerSettings>({
    uniforms,
    maskRect: mask.rect,
    maskRadius: mask.radius,
    maskFeather: 0.008,
    maskInvert: mask.invert,
    maskView: false,
    maskTexOn: false,
    maskTexVersion: 0,
    maxTiltDeg,
  })
  useEffect(() => {
    settingsRef.current = {
      uniforms,
      maskRect: mask.rect,
      maskRadius: mask.radius,
      maskFeather: 0.008,
      maskInvert: mask.invert,
      maskView: false,
      maskTexOn: false,
      maskTexVersion: 0,
      maxTiltDeg,
    }
  }, [uniforms, mask, maxTiltDeg])

  const saveCanon = async () => {
    setSaveStatus('saving')
    try {
      await foilApi.putCanon(pattern.id, uniforms)
      // The refetch reseeds via seedKey — with exactly the values just saved.
      await queryClient.invalidateQueries({ queryKey: ['foil', 'canon'] })
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 1500)
    } catch {
      setSaveStatus('error')
    }
  }

  const deleteCanon = async () => {
    try {
      await foilApi.deleteCanon(pattern.id)
      await queryClient.invalidateQueries({ queryKey: ['foil', 'canon'] })
    } catch {
      /* canon list will show the truth either way */
    }
  }

  const copyRecipe = async () => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify({ pattern: pattern.id, source: 'canon-lab', uniforms }, null, 2),
      )
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable (http LAN) — no-op */
    }
  }

  const submitComment = async () => {
    const text = commentText.trim()
    if (!text) return
    setCommentStatus('saving')
    try {
      await foilApi.postComment(text, {
        surface: 'canon-lab',
        pattern: pattern.id,
        canonSavedAt: canon?.savedAt ?? null,
        canonDirty: dirty,
        tiltMode: tilt.mode,
        uniforms,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        ts: new Date().toISOString(),
      })
      setCommentStatus('saved')
      setCommentText('')
      setTimeout(() => {
        setCommentStatus('idle')
        setCommentOpen(false)
      }, 900)
    } catch {
      setCommentStatus('error')
    }
  }

  // ── Reference clip availability ──
  const slug = referenceSlug(pattern.id)
  const refInfo = slug ? refIndexQ.data?.patterns[slug] : undefined
  const hasClip = Boolean(slug && refInfo?.clip)
  const borrowed = slug !== pattern.id // reverse-sheet borrows pokeball-masterball

  return (
    <div className="flex min-h-screen flex-col bg-surface-primary text-text-primary min-[700px]:h-screen min-[700px]:flex-row min-[700px]:overflow-hidden">
      {/* ── Pattern + reference column ── */}
      <div className="flex shrink-0 flex-col min-[700px]:h-full min-[700px]:flex-1 min-[700px]:shrink">
        {/* Bare pattern render on the blank card */}
        <div className="relative h-[44vh] shrink-0 bg-[#0b0d12] min-[700px]:h-auto min-[700px]:min-h-0 min-[700px]:flex-1">
          <CardViewer
            imageUrl={toneUrl(tone)}
            pattern={pattern}
            settingsRef={settingsRef}
            tiltTarget={tilt.target}
            onPointerMove={tilt.onPointerMove}
            onPointerLeave={tilt.onPointerLeave}
            className="h-full w-full"
          />
          <div className="pointer-events-none absolute left-[12px] top-[10px] text-[12px]">
            <div className="font-semibold">{pattern.label}</div>
            <div className="text-text-muted">canon pattern lab · blank card, no ink</div>
          </div>
          <div className="pointer-events-none absolute right-[12px] top-[10px] rounded-full bg-surface-secondary/70 px-[8px] py-[2px] text-[11px] text-text-muted">
            {tilt.mode}
          </div>
          {devSurface && (
            <button
              onClick={() => setCommentOpen(true)}
              className="absolute bottom-[12px] left-[12px] rounded-full border border-border-default bg-surface-secondary/85 px-[12px] py-[7px] text-[12px] text-text-primary hover:border-action-primary"
            >
              + Comment
            </button>
          )}
        </div>

        {/* The real card on video, side by side with the render above */}
        <div className="shrink-0 border-t border-border-default bg-[#07080c] p-[10px] min-[700px]:max-h-[46%] min-[700px]:overflow-y-auto">
          {hasClip ? (
            <div>
              <video
                key={slug}
                src={foilApi.referenceUrl(slug!, 'clip.webm')}
                poster={foilApi.referenceUrl(slug!, 'frame-01.jpg')}
                autoPlay
                muted
                loop
                playsInline
                controls
                className="mx-auto max-h-[26vh] w-auto max-w-full rounded-md min-[700px]:max-h-[22vh]"
              />
              <div className="mt-[8px] flex gap-[6px] overflow-x-auto pb-[2px]">
                {Array.from({ length: refInfo?.frames ?? 0 }, (_, i) => (
                  <img
                    key={i}
                    src={foilApi.referenceUrl(slug!, `frame-0${i + 1}.jpg`)}
                    alt={`${slug} keyframe ${i + 1}`}
                    loading="lazy"
                    className="h-[56px] w-auto shrink-0 rounded-[3px]"
                  />
                ))}
              </div>
              <p className="mt-[6px] text-[10px] leading-[14px] text-text-muted">
                Reference: one real tilt sweep{borrowed ? ` (borrowed from ${slug} — nearest physical sheet)` : ''} ·
                collector tilt footage credited in research/foil-video-reference/{slug}/notes.md (main corpus:
                “All 39 Pokemon Card Holo Patterns Explained”, Sleeve No Card Behind).
              </p>
            </div>
          ) : (
            <p className="py-[14px] text-center text-[12px] text-text-muted">
              {slug === null
                ? 'No physical reference — “none” is the plain-card baseline.'
                : refIndexQ.data
                  ? `No reference clip in the corpus for ${slug}.`
                  : 'Reference clips stream from the foil branch api — unavailable here.'}
            </p>
          )}
        </div>
      </div>

      {/* ── Controls column ── */}
      <div className="flex-1 space-y-[12px] overflow-y-auto p-[12px] min-[700px]:w-[360px] min-[700px]:flex-none min-[700px]:shrink-0 min-[1200px]:w-[400px]">
        <SurfaceTabs active="canon" />

        <Section title="Pattern">
          <Select value={pattern.id} onChange={setPatternId}>
            <optgroup label="Implemented recipes">
              {PATTERNS.filter((p) => p.implemented && p.id !== 'none').map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Recipe gap — nearest-recipe fallback">
              {PATTERNS.filter((p) => !p.implemented).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} — approx via {p.approxVia}
                </option>
              ))}
            </optgroup>
          </Select>
          <p className="mt-[6px] text-[11px] leading-[15px] text-text-muted">
            {pattern.taxonomy} — {pattern.usedOn}
          </p>
          {!pattern.implemented && (
            <p className="mt-[4px] text-[11px] leading-[15px] text-amber-500/90">
              No faithful recipe yet — tuning the approximation via {pattern.approxVia}. Canon saved here still
              applies to this type only.
            </p>
          )}
        </Section>

        <Section title="Canon defaults">
          {canon ? (
            <p className="mb-[8px] text-[11px] leading-[15px] text-text-muted">
              Locked {new Date(canon.savedAt).toLocaleString()} → data/foil-canon/{pattern.id}.json
              {dirty ? ` — ${dirtyKeys.length} unsaved change${dirtyKeys.length === 1 ? '' : 's'}` : ' — sliders match'}
            </p>
          ) : (
            <p className="mb-[8px] text-[11px] leading-[15px] text-text-muted">
              No canon saved — showing the recipe’s code defaults (patterns.ts).
              {dirty ? ` ${dirtyKeys.length} unsaved change${dirtyKeys.length === 1 ? '' : 's'}.` : ''}
            </p>
          )}
          {devSurface ? (
            <div className="flex flex-wrap gap-[6px]">
              <ActionBtn onClick={saveCanon} active>
                {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : dirty ? 'Save canon ●' : 'Save canon'}
              </ActionBtn>
              {canon && dirty && <ActionBtn onClick={() => setUniforms(baseline)}>Reset to canon</ActionBtn>}
              <ActionBtn onClick={() => setUniforms(canonBaseline(pattern, undefined))}>Code defaults</ActionBtn>
              {canon && <ActionBtn onClick={deleteCanon}>Delete canon</ActionBtn>}
            </div>
          ) : (
            <p className="text-[11px] text-text-muted">
              Saving canon needs the foil branch api instance — unavailable here.
            </p>
          )}
          {saveStatus === 'error' && (
            <p className="mt-[6px] text-[12px] text-red-400">Save failed — is the foil branch api up?</p>
          )}
        </Section>

        <Section title="Blank card base">
          <div className="flex flex-wrap gap-[6px]">
            {(Object.keys(TONES) as Tone[]).map((t) => (
              <Chip key={t} active={tone === t} onClick={() => setTone(t)}>
                {t}
              </Chip>
            ))}
          </div>
          <p className="mt-[6px] text-[11px] leading-[15px] text-text-muted">
            Foil is screen-blended: dark bases show the raw pattern; white previews foil dying over light ink.
            Art gate reads face luminance, so gated patterns go dark on the white base by design.
          </p>
        </Section>

        <Section title="Tilt">
          <div className="mb-[8px] flex gap-[6px]">
            {(['pointer', 'gyro', 'manual'] as const).map((m) => (
              <Chip
                key={m}
                active={tilt.mode === m}
                onClick={() => {
                  if (m === 'gyro') void tilt.requestGyro()
                  else tilt.setMode(m)
                }}
              >
                {m}
              </Chip>
            ))}
            {tilt.mode === 'gyro' && (
              <Chip active={false} onClick={tilt.recenterGyro}>
                recenter
              </Chip>
            )}
          </div>
          {tilt.gyroPermission === 'denied' && (
            <p className="mb-[6px] text-[11px] text-text-muted">Motion permission denied — use manual sliders.</p>
          )}
          {tilt.reducedMotion && (
            <p className="mb-[6px] text-[11px] text-text-muted">
              Reduced motion is on — manual tilt is the default; nothing animates on its own.
            </p>
          )}
          {tilt.mode === 'manual' && (
            <>
              <Slider label="Tilt X" value={tilt.manual.x} min={-1} max={1} step={0.01} onChange={(v) => tilt.setManual(v, tilt.manual.y)} />
              <Slider label="Tilt Y" value={tilt.manual.y} min={-1} max={1} step={0.01} onChange={(v) => tilt.setManual(tilt.manual.x, v)} />
            </>
          )}
          <Slider label="Max card tilt (deg)" value={maxTiltDeg} min={0} max={35} step={1} onChange={setMaxTiltDeg} />
        </Section>

        <Section title="Foil uniforms">
          <Slider label="Intensity" value={uniforms.uIntensity ?? 1} min={0} max={2} step={0.02} marked={dirtyKeys.includes('uIntensity')} onChange={(v) => setU('uIntensity', v)} />
          <Slider label="Pattern scale" value={uniforms.uScale ?? 1} min={0.25} max={3} step={0.05} marked={dirtyKeys.includes('uScale')} onChange={(v) => setU('uScale', v)} />
          <Slider label="Hue shift" value={uniforms.uHueShift ?? 0.5} min={0} max={1} step={0.01} marked={dirtyKeys.includes('uHueShift')} onChange={(v) => setU('uHueShift', v)} />
          <Slider label="Hue spread" value={uniforms.uHueSpread ?? 0.5} min={0} max={1.5} step={0.01} marked={dirtyKeys.includes('uHueSpread')} onChange={(v) => setU('uHueSpread', v)} />
          <Slider label="Color saturation" value={uniforms.uSat ?? 0.8} min={0} max={1} step={0.01} marked={dirtyKeys.includes('uSat')} onChange={(v) => setU('uSat', v)} />
          <Slider label="Art gate (dark areas)" value={uniforms.uArtGate ?? 0} min={0} max={1} step={0.01} marked={dirtyKeys.includes('uArtGate')} onChange={(v) => setU('uArtGate', v)} />
          <Slider label="Specular sheen" value={uniforms.uSpecular ?? 0.4} min={0} max={1.5} step={0.02} marked={dirtyKeys.includes('uSpecular')} onChange={(v) => setU('uSpecular', v)} />
          <Slider label="Mirror darken (substrate)" value={uniforms.uDarken ?? 0} min={0} max={1} step={0.01} marked={dirtyKeys.includes('uDarken')} onChange={(v) => setU('uDarken', v)} />
          <Slider label="Ink tint (art metallic)" value={uniforms.uTint ?? 0} min={0} max={1} step={0.01} marked={dirtyKeys.includes('uTint')} onChange={(v) => setU('uTint', v)} />
          {pattern.params.length > 0 && <div className="my-[8px] border-t border-border-default" />}
          {pattern.params.map((p) => (
            <Slider
              key={p.key}
              label={p.label}
              value={uniforms[p.key] ?? p.default}
              min={p.min}
              max={p.max}
              step={p.step}
              marked={dirtyKeys.includes(p.key)}
              onChange={(v) => setU(p.key, v)}
            />
          ))}
          <button
            onClick={copyRecipe}
            className="mt-[6px] w-full rounded-md border border-border-default bg-surface-tertiary py-[8px] text-[13px] text-text-primary hover:border-action-primary"
          >
            {copied ? 'Copied!' : 'Copy recipe JSON'}
          </button>
        </Section>

        <p className="pb-[16px] text-center text-[10px] text-text-muted">
          canon pattern lab — locks data/foil-canon/; card differences live on Card adjust.
        </p>
      </div>

      {/* ── Comment modal ── */}
      {commentOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-[16px] min-[700px]:items-center">
          <div className="w-full max-w-[440px] rounded-lg border border-border-default bg-surface-secondary p-[14px]">
            <h2 className="mb-[8px] text-[13px] font-semibold">
              Canon-lab comment
              <span className="ml-[8px] font-normal text-text-muted">{pattern.id}</span>
            </h2>
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              rows={4}
              placeholder="What's off vs the reference clip — pattern and sliders are captured automatically."
              className="w-full rounded-md border border-border-default bg-surface-tertiary p-[8px] text-[13px] text-text-primary"
            />
            <div className="mt-[10px] flex items-center justify-end gap-[8px]">
              {commentStatus === 'error' && (
                <span className="mr-auto text-[12px] text-red-400">Save failed — is the foil branch api up?</span>
              )}
              {commentStatus === 'saved' && (
                <span className="mr-auto text-[12px] text-action-primary">Saved to issues/foil/ ✓</span>
              )}
              <ActionBtn onClick={() => setCommentOpen(false)}>Cancel</ActionBtn>
              <ActionBtn onClick={submitComment} active>
                {commentStatus === 'saving' ? 'Saving…' : 'Save comment'}
              </ActionBtn>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
