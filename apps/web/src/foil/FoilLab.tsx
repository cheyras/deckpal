// foil/FoilLab.tsx — surface B of the workbench split (/pokedex/foil-lab):
// the CARD ADJUSTMENT surface (issues/foil/2026-08-02_12-59-52-368_4aq756).
//
// Card-to-card differences ONLY: per-card mask work (hand masks, layout
// masks, artwork-keyed aliasing), per-card uniform overrides layered on top
// of the canon pattern defaults, and the comment queue. The canonical
// pattern recipes themselves are locked on surface A — the canon lab at
// /pokedex/foil-lab/canon (CanonLab.tsx) — and load here as the slider
// baseline (foil/canon.ts explains the layering).
//
// Reachable by URL only — linked from NOWHERE in the app shell (quarantine
// rule, roadmap/plans/foil-main.md). One card/variant at a time — ANY card in
// the catalog, owned or not (Owned-only is a filter toggle; scans come from
// the app-wide image cache either way). Layouts: single column at phone
// widths (390px), two columns from iPad-mini portrait up (≥700px: viewer |
// controls).
//
// The mask/override/comment surfaces need the BRANCH api dev instance
// (POKEDEX_FOIL_LAB=1 — roadmap/ORCHESTRATION.md); against prod they probe
// as unavailable and those affordances hide themselves.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { foilApi, type FoilMaskMeta, type FoilVariant } from './api'
import { PATTERNS, patternById, canonicalPatternId } from './patterns'
import { canonBaseline, canonFor, sparseDiff } from './canon'
import { resolveFoil, maskForScope, ERAS, RESOLVER_VERSION, type FoilScope } from './resolver'
import { useTilt } from './useTilt'
import { CardViewer, cardScreenRect, type ViewerSettings } from './CardViewer'
import { MaskEditor, createMaskCanvas, MASK_W, MASK_H, type BrushMode, type MaskEditorHandle } from './MaskEditor'
import { ActionBtn, Chip, Section, Select, Slider, SurfaceTabs } from './ui'

const LS_KEY = 'foil-lab:selection'
const LS_OWNED_KEY = 'foil-lab:owned-only'

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

// UI atoms + seedUniforms moved to foil/ui.tsx and foil/canon.ts for the
// workbench split — both surfaces share them.

// ── The workbench ──────────────────────────────────────────────────────────

export function FoilLab() {
  const queryClient = useQueryClient()
  const [sel, setSel] = useState<Selection>(loadSelection)
  // Owned-only picker filter (default ON = the original owned-scans workbench).
  const [ownedOnly, setOwnedOnly] = useState(() => localStorage.getItem(LS_OWNED_KEY) !== '0')
  // Full-catalog name search (input is live; the query string is debounced).
  const [searchText, setSearchText] = useState('')
  const [searchQ, setSearchQ] = useState('')
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
  useEffect(() => {
    localStorage.setItem(LS_OWNED_KEY, ownedOnly ? '1' : '0')
  }, [ownedOnly])
  useEffect(() => {
    const t = setTimeout(() => setSearchQ(searchText.trim()), 250)
    return () => clearTimeout(t)
  }, [searchText])
  const searching = searchQ.length >= 2

  const tilt = useTilt()

  // ── Data: series → sets → cards (each owned-filtered or full catalog) ──
  const seriesQ = useQuery({
    queryKey: ['foil', 'series', ownedOnly],
    queryFn: ({ signal }) => foilApi.series(ownedOnly, signal),
  })
  const setsQ = useQuery({
    queryKey: ['foil', 'sets', sel.seriesSlug, ownedOnly],
    queryFn: ({ signal }) => foilApi.sets(sel.seriesSlug!, ownedOnly, signal),
    enabled: Boolean(sel.seriesSlug),
  })
  // Paged (promo sets run 300+ cards; the strip appends pages via a More chip).
  const cardsQ = useInfiniteQuery({
    queryKey: ['foil', 'cards', sel.setId, ownedOnly],
    queryFn: ({ pageParam, signal }) => foilApi.cards(sel.setId!, ownedOnly, pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.pageCount ? last.page + 1 : undefined),
    enabled: Boolean(sel.setId),
  })
  const cards = useMemo(() => cardsQ.data?.pages.flatMap((p) => p.cards) ?? [], [cardsQ.data])
  const cardsTotal = cardsQ.data?.pages[0]?.total ?? 0
  // Full-catalog search — deliberately ignores Owned-only (search exists to
  // reach cards the browse filters would hide).
  const searchResultsQ = useInfiniteQuery({
    queryKey: ['foil', 'search', searchQ],
    queryFn: ({ pageParam, signal }) => foilApi.search(searchQ, pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.pageCount ? last.page + 1 : undefined),
    enabled: searching,
  })
  const searchHits = useMemo(
    () => searchResultsQ.data?.pages.flatMap((p) => p.hits) ?? [],
    [searchResultsQ.data],
  )
  const searchTotal = searchResultsQ.data?.pages[0]?.total ?? 0
  const detailQ = useQuery({
    queryKey: ['foil', 'card', sel.cardId],
    queryFn: ({ signal }) => foilApi.cardDetail(sel.cardId!, signal),
    enabled: Boolean(sel.cardId),
  })
  const devQ = useQuery({ queryKey: ['foil', 'dev-surface'], queryFn: () => foilApi.devSurface(), staleTime: Infinity })
  const devSurface = devQ.data === true
  // Canon pattern defaults (locked on surface A) — the slider baseline here.
  const canonQ = useQuery({ queryKey: ['foil', 'canon'], queryFn: ({ signal }) => foilApi.getCanon(signal) })
  // Saved per-card overrides for the selected card/variant (sparse vs canon).
  const overrideQ = useQuery({
    queryKey: ['foil', 'override', sel.cardId, sel.variantId],
    queryFn: ({ signal }) => foilApi.getOverride(sel.cardId!, sel.variantId!, signal),
    enabled: devSurface && Boolean(sel.cardId) && sel.variantId != null,
  })

  // Auto-select down the chain, but ONLY into empty slots (prefer the classic
  // demo: Base Set Machamp). A selection that isn't in the current browse list
  // (picked via search, or hidden by Owned-only) is preserved, never clobbered.
  useEffect(() => {
    if (!sel.seriesSlug && seriesQ.data?.length) {
      const base = seriesQ.data.find((s) => s.slug === 'base')
      setSel((p) => ({ ...p, seriesSlug: (base ?? seriesQ.data[0]).slug }))
    }
  }, [seriesQ.data, sel.seriesSlug])
  useEffect(() => {
    if (sel.seriesSlug && setsQ.data?.length && !sel.setId) {
      const base1 = setsQ.data.find((s) => s.setId === 'base1')
      setSel((p) => ({ ...p, setId: (base1 ?? setsQ.data[0]).setId, cardId: undefined, variantId: undefined }))
    }
  }, [setsQ.data, sel.seriesSlug, sel.setId])
  useEffect(() => {
    if (sel.setId && cards.length && !sel.cardId) {
      const machamp = cards.find((c) => c.cardId === 'base1-8')
      setSel((p) => ({ ...p, cardId: (machamp ?? cards[0]).cardId, variantId: undefined }))
    }
  }, [cards, sel.setId, sel.cardId])
  // Keep the browse chain pointed at the shown card's home (a search pick can
  // jump to any set/series in the catalog).
  useEffect(() => {
    const d = detailQ.data
    if (!d) return
    setSel((p) =>
      p.cardId === d.card.cardId && (p.seriesSlug !== d.card.series.slug || p.setId !== d.card.set.setId)
        ? { ...p, seriesSlug: d.card.series.slug, setId: d.card.set.setId }
        : p,
    )
  }, [detailQ.data])
  useEffect(() => {
    const vs = detailQ.data?.variants
    if (vs?.length && !vs.some((v) => v.variantId === sel.variantId)) {
      // Owned holo > any owned > any holo (unowned cards list their catalog
      // variants; the foil-bearing kind is the interesting default) > first.
      const holo = (v: FoilVariant) => v.kind.toLowerCase().includes('holo')
      const pick =
        vs.find((v) => v.quantity > 0 && holo(v)) ?? vs.find((v) => v.quantity > 0) ?? vs.find(holo) ?? vs[0]
      setSel((p) => ({ ...p, variantId: pick.variantId }))
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
        // Set + card identity feed the cited assignment/usage lookups (v3 resolver).
        setId: detail?.card.set.setId ?? sel.setId ?? null,
        setName: detail?.card.set.name ?? null,
        cardName: detail?.card.name ?? null,
        cardId: detail?.card.cardId ?? sel.cardId ?? null,
      }),
    [detail, variant, sel.seriesSlug, sel.setId],
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

  // ── Uniforms: canon baseline + saved card overrides, live in state + ref ──
  // Layering (foil/canon.ts): code defaults < canon file < per-card override
  // < live sliders. Reseed ONLY when the seed key changes (pattern, canon
  // save, card/variant, override save) — background refetches with identical
  // data never clobber in-progress slider tweaks.
  const canon = canonFor(canonQ.data ?? undefined, pattern.id)
  const baseline = useMemo(() => canonBaseline(pattern, canon), [pattern, canon])
  const override =
    overrideQ.data && canonicalPatternId(overrideQ.data.patternId) === pattern.id ? overrideQ.data : null
  const [uniforms, setUniforms] = useState<Record<string, number>>(() => canonBaseline(pattern, undefined))
  const seedKey = `${pattern.id}|${canon?.savedAt ?? 'code'}|${sel.cardId ?? ''}|${sel.variantId ?? ''}|${override?.savedAt ?? 'none'}`
  const lastSeed = useRef<string | null>(null)
  useEffect(() => {
    if (lastSeed.current === seedKey) return
    lastSeed.current = seedKey
    setUniforms({ ...baseline, ...(override?.uniforms ?? {}) })
  }, [seedKey, baseline, override])

  // Sparse live diff vs the canon baseline — what "Save card overrides" writes.
  const overrideDiff = useMemo(() => sparseDiff(uniforms, baseline), [uniforms, baseline])
  const overrideDiffKeys = Object.keys(overrideDiff)
  const [overrideStatus, setOverrideStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const saveOverrides = async () => {
    if (!detail || sel.variantId == null) return
    setOverrideStatus('saving')
    try {
      if (overrideDiffKeys.length === 0) {
        // Sliders match canon — an override file would say nothing; remove it.
        if (override) await foilApi.deleteOverride(detail.card.cardId, sel.variantId)
      } else {
        await foilApi.putOverride(detail.card.cardId, sel.variantId, {
          patternId: pattern.id,
          patternOverride: patternOverride === 'auto' ? null : canonicalPatternId(patternOverride),
          uniforms: overrideDiff,
          baseline: { canonSavedAt: canon?.savedAt ?? null },
        })
      }
      await queryClient.invalidateQueries({ queryKey: ['foil', 'override', sel.cardId, sel.variantId] })
      setOverrideStatus('saved')
      setTimeout(() => setOverrideStatus('idle'), 1500)
    } catch {
      setOverrideStatus('error')
    }
  }

  const removeOverrides = async () => {
    if (!detail || sel.variantId == null) return
    try {
      await foilApi.deleteOverride(detail.card.cardId, sel.variantId)
      await queryClient.invalidateQueries({ queryKey: ['foil', 'override', sel.cardId, sel.variantId] })
      setUniforms({ ...baseline })
    } catch {
      setOverrideStatus('error')
    }
  }

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
    surface: 'card-adjust',
    cardId: detail?.card.cardId,
    variantId: sel.variantId,
    // Canon/override linkage: which canon save the sliders were baselined on,
    // and whether saved card overrides were active.
    canonSavedAt: canon?.savedAt ?? null,
    overrideSavedAt: override?.savedAt ?? null,
    overrideDirtyKeys: overrideDiffKeys,
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

  // Era-grouped picker: series bucketed by frame generation. Series with no
  // era-layouts.json mapping get an honest "other" bucket rather than being
  // silently lumped under the SV header (the resolver still falls back to
  // modern-sv rects for them — that's the layout prior, not the grouping).
  const mappedSlugs = useMemo(() => new Set(Object.values(ERAS).flatMap((e) => e.seriesSlugs)), [])
  const eraGroups = useMemo(() => {
    const groups: { eraId: string; label: string; series: NonNullable<typeof seriesQ.data> }[] = []
    for (const s of seriesQ.data ?? []) {
      const mapped = mappedSlugs.has(s.slug)
      const eraId = mapped ? resolveFoil({ seriesSlug: s.slug, rarity: null, variantKind: null }).eraId : 'other'
      let g = groups.find((x) => x.eraId === eraId)
      if (!g) {
        g = {
          eraId,
          label: mapped ? ERAS[eraId as keyof typeof ERAS].label : 'Other eras (no layout spec yet — SV rects)',
          series: [],
        }
        groups.push(g)
      }
      g.series.push(s)
    }
    return groups
  }, [seriesQ.data, mappedSlugs])

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
        <SurfaceTabs active="card" />

        <Section title={ownedOnly ? 'Card (owned, by era)' : 'Card (full catalog, by era)'}>
          <div className="mb-[8px] flex items-center gap-[8px]">
            <input
              type="search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search all cards…"
              className="min-w-0 flex-1 rounded-md border border-border-default bg-surface-tertiary px-[8px] py-[6px] text-[13px] text-text-primary placeholder:text-text-muted"
            />
            <Chip active={ownedOnly} onClick={() => setOwnedOnly((o) => !o)}>
              Owned only
            </Chip>
          </div>
          {searching ? (
            <div>
              <div className="max-h-[300px] space-y-[2px] overflow-y-auto">
                {searchHits.map((h) => (
                  <button
                    key={h.cardId}
                    onClick={() => {
                      setSel((p) => ({ ...p, cardId: h.cardId, variantId: undefined }))
                      setSearchText('')
                    }}
                    className={`flex w-full items-center gap-[8px] rounded-md px-[4px] py-[3px] text-left hover:bg-surface-tertiary ${
                      h.cardId === sel.cardId ? 'bg-action-primary/10' : ''
                    }`}
                  >
                    <img
                      src={h.images.low}
                      alt=""
                      loading="lazy"
                      className="w-[30px] shrink-0 rounded-[2px]"
                      style={{ aspectRatio: '245 / 337' }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-text-primary">{h.name}</span>
                      <span className="block truncate text-[11px] text-text-muted">
                        {h.set.name} · #{h.number}
                        {h.rarity ? ` · ${h.rarity}` : ''}
                      </span>
                    </span>
                  </button>
                ))}
                {searchResultsQ.isLoading && <p className="py-[6px] text-[12px] text-text-muted">searching…</p>}
                {!searchResultsQ.isLoading && searchHits.length === 0 && (
                  <p className="py-[6px] text-[12px] text-text-muted">No catalog match for “{searchQ}”.</p>
                )}
                {searchResultsQ.hasNextPage && (
                  <button
                    onClick={() => void searchResultsQ.fetchNextPage()}
                    className="w-full rounded-md border border-border-default py-[6px] text-[12px] text-text-muted hover:border-action-primary"
                  >
                    {searchResultsQ.isFetchingNextPage ? 'loading…' : `More (${searchTotal - searchHits.length} left)`}
                  </button>
                )}
              </div>
              {searchHits.length > 0 && (
                <p className="mt-[6px] text-[11px] text-text-muted">
                  {searchTotal} match{searchTotal === 1 ? '' : 'es'} in the whole catalog (ignores Owned only)
                </p>
              )}
            </div>
          ) : (
            <>
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
                        {s.name}
                        {ownedOnly && <span className="ml-[4px] opacity-60">{s.progress.owned}</span>}
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
                  {sel.setId && !setsQ.data.some((s) => s.setId === sel.setId) && (
                    <option value={sel.setId}>{detail?.card.set.name ?? sel.setId} (outside filter)</option>
                  )}
                  {setsQ.data.map((s) => (
                    <option key={s.setId} value={s.setId}>
                      {s.name} ({ownedOnly ? `${s.progress.complete.owned} owned` : `${s.cardCountTotal} cards`})
                    </option>
                  ))}
                </Select>
              )}
              <div className="mt-[8px] flex gap-[8px] overflow-x-auto pb-[4px]">
                {cards.map((c) => (
                  <button
                    key={c.cardId}
                    onClick={() => setSel((p) => ({ ...p, cardId: c.cardId, variantId: undefined }))}
                    className={`relative w-[64px] shrink-0 overflow-hidden rounded-[5px] border-2 ${
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
                    {!ownedOnly && c.ownership.totalQuantity > 0 && (
                      <span
                        className="absolute right-[3px] top-[3px] h-[8px] w-[8px] rounded-full bg-action-primary ring-1 ring-black/40"
                        title="owned"
                      />
                    )}
                  </button>
                ))}
                {cardsQ.hasNextPage && (
                  <button
                    onClick={() => void cardsQ.fetchNextPage()}
                    className="flex w-[64px] shrink-0 items-center justify-center rounded-[5px] border border-border-default text-[12px] text-text-muted hover:border-action-primary"
                    style={{ aspectRatio: '245 / 337' }}
                  >
                    {cardsQ.isFetchingNextPage ? '…' : `+${cardsTotal - cards.length}`}
                  </button>
                )}
                {cardsQ.isLoading && <span className="text-[12px] text-text-muted">loading…</span>}
              </div>
            </>
          )}
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
            <optgroup label="Implemented recipes">
              {PATTERNS.filter((p) => p.implemented).map((p) => (
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
              No faithful recipe yet — rendering an approximation via {pattern.approxVia}.
            </p>
          )}
          {patternOverride === 'auto' && resolved.patternId !== 'none' && (
            <p className="mt-[4px] text-[11px] leading-[15px] text-text-muted">
              {resolved.guess.confidence
                ? `Guess: ${resolved.guess.match}-level citation, ${resolved.guess.confidence} confidence (${resolved.guess.sources.join(', ')})${
                    resolved.guess.era ? ` — ${resolved.guess.era}${resolved.guess.years ? ` ${resolved.guess.years}` : ''}` : ''
                  }`
                : 'Guess: era heuristic — no cited usage row for this set/class.'}
            </p>
          )}
          <p className="mt-[4px] text-[11px] leading-[15px] text-text-muted">
            {canon
              ? `Canon: locked ${new Date(canon.savedAt).toLocaleDateString()} — data/foil-canon/${pattern.id}.json`
              : 'Canon: none saved — recipe code defaults. Lock this pattern on the Canon patterns tab.'}
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

        <Section title="Foil uniforms (this card vs canon)">
          <Slider label="Intensity" value={uniforms.uIntensity ?? 1} min={0} max={2} step={0.02} marked={overrideDiffKeys.includes('uIntensity')} onChange={(v) => setU('uIntensity', v)} />
          <Slider label="Pattern scale" value={uniforms.uScale ?? 1} min={0.25} max={3} step={0.05} marked={overrideDiffKeys.includes('uScale')} onChange={(v) => setU('uScale', v)} />
          <Slider label="Hue shift" value={uniforms.uHueShift ?? 0.5} min={0} max={1} step={0.01} marked={overrideDiffKeys.includes('uHueShift')} onChange={(v) => setU('uHueShift', v)} />
          <Slider label="Hue spread" value={uniforms.uHueSpread ?? 0.5} min={0} max={1.5} step={0.01} marked={overrideDiffKeys.includes('uHueSpread')} onChange={(v) => setU('uHueSpread', v)} />
          <Slider label="Color saturation" value={uniforms.uSat ?? 0.8} min={0} max={1} step={0.01} marked={overrideDiffKeys.includes('uSat')} onChange={(v) => setU('uSat', v)} />
          <Slider label="Art gate (dark areas)" value={uniforms.uArtGate ?? 0} min={0} max={1} step={0.01} marked={overrideDiffKeys.includes('uArtGate')} onChange={(v) => setU('uArtGate', v)} />
          <Slider label="Specular sheen" value={uniforms.uSpecular ?? 0.4} min={0} max={1.5} step={0.02} marked={overrideDiffKeys.includes('uSpecular')} onChange={(v) => setU('uSpecular', v)} />
          <Slider label="Mirror darken (substrate)" value={uniforms.uDarken ?? 0} min={0} max={1} step={0.01} marked={overrideDiffKeys.includes('uDarken')} onChange={(v) => setU('uDarken', v)} />
          <Slider label="Ink tint (art metallic)" value={uniforms.uTint ?? 0} min={0} max={1} step={0.01} marked={overrideDiffKeys.includes('uTint')} onChange={(v) => setU('uTint', v)} />
          {pattern.params.length > 0 && <div className="my-[8px] border-t border-border-default" />}
          {pattern.params.map((p) => (
            <Slider
              key={p.key}
              label={p.label}
              value={uniforms[p.key] ?? p.default}
              min={p.min}
              max={p.max}
              step={p.step}
              marked={overrideDiffKeys.includes(p.key)}
              onChange={(v) => setU(p.key, v)}
            />
          ))}
          <div className="my-[8px] border-t border-border-default" />
          <p className="mb-[6px] text-[11px] leading-[15px] text-text-muted">
            {overrideDiffKeys.length > 0
              ? `${overrideDiffKeys.length} uniform${overrideDiffKeys.length === 1 ? '' : 's'} differ${overrideDiffKeys.length === 1 ? 's' : ''} from canon (dotted)`
              : 'Sliders match the canon baseline.'}
            {override
              ? ` · saved overrides ${new Date(override.savedAt).toLocaleDateString()} (${Object.keys(override.uniforms).length}) → data/foil-overrides/`
              : ''}
          </p>
          {devSurface && (
            <div className="mb-[6px] flex flex-wrap gap-[6px]">
              <ActionBtn onClick={saveOverrides} disabled={overrideDiffKeys.length === 0 && !override}>
                {overrideStatus === 'saving'
                  ? 'Saving…'
                  : overrideStatus === 'saved'
                    ? 'Saved ✓'
                    : `Save card overrides${overrideDiffKeys.length > 0 ? ' ●' : ''}`}
              </ActionBtn>
              <ActionBtn onClick={() => setUniforms({ ...baseline })}>Reset to canon</ActionBtn>
              {override && <ActionBtn onClick={removeOverrides}>Delete saved</ActionBtn>}
            </div>
          )}
          {overrideStatus === 'error' && (
            <p className="mb-[6px] text-[12px] text-red-400">Override save failed — is the branch api up?</p>
          )}
          <button
            onClick={copyRecipe}
            className="mt-[6px] w-full rounded-md border border-border-default bg-surface-tertiary py-[8px] text-[13px] text-text-primary hover:border-action-primary"
          >
            {copied ? 'Copied!' : 'Copy recipe JSON'}
          </button>
        </Section>

        <p className="pb-[16px] text-center text-[10px] text-text-muted">
          card adjustment surface — per-card masks + overrides; canon patterns live on the Canon tab.
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
