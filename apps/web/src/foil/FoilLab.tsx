// foil/FoilLab.tsx — the quarantined foil tuning workbench (/pokedex/foil-lab).
//
// Reachable by URL only — linked from NOWHERE in the app shell (quarantine
// rule, roadmap/plans/foil-main.md). One owned card/variant at a time, real
// scan from the image cache, tilt-driven foil shader, and dev controls:
// uniform sliders, pattern override, mask overlay toggle, Apple-Pencil hand
// mask editing, and a comment queue. Layouts: single column at phone widths
// (390px), two columns from iPad-mini portrait up (≥700px: viewer | controls).
//
// The hand-mask + comment surfaces need the BRANCH api dev instance
// (POKEDEX_FOIL_LAB=1 on port 3712 — roadmap/ORCHESTRATION.md); against prod
// they probe as unavailable and those affordances hide themselves.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { foilApi, type FoilMaskMeta } from './api'
import { PATTERNS, patternById, type FoilPattern } from './patterns'
import { GLOBAL_DEFAULTS } from './shader'
import { resolveFoil, maskForScope, ERAS, RESOLVER_VERSION, type FoilScope } from './resolver'
import { useTilt } from './useTilt'
import { CardViewer, cardScreenRect, type ViewerSettings } from './CardViewer'
import { MaskEditor, createMaskCanvas, MASK_W, MASK_H, type BrushMode, type MaskEditorHandle } from './MaskEditor'

const LS_KEY = 'foil-lab:selection'

interface Selection {
  seriesSlug?: string
  setId?: string
  cardId?: string
  variantId?: number
}

function loadSelection(): Selection {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as Selection
  } catch {
    return {}
  }
}

function seedUniforms(pattern: FoilPattern): Record<string, number> {
  const u: Record<string, number> = { ...GLOBAL_DEFAULTS }
  for (const [k, v] of Object.entries(pattern.defaults)) u[k] = v as number
  for (const p of pattern.params) u[p.key] = p.default
  return u
}

// ── Small UI atoms (self-contained; no imports from ../components) ─────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border-default bg-surface-secondary p-[12px]">
      <h2 className="mb-[10px] text-[11px] font-bold uppercase tracking-[0.08em] text-text-muted">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Chip({
  active,
  onClick,
  disabled = false,
  children,
}: {
  active: boolean
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`shrink-0 rounded-full border px-[10px] py-[4px] text-[12px] transition-colors disabled:opacity-40 ${
        active
          ? 'border-action-primary bg-action-primary/15 text-action-primary'
          : 'border-border-default bg-surface-tertiary text-text-muted hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <label className="mb-[8px] block">
      <span className="mb-[2px] flex justify-between text-[12px]">
        <span className="text-text-muted">{label}</span>
        <span className="tabular-nums text-text-primary">{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-action-primary)]"
      />
    </label>
  )
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-border-default bg-surface-tertiary px-[8px] py-[6px] text-[13px] text-text-primary"
    >
      {children}
    </select>
  )
}

function ActionBtn({
  onClick,
  active = false,
  children,
}: {
  onClick: () => void
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border px-[10px] py-[6px] text-[12px] ${
        active
          ? 'border-action-primary bg-action-primary/15 text-action-primary'
          : 'border-border-default bg-surface-tertiary text-text-primary hover:border-action-primary'
      }`}
    >
      {children}
    </button>
  )
}

// ── The workbench ──────────────────────────────────────────────────────────

export function FoilLab() {
  const [sel, setSel] = useState<Selection>(loadSelection)
  const [patternOverride, setPatternOverride] = useState<string>('auto')
  const [scopeOverride, setScopeOverride] = useState<'auto' | FoilScope>('auto')
  const [maskView, setMaskView] = useState(false)
  const [maskFeather, setMaskFeather] = useState(0.008)
  const [maxTiltDeg, setMaxTiltDeg] = useState(16)
  const [copied, setCopied] = useState(false)

  // Hand-mask state
  const maskCanvas = useMemo(() => createMaskCanvas(), [])
  const [maskSource, setMaskSource] = useState<'layout' | 'hand'>('layout')
  const [editMode, setEditMode] = useState(false)
  const [brushMode, setBrushMode] = useState<BrushMode>('brush')
  const [brushSize, setBrushSize] = useState(28)
  const [allowTouch, setAllowTouch] = useState(false)
  const [maskDirty, setMaskDirty] = useState(false)
  const [savedMask, setSavedMask] = useState(false)
  /** Sidecar meta of the hand mask on screen (null = none / layout tier). */
  const [maskMeta, setMaskMeta] = useState<FoilMaskMeta | null>(null)
  const [maskTexVersion, setMaskTexVersion] = useState(0)
  const editorRef = useRef<MaskEditorHandle | null>(null)
  const zeroTilt = useRef({ x: 0, y: 0 })

  // Comments
  const [commentOpen, setCommentOpen] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentStatus, setCommentStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  // Viewer host size (for aligning the mask-editor overlay with the card).
  const viewerWrapRef = useRef<HTMLDivElement>(null)
  const [hostSize, setHostSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = viewerWrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setHostSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setHostSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(sel))
  }, [sel])

  const tilt = useTilt()

  // ── Data: owned series → owned sets → owned cards → card detail ──
  const seriesQ = useQuery({ queryKey: ['foil', 'series'], queryFn: ({ signal }) => foilApi.ownedSeries(signal) })
  const setsQ = useQuery({
    queryKey: ['foil', 'sets', sel.seriesSlug],
    queryFn: ({ signal }) => foilApi.ownedSets(sel.seriesSlug!, signal),
    enabled: Boolean(sel.seriesSlug),
  })
  const cardsQ = useQuery({
    queryKey: ['foil', 'cards', sel.setId],
    queryFn: ({ signal }) => foilApi.ownedCards(sel.setId!, signal),
    enabled: Boolean(sel.setId),
  })
  const detailQ = useQuery({
    queryKey: ['foil', 'card', sel.cardId],
    queryFn: ({ signal }) => foilApi.cardDetail(sel.cardId!, signal),
    enabled: Boolean(sel.cardId),
  })
  const devQ = useQuery({ queryKey: ['foil', 'dev-surface'], queryFn: () => foilApi.devSurface(), staleTime: Infinity })
  const devSurface = devQ.data === true

  // Auto-select down the chain (prefer the classic demo: Base Set Machamp).
  useEffect(() => {
    if (!sel.seriesSlug && seriesQ.data?.length) {
      const base = seriesQ.data.find((s) => s.slug === 'base')
      setSel((p) => ({ ...p, seriesSlug: (base ?? seriesQ.data[0]).slug }))
    }
  }, [seriesQ.data, sel.seriesSlug])
  useEffect(() => {
    if (sel.seriesSlug && setsQ.data?.length && !setsQ.data.some((s) => s.setId === sel.setId)) {
      const base1 = setsQ.data.find((s) => s.setId === 'base1')
      setSel((p) => ({ ...p, setId: (base1 ?? setsQ.data[0]).setId, cardId: undefined, variantId: undefined }))
    }
  }, [setsQ.data, sel.seriesSlug, sel.setId])
  useEffect(() => {
    if (sel.setId && cardsQ.data?.length && !cardsQ.data.some((c) => c.cardId === sel.cardId)) {
      const machamp = cardsQ.data.find((c) => c.cardId === 'base1-8')
      setSel((p) => ({ ...p, cardId: (machamp ?? cardsQ.data[0]).cardId, variantId: undefined }))
    }
  }, [cardsQ.data, sel.setId, sel.cardId])
  useEffect(() => {
    const vs = detailQ.data?.variants
    if (vs?.length && !vs.some((v) => v.variantId === sel.variantId)) {
      const ownedHolo = vs.find((v) => v.quantity > 0 && v.kind.toLowerCase().includes('holo'))
      const owned = vs.find((v) => v.quantity > 0)
      setSel((p) => ({ ...p, variantId: (ownedHolo ?? owned ?? vs[0]).variantId }))
    }
  }, [detailQ.data, sel.variantId])

  const detail = detailQ.data
  const variant = detail?.variants.find((v) => v.variantId === sel.variantId) ?? null

  // ── Resolve pattern + mask ──
  const resolved = useMemo(
    () =>
      resolveFoil({
        seriesSlug: detail?.card.series.slug ?? sel.seriesSlug ?? '',
        rarity: detail?.card.rarity ?? null,
        variantKind: variant?.kind ?? null,
      }),
    [detail, variant, sel.seriesSlug],
  )
  const effectivePatternId = patternOverride === 'auto' ? resolved.patternId : patternOverride
  const effectiveScope = scopeOverride === 'auto' ? resolved.scope : scopeOverride
  const pattern = patternById(effectivePatternId)
  const mask = maskForScope(effectiveScope, resolved.eraId)

  // ── Saved hand mask: load on card/variant change (beats the layout tier) ──
  useEffect(() => {
    if (!detail || sel.variantId == null) return
    setEditMode(false)
    setMaskDirty(false)
    let cancelled = false
    if (!devSurface) {
      setMaskSource('layout')
      setSavedMask(false)
      setMaskMeta(null)
      return
    }
    // Artwork-keyed lookup: pass the variant's resolved scope so a sibling
    // variant's mask on the same scan can answer (aliasOf in the meta).
    void foilApi.getMask(detail.card.cardId, sel.variantId, resolved.scope).then((r) => {
      if (cancelled) return
      if (r) {
        const ctx = maskCanvas.getContext('2d')!
        ctx.clearRect(0, 0, MASK_W, MASK_H)
        ctx.drawImage(r.bitmap, 0, 0, MASK_W, MASK_H)
        setSavedMask(true)
        setMaskMeta(r.meta)
        setMaskSource('hand')
        setMaskTexVersion((v) => v + 1)
      } else {
        setSavedMask(false)
        setMaskMeta(null)
        setMaskSource('layout')
      }
    })
    return () => {
      cancelled = true
    }
  }, [detail, sel.variantId, devSurface, maskCanvas, resolved.scope])

  // ── Uniforms: reset on pattern change, live in state + ref ──
  const [uniforms, setUniforms] = useState<Record<string, number>>(() => seedUniforms(pattern))
  useEffect(() => {
    setUniforms(seedUniforms(pattern))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern.id])

  const handActive = maskSource === 'hand' || editMode
  const settingsRef = useRef<ViewerSettings>({
    uniforms,
    maskRect: mask.rect,
    maskRadius: mask.radius,
    maskFeather,
    maskInvert: mask.invert,
    maskView,
    maskTexOn: handActive,
    maskTexVersion,
    maxTiltDeg,
  })
  useEffect(() => {
    settingsRef.current = {
      uniforms,
      maskRect: mask.rect,
      maskRadius: mask.radius,
      maskFeather,
      maskInvert: mask.invert,
      maskView,
      maskTexOn: handActive,
      maskTexVersion,
      maxTiltDeg: editMode ? 0 : maxTiltDeg,
    }
  }, [uniforms, mask, maskFeather, maskView, maxTiltDeg, handActive, maskTexVersion, editMode])

  const setU = (k: string, v: number) => setUniforms((u) => ({ ...u, [k]: v }))

  const onStrokeEnd = useCallback(() => {
    setMaskDirty(true)
    setMaskSource('hand')
    setMaskTexVersion((v) => v + 1)
  }, [])

  const registerEditor = useCallback((h: MaskEditorHandle) => {
    editorRef.current = h
  }, [])

  const startEdit = () => {
    setEditMode(true)
    // Editing starts from the current mask: saved hand mask if loaded,
    // otherwise rasterize the layout prior so he refines, not restarts.
    if (maskSource === 'layout') {
      // defer until the editor registered its handle
      requestAnimationFrame(() => {
        editorRef.current?.loadLayoutRect(mask.rect, mask.invert, mask.radius)
        setMaskSource('hand')
        setMaskTexVersion((v) => v + 1)
      })
    }
  }

  const saveMask = async () => {
    if (!detail || sel.variantId == null) return
    try {
      // Sidecar v2: every save records the starting prior — the deterministic
      // layout-rule output for this card/variant — so the server can persist
      // the prior render + hand-vs-prior diff next to the mask (the corpus
      // carries what the rule got wrong, not just the human's answer).
      const saved = await foilApi.putMask(
        detail.card.cardId,
        sel.variantId,
        maskCanvas.toDataURL('image/png'),
        MASK_W,
        MASK_H,
        {
          source: 'layout',
          eraId: resolved.eraId,
          scope: effectiveScope,
          rect: mask.rect,
          radius: mask.radius,
          invert: mask.invert,
          feather: maskFeather,
          resolverVersion: RESOLVER_VERSION,
        },
      )
      setSavedMask(true)
      setMaskDirty(false)
      setMaskMeta({
        file: `data/foil-masks/${detail.card.cardId}/${sel.variantId}.png`,
        savedAt: saved.savedAt,
        aliasOf: null,
        hasPrior: true,
        hasDiff: true,
      })
    } catch {
      /* surfaced by the dirty flag remaining */
    }
  }

  const deleteMask = async () => {
    if (!detail || sel.variantId == null) return
    try {
      await foilApi.deleteMask(detail.card.cardId, sel.variantId)
    } catch {
      /* ignore */
    }
    setSavedMask(false)
    setMaskDirty(false)
    setMaskMeta(null)
    setMaskSource('layout')
    setEditMode(false)
  }

  const commentContext = (): Record<string, unknown> => ({
    cardId: detail?.card.cardId,
    variantId: sel.variantId,
    variantKind: variant?.kind,
    pattern: effectivePatternId,
    patternOverride,
    scope: effectiveScope,
    era: resolved.eraId,
    maskSource,
    maskEditActive: editMode,
    maskDirty,
    savedMask,
    // Comment↔mask linkage (automatic): the exact saved mask state this
    // comment describes — file, savedAt, alias source, prior/diff presence.
    ...(maskMeta
      ? {
          maskFile: maskMeta.file,
          maskSavedAt: maskMeta.savedAt,
          maskAliasOf: maskMeta.aliasOf,
          maskHasPriorDiff: maskMeta.hasPrior && maskMeta.hasDiff,
        }
      : {}),
    tiltMode: tilt.mode,
    uniforms,
    maskFeather,
    maxTiltDeg,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    ts: new Date().toISOString(),
  })

  const submitComment = async () => {
    const text = commentText.trim()
    if (!text) return
    setCommentStatus('saving')
    try {
      await foilApi.postComment(text, commentContext())
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

  const copyRecipe = async () => {
    const recipe = {
      pattern: effectivePatternId,
      scope: effectiveScope,
      era: resolved.eraId,
      card: detail?.card.cardId,
      variant: variant?.kind,
      maskSource,
      uniforms,
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(recipe, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable (http LAN) — no-op */
    }
  }

  const imageUrl = detail?.card.images.high ?? null
  const cardRect = cardScreenRect(hostSize.w, hostSize.h)

  // Era-grouped picker: owned series bucketed by frame generation.
  const eraGroups = useMemo(() => {
    const groups: { eraId: string; label: string; series: NonNullable<typeof seriesQ.data> }[] = []
    for (const s of seriesQ.data ?? []) {
      const eraId = resolveFoil({ seriesSlug: s.slug, rarity: null, variantKind: null }).eraId
      let g = groups.find((x) => x.eraId === eraId)
      if (!g) {
        g = { eraId, label: ERAS[eraId].label, series: [] }
        groups.push(g)
      }
      g.series.push(s)
    }
    return groups
  }, [seriesQ.data])

  return (
    <div className="flex min-h-screen flex-col bg-surface-primary text-text-primary min-[700px]:h-screen min-[700px]:flex-row min-[700px]:overflow-hidden">
      {/* ── Viewer column ── */}
      <div ref={viewerWrapRef} className="relative h-[52vh] shrink-0 bg-[#0b0d12] min-[700px]:h-full min-[700px]:flex-1">
        <CardViewer
          imageUrl={imageUrl}
          pattern={pattern}
          settingsRef={settingsRef}
          tiltTarget={editMode ? zeroTilt : tilt.target}
          maskCanvas={handActive ? maskCanvas : null}
          onPointerMove={editMode ? undefined : tilt.onPointerMove}
          onPointerLeave={editMode ? undefined : tilt.onPointerLeave}
          className="h-full w-full"
        >
          {editMode && cardRect.width > 0 && (
            <MaskEditor
              canvas={maskCanvas}
              rect={cardRect}
              mode={brushMode}
              brushSize={brushSize}
              allowTouch={allowTouch}
              onStrokeEnd={onStrokeEnd}
              registerHandle={registerEditor}
            />
          )}
        </CardViewer>
        <div className="pointer-events-none absolute left-[12px] top-[10px] text-[12px]">
          <div className="font-semibold">{detail ? detail.card.name : 'Foil workbench'}</div>
          <div className="text-text-muted">
            {detail ? `${detail.card.set.name} · #${detail.card.number}` : 'pick a card below'}
            {variant ? ` · ${variant.displayName}` : ''}
          </div>
        </div>
        <div className="pointer-events-none absolute right-[12px] top-[10px] rounded-full bg-surface-secondary/70 px-[8px] py-[2px] text-[11px] text-text-muted">
          {editMode ? 'mask edit' : tilt.mode}
          {handActive && !editMode ? ' · hand mask' : ''}
        </div>
        {devSurface && (
          <button
            onClick={() => setCommentOpen(true)}
            className="absolute bottom-[12px] left-[12px] rounded-full border border-border-default bg-surface-secondary/85 px-[12px] py-[7px] text-[12px] text-text-primary hover:border-action-primary"
          >
            + Comment
          </button>
        )}
        {editMode && (
          <div className="absolute bottom-[12px] right-[12px] flex gap-[6px]">
            <ActionBtn active={brushMode === 'brush'} onClick={() => setBrushMode('brush')}>
              Brush
            </ActionBtn>
            <ActionBtn active={brushMode === 'erase'} onClick={() => setBrushMode('erase')}>
              Erase
            </ActionBtn>
            <ActionBtn onClick={() => editorRef.current?.undo()}>Undo</ActionBtn>
          </div>
        )}
      </div>

      {/* ── Controls column ── */}
      <div className="flex-1 space-y-[12px] overflow-y-auto p-[12px] min-[700px]:w-[360px] min-[700px]:flex-none min-[700px]:shrink-0 min-[1200px]:w-[400px]">
        <Section title="Card (owned scans, by era)">
          {eraGroups.map((g) => (
            <div key={g.eraId} className="mb-[6px]">
              <div className="mb-[4px] text-[10px] uppercase tracking-[0.06em] text-text-muted">{g.label}</div>
              <div className="flex gap-[6px] overflow-x-auto pb-[2px]">
                {g.series.map((s) => (
                  <Chip
                    key={s.slug}
                    active={s.slug === sel.seriesSlug}
                    onClick={() =>
                      setSel({ seriesSlug: s.slug, setId: undefined, cardId: undefined, variantId: undefined })
                    }
                  >
                    {s.name} <span className="opacity-60">{s.progress.owned}</span>
                  </Chip>
                ))}
              </div>
            </div>
          ))}
          {setsQ.data && (
            <Select
              value={sel.setId ?? ''}
              onChange={(v) => setSel((p) => ({ ...p, setId: v, cardId: undefined, variantId: undefined }))}
            >
              {setsQ.data.map((s) => (
                <option key={s.setId} value={s.setId}>
                  {s.name} ({s.progress.complete.owned} owned)
                </option>
              ))}
            </Select>
          )}
          <div className="mt-[8px] flex gap-[8px] overflow-x-auto pb-[4px]">
            {(cardsQ.data ?? []).map((c) => (
              <button
                key={c.cardId}
                onClick={() => setSel((p) => ({ ...p, cardId: c.cardId, variantId: undefined }))}
                className={`w-[64px] shrink-0 overflow-hidden rounded-[5px] border-2 ${
                  c.cardId === sel.cardId ? 'border-action-primary' : 'border-transparent'
                }`}
                title={`${c.name} #${c.number}`}
              >
                <img
                  src={c.images.low}
                  alt={c.name}
                  loading="lazy"
                  className="block w-full"
                  style={{ aspectRatio: '245 / 337' }}
                />
              </button>
            ))}
            {cardsQ.isLoading && <span className="text-[12px] text-text-muted">loading…</span>}
          </div>
          {detail && (
            <div className="mt-[8px] flex flex-wrap gap-[6px]">
              {detail.variants.map((v) => (
                <Chip
                  key={v.variantId}
                  active={v.variantId === sel.variantId}
                  onClick={() => setSel((p) => ({ ...p, variantId: v.variantId }))}
                >
                  {v.displayName}
                  {v.quantity > 0 ? ` ×${v.quantity}` : ''}
                </Chip>
              ))}
            </div>
          )}
        </Section>

        <Section title="Pattern">
          <Select value={patternOverride} onChange={setPatternOverride}>
            <option value="auto">Auto — {patternById(resolved.patternId).label}</option>
            {PATTERNS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
          <p className="mt-[6px] text-[11px] leading-[15px] text-text-muted">
            {pattern.taxonomy} — {pattern.usedOn}
          </p>
        </Section>

        <Section title="Mask">
          <div className="mb-[8px] flex flex-wrap items-center gap-[6px]">
            {(['auto', 'window', 'sheet', 'full'] as const).map((s) => (
              <Chip
                key={s}
                active={!handActive && scopeOverride === s}
                onClick={() => {
                  setScopeOverride(s)
                  setMaskSource('layout')
                  setEditMode(false)
                }}
              >
                {s === 'auto' ? `auto (${resolved.scope})` : s}
              </Chip>
            ))}
            <Chip
              active={handActive}
              disabled={!savedMask && !maskDirty && !editMode}
              onClick={() => setMaskSource('hand')}
            >
              hand
            </Chip>
          </div>
          <label className="mb-[6px] flex items-center gap-[8px] text-[13px]">
            <input type="checkbox" checked={maskView} onChange={(e) => setMaskView(e.target.checked)} />
            Show mask overlay
          </label>
          {!handActive && (
            <Slider label="Mask feather" value={maskFeather} min={0} max={0.06} step={0.001} onChange={setMaskFeather} />
          )}

          {devSurface ? (
            !editMode ? (
              <div className="mb-[6px] flex flex-wrap gap-[6px]">
                <ActionBtn onClick={startEdit}>✏️ Edit mask (Pencil)</ActionBtn>
                {savedMask && <ActionBtn onClick={deleteMask}>Delete saved</ActionBtn>}
              </div>
            ) : (
              <div className="space-y-[8px]">
                <div className="flex flex-wrap gap-[6px]">
                  <ActionBtn active={brushMode === 'brush'} onClick={() => setBrushMode('brush')}>
                    Brush
                  </ActionBtn>
                  <ActionBtn active={brushMode === 'erase'} onClick={() => setBrushMode('erase')}>
                    Erase
                  </ActionBtn>
                  <ActionBtn onClick={() => editorRef.current?.undo()}>Undo</ActionBtn>
                  <ActionBtn onClick={() => editorRef.current?.clear()}>Clear</ActionBtn>
                  <ActionBtn onClick={() => editorRef.current?.fill()}>Fill</ActionBtn>
                  <ActionBtn onClick={() => editorRef.current?.loadLayoutRect(mask.rect, mask.invert, mask.radius)}>
                    Reset to layout
                  </ActionBtn>
                </div>
                <Slider label="Brush size" value={brushSize} min={4} max={120} step={1} onChange={setBrushSize} />
                <label className="flex items-center gap-[8px] text-[13px]">
                  <input type="checkbox" checked={allowTouch} onChange={(e) => setAllowTouch(e.target.checked)} />
                  Allow finger drawing (Pencil + mouse only by default)
                </label>
                <div className="flex flex-wrap gap-[6px]">
                  <ActionBtn onClick={saveMask}>{maskDirty ? 'Save mask ●' : 'Save mask'}</ActionBtn>
                  <ActionBtn onClick={() => setEditMode(false)}>Done</ActionBtn>
                </div>
              </div>
            )
          ) : (
            <p className="text-[11px] text-text-muted">
              Hand-mask editing needs the branch api instance (port 3712) — unavailable here.
            </p>
          )}
          <p className="mt-[6px] text-[11px] text-text-muted">
            {handActive
              ? `Hand mask ${savedMask ? '(saved)' : '(unsaved)'}${maskDirty ? ' — unsaved strokes' : ''}${
                  maskMeta?.aliasOf != null ? ` — same-artwork alias of variant ${maskMeta.aliasOf}` : ''
                } → data/foil-masks/`
              : `Era: ${ERAS[resolved.eraId].label} (rects from era-layouts.json)`}
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
          <Slider label="Intensity" value={uniforms.uIntensity ?? 1} min={0} max={2} step={0.02} onChange={(v) => setU('uIntensity', v)} />
          <Slider label="Pattern scale" value={uniforms.uScale ?? 1} min={0.25} max={3} step={0.05} onChange={(v) => setU('uScale', v)} />
          <Slider label="Hue shift" value={uniforms.uHueShift ?? 0.5} min={0} max={1} step={0.01} onChange={(v) => setU('uHueShift', v)} />
          <Slider label="Hue spread" value={uniforms.uHueSpread ?? 0.5} min={0} max={1.5} step={0.01} onChange={(v) => setU('uHueSpread', v)} />
          <Slider label="Color saturation" value={uniforms.uSat ?? 0.8} min={0} max={1} step={0.01} onChange={(v) => setU('uSat', v)} />
          <Slider label="Art gate (dark areas)" value={uniforms.uArtGate ?? 0} min={0} max={1} step={0.01} onChange={(v) => setU('uArtGate', v)} />
          <Slider label="Specular sheen" value={uniforms.uSpecular ?? 0.4} min={0} max={1.5} step={0.02} onChange={(v) => setU('uSpecular', v)} />
          {pattern.params.length > 0 && <div className="my-[8px] border-t border-border-default" />}
          {pattern.params.map((p) => (
            <Slider
              key={p.key}
              label={p.label}
              value={uniforms[p.key] ?? p.default}
              min={p.min}
              max={p.max}
              step={p.step}
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
          foil/main workbench — quarantined; linked from nowhere.
        </p>
      </div>

      {/* ── Comment modal ── */}
      {commentOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-[16px] min-[700px]:items-center">
          <div className="w-full max-w-[440px] rounded-lg border border-border-default bg-surface-secondary p-[14px]">
            <h2 className="mb-[8px] text-[13px] font-semibold">
              Workbench comment
              <span className="ml-[8px] font-normal text-text-muted">
                {detail?.card.cardId} · {variant?.displayName ?? ''} · {effectivePatternId}
              </span>
            </h2>
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              rows={4}
              placeholder="What's off / what to try — card, pattern, sliders and mask state are captured automatically."
              className="w-full rounded-md border border-border-default bg-surface-tertiary p-[8px] text-[13px] text-text-primary"
            />
            <div className="mt-[10px] flex items-center justify-end gap-[8px]">
              {commentStatus === 'error' && <span className="mr-auto text-[12px] text-red-400">Save failed — is the 3712 api up?</span>}
              {commentStatus === 'saved' && <span className="mr-auto text-[12px] text-action-primary">Saved to issues/foil/ ✓</span>}
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
