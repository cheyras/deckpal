// foil/FoilLab.tsx — the quarantined foil tuning workbench (/pokedex/foil-lab).
//
// Reachable by URL only — linked from NOWHERE in the app shell (quarantine
// rule, roadmap/plans/foil-main.md). One owned card/variant at a time, real
// scan from the image cache, tilt-driven foil shader, and dev controls:
// uniform sliders, pattern override, mask overlay toggle. Phone-first at
// 390px — Chey reviews from his phone via the dev hub.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { foilApi } from './api'
import { PATTERNS, patternById, type FoilPattern } from './patterns'
import { GLOBAL_DEFAULTS } from './shader'
import { resolveFoil, maskForScope, ERAS, type FoilScope } from './resolver'
import { useTilt } from './useTilt'
import { CardViewer, type ViewerSettings } from './CardViewer'

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
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full border px-[10px] py-[4px] text-[12px] transition-colors ${
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

// ── The workbench ──────────────────────────────────────────────────────────

export function FoilLab() {
  const [sel, setSel] = useState<Selection>(loadSelection)
  const [patternOverride, setPatternOverride] = useState<string>('auto')
  const [scopeOverride, setScopeOverride] = useState<'auto' | FoilScope>('auto')
  const [maskView, setMaskView] = useState(false)
  const [maskFeather, setMaskFeather] = useState(0.008)
  const [maxTiltDeg, setMaxTiltDeg] = useState(16)
  const [copied, setCopied] = useState(false)

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

  // ── Uniforms: reset on pattern change, live in state + ref ──
  const [uniforms, setUniforms] = useState<Record<string, number>>(() => seedUniforms(pattern))
  useEffect(() => {
    setUniforms(seedUniforms(pattern))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern.id])

  const settingsRef = useRef<ViewerSettings>({
    uniforms,
    maskRect: mask.rect,
    maskRadius: mask.radius,
    maskFeather,
    maskInvert: mask.invert,
    maskView,
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
      maxTiltDeg,
    }
  }, [uniforms, mask, maskFeather, maskView, maxTiltDeg])

  const setU = (k: string, v: number) => setUniforms((u) => ({ ...u, [k]: v }))

  const copyRecipe = async () => {
    const recipe = {
      pattern: effectivePatternId,
      scope: effectiveScope,
      era: resolved.eraId,
      card: detail?.card.cardId,
      variant: variant?.kind,
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

  return (
    <div className="flex min-h-screen flex-col bg-surface-primary text-text-primary lg:h-screen lg:flex-row lg:overflow-hidden">
      {/* ── Viewer ── */}
      <div className="relative h-[52vh] shrink-0 bg-[#0b0d12] lg:h-full lg:flex-1">
        <CardViewer
          imageUrl={imageUrl}
          pattern={pattern}
          settingsRef={settingsRef}
          tiltTarget={tilt.target}
          onPointerMove={tilt.onPointerMove}
          onPointerLeave={tilt.onPointerLeave}
          className="h-full w-full"
        />
        <div className="pointer-events-none absolute left-[12px] top-[10px] text-[12px]">
          <div className="font-semibold">{detail ? detail.card.name : 'Foil workbench'}</div>
          <div className="text-text-muted">
            {detail ? `${detail.card.set.name} · #${detail.card.number}` : 'pick a card below'}
            {variant ? ` · ${variant.displayName}` : ''}
          </div>
        </div>
        <div className="pointer-events-none absolute right-[12px] top-[10px] rounded-full bg-surface-secondary/70 px-[8px] py-[2px] text-[11px] text-text-muted">
          {tilt.mode}
          {pattern.id !== 'none' && patternOverride === 'auto' ? ' · auto' : ''}
        </div>
      </div>

      {/* ── Controls ── */}
      <div className="flex-1 space-y-[12px] overflow-y-auto p-[12px] lg:w-[400px] lg:flex-none lg:shrink-0">
        <Section title="Card (owned scans)">
          <div className="mb-[8px] flex gap-[6px] overflow-x-auto pb-[2px]">
            {(seriesQ.data ?? []).map((s) => (
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

        <Section title="Mask (layout tier)">
          <div className="mb-[8px] flex items-center gap-[6px]">
            {(['auto', 'window', 'sheet', 'full'] as const).map((s) => (
              <Chip key={s} active={scopeOverride === s} onClick={() => setScopeOverride(s)}>
                {s === 'auto' ? `auto (${resolved.scope})` : s}
              </Chip>
            ))}
          </div>
          <label className="mb-[6px] flex items-center gap-[8px] text-[13px]">
            <input type="checkbox" checked={maskView} onChange={(e) => setMaskView(e.target.checked)} />
            Show mask overlay
          </label>
          <Slider label="Mask feather" value={maskFeather} min={0} max={0.06} step={0.001} onChange={setMaskFeather} />
          <p className="text-[11px] text-text-muted">
            Era: {ERAS[resolved.eraId].label} (rects from era-layouts.json)
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
          foil/main workbench v1 — quarantined; linked from nowhere.
        </p>
      </div>
    </div>
  )
}
