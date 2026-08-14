/**
 * Catalog section: discovers *.gallery.tsx files via import.meta.glob,
 * renders each entry with its states grid and interactive knob strip.
 *
 * Since the glob lives inside the DEV-only route module, gallery files
 * are excluded from prod bundles.
 */
import { useState, type ComponentType } from 'react'
import type { GalleryMeta, KnobDef } from './galleryTypes'
import { BooleanKnob, PropNumberKnob, TextKnob, SelectKnob } from './knobs'
import { designApi } from './designApi'

// Glob all gallery files from src/ — eager so they're available synchronously.
// The path is relative to this file's location (routes/design/).
const galleryModules = import.meta.glob('../../**/*.gallery.tsx', { eager: true }) as Record<
  string,
  Record<string, unknown>
>

function isGalleryMeta(v: unknown): v is GalleryMeta<any> {
  return (
    typeof v === 'object' &&
    v !== null &&
    'name' in v &&
    'source' in v &&
    'section' in v &&
    'component' in v &&
    'variants' in v &&
    'defaults' in v
  )
}

function getGalleries(): GalleryMeta<any>[] {
  // Dedupe by object identity: gallery files commonly do both
  // `export const fooGallery = {...}` and `export default fooGallery` for
  // convenience, which makes fooGallery show up twice in Object.values(mod).
  // A Set keyed on reference equality collapses that back to one entry.
  const seen = new Set<GalleryMeta<any>>()
  for (const mod of Object.values(galleryModules)) {
    for (const exp of Object.values(mod)) {
      if (isGalleryMeta(exp)) seen.add(exp)
    }
  }
  return Array.from(seen)
}

interface CatalogSectionProps {
  section: 'primitive' | 'component'
  title: string
  /** False in production read-only mode — hides the "Send to agent" composers. */
  editable: boolean
}

export function CatalogSection({ section, title, editable }: CatalogSectionProps) {
  const galleries = getGalleries().filter((g) => g.section === section)

  if (galleries.length === 0) {
    return (
      <div className="rounded-lg bg-surface-secondary p-[16px]">
        <h3 className="text-[14px] font-semibold text-text-primary mb-[8px]">{title}</h3>
        <p className="text-[12px] text-text-muted">No {section} gallery files found yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-[16px]">
      <h3 className="text-[16px] font-semibold text-text-primary">{title}</h3>
      {galleries.map((gallery) => (
        <GalleryEntry key={gallery.name} gallery={gallery} editable={editable} />
      ))}
    </div>
  )
}

// ── Gallery entry ───────────────────────────────────────────────────────

interface GalleryEntryProps {
  gallery: GalleryMeta<any>
  editable: boolean
}

function GalleryEntry({ gallery, editable }: GalleryEntryProps) {
  const [knobState, setKnobState] = useState<Record<string, any>>({ ...gallery.defaults })
  const [showKnobs, setShowKnobs] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Overlay entries (position: fixed, full-viewport — modals, sheets, popovers)
  // are never mounted eagerly: see the `overlay` doc comment in galleryTypes.ts.
  // `openVariant` tracks which variants-grid card (if any) is currently open;
  // `knobPreviewOpen` tracks the separate "Interactive" knob-preview instance.
  const isOverlay = gallery.overlay === true
  const [openVariant, setOpenVariant] = useState<number | null>(null)
  const [knobPreviewOpen, setKnobPreviewOpen] = useState(false)

  const Component = gallery.component as ComponentType<any>

  const updateKnob = (key: string, value: any) => {
    setKnobState((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div className="rounded-lg bg-surface-secondary overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-[16px] py-[10px] bg-surface-tertiary/50">
        <div>
          <h4 className="text-[14px] font-semibold text-text-primary">{gallery.name}</h4>
          {gallery.description && (
            <p className="text-[11px] text-text-muted mt-[2px]">{gallery.description}</p>
          )}
          <p className="text-[10px] text-text-muted font-mono mt-[2px]">{gallery.source}</p>
        </div>
        {gallery.knobs && Object.keys(gallery.knobs).length > 0 && (
          <button
            onClick={() => setShowKnobs(!showKnobs)}
            className="h-[28px] rounded-full bg-surface-quaternary px-[12px] text-[11px] text-text-muted hover:text-text-primary"
          >
            {showKnobs ? 'Hide knobs' : 'Knobs'}
          </button>
        )}
      </div>

      {/* Variants grid */}
      <div className="p-[16px]">
        <div className="flex flex-wrap gap-[12px]">
          {gallery.variants.map((variant, i) => (
            <div
              key={i}
              className="rounded-lg border border-border-default bg-surface-primary p-[12px] min-w-[120px]"
            >
              <div className="text-[10px] text-text-muted mb-[8px] font-medium">{variant.label}</div>
              {isOverlay ? (
                <>
                  <button
                    onClick={() => setOpenVariant(i)}
                    className="w-full rounded-lg border border-dashed border-border-default bg-surface-tertiary/40 px-[10px] py-[16px] text-[11px] text-text-muted hover:border-action-primary hover:text-text-primary"
                  >
                    Preview: {gallery.name} — click to open
                  </button>
                  {openVariant === i && (
                    <ErrorBoundary
                      onError={(msg) => setError(msg)}
                      fallback={<div className="text-[11px] text-error">Render error</div>}
                    >
                      <Component {...variant.props} onClose={() => setOpenVariant(null)} />
                    </ErrorBoundary>
                  )}
                </>
              ) : (
                <ErrorBoundary
                  onError={(msg) => setError(msg)}
                  fallback={<div className="text-[11px] text-error">Render error</div>}
                >
                  <Component {...variant.props} />
                </ErrorBoundary>
              )}
            </div>
          ))}
        </div>

        {error && (
          <div className="mt-[8px] rounded bg-halo-error px-[8px] py-[4px] text-[11px] text-error">
            {error}
          </div>
        )}
      </div>

      {/* Interactive knob instance */}
      {showKnobs && gallery.knobs && (
        <div className="border-t border-border-default px-[16px] py-[12px] space-y-[12px]">
          <div className="text-[11px] font-medium text-text-muted uppercase tracking-wide">
            Interactive
          </div>
          <div className="flex flex-col gap-[16px] lg:flex-row">
            {/* Preview */}
            <div className="rounded-lg border border-border-default bg-surface-primary p-[16px] min-w-[200px]">
              {isOverlay ? (
                <>
                  <button
                    onClick={() => setKnobPreviewOpen(true)}
                    className="w-full rounded-lg border border-dashed border-border-default bg-surface-tertiary/40 px-[10px] py-[16px] text-[11px] text-text-muted hover:border-action-primary hover:text-text-primary"
                  >
                    Preview: {gallery.name} (interactive) — click to open
                  </button>
                  {knobPreviewOpen && (
                    <ErrorBoundary
                      onError={() => {}}
                      fallback={<div className="text-[11px] text-error">Render error</div>}
                    >
                      <Component {...knobState} onClose={() => setKnobPreviewOpen(false)} />
                    </ErrorBoundary>
                  )}
                </>
              ) : (
                <ErrorBoundary
                  onError={() => {}}
                  fallback={<div className="text-[11px] text-error">Render error</div>}
                >
                  <Component {...knobState} />
                </ErrorBoundary>
              )}
            </div>
            {/* Knobs */}
            <div className="flex-1 space-y-[6px]">
              {Object.entries(gallery.knobs).map(([key, def]) => (
                <KnobControl
                  key={key}
                  name={key}
                  def={def as KnobDef<any>}
                  value={knobState[key]}
                  onChange={(v) => updateKnob(key, v)}
                />
              ))}
              <button
                onClick={() => setKnobState({ ...gallery.defaults })}
                className="mt-[8px] h-[28px] rounded bg-surface-quaternary px-[12px] text-[11px] text-text-muted hover:text-text-primary"
              >
                Reset to defaults
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send to agent composer (Lane B) — dev server only */}
      {editable && <AgentComposer gallery={gallery} knobState={knobState} />}
    </div>
  )
}

// ── Agent composer ─────────────────────────────────────────────────────

function AgentComposer({
  gallery,
  knobState,
}: {
  gallery: GalleryMeta<any>
  knobState: Record<string, any>
}) {
  const [open, setOpen] = useState(false)
  const [intent, setIntent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; id?: string; error?: string } | null>(null)

  const handleSubmit = async () => {
    if (!intent.trim()) return
    setSubmitting(true)
    setResult(null)
    try {
      const context: Record<string, unknown> = {
        component: gallery.name,
        source: gallery.source,
        section: gallery.section,
      }

      // Include current knob state if any knobs exist and have non-default values
      if (gallery.knobs && Object.keys(gallery.knobs).length > 0) {
        const knobDiff: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(knobState)) {
          if (value !== (gallery.defaults as Record<string, unknown>)[key]) {
            knobDiff[key] = value
          }
        }
        if (Object.keys(knobDiff).length > 0) {
          context.currentKnobState = knobDiff
        }
      }

      // Include active token overrides if any are on the document root
      const rootStyle = document.documentElement.style
      const overrides: Record<string, string> = {}
      for (let i = 0; i < rootStyle.length; i++) {
        const prop = rootStyle[i]
        if (prop.startsWith('--')) {
          overrides[prop] = rootStyle.getPropertyValue(prop).trim()
        }
      }
      if (Object.keys(overrides).length > 0) {
        context.activeTokenOverrides = overrides
      }

      const res = await designApi.submitRequest({
        kind: 'component-change',
        target: gallery.name,
        intent: intent.trim(),
        context,
      })
      setResult({ ok: true, id: res.id })
      setIntent('')
    } catch (e: any) {
      setResult({ ok: false, error: e.message || 'Failed to submit' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="border-t border-border-default">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-[6px] px-[16px] py-[8px] text-[11px] text-text-muted hover:text-text-primary hover:bg-surface-tertiary/30"
      >
        <span className="text-[13px]">{open ? '▾' : '▸'}</span>
        Send to agent
      </button>

      {open && (
        <div className="px-[16px] pb-[12px] space-y-[8px]">
          {/* Pre-filled context display */}
          <div className="flex flex-wrap gap-[6px]">
            <span className="rounded bg-surface-quaternary px-[6px] py-[1px] text-[9px] font-mono text-text-muted">
              {gallery.name}
            </span>
            <span className="rounded bg-surface-quaternary px-[6px] py-[1px] text-[9px] font-mono text-text-muted">
              {gallery.source}
            </span>
          </div>

          {/* Intent textarea */}
          <textarea
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder={`Describe what to change in ${gallery.name}... (e.g. "increase the md height to 46px", "add a new outline variant")`}
            rows={3}
            className="w-full rounded-lg border border-border-default bg-surface-primary px-[12px] py-[8px] text-[12px] text-text-primary placeholder:text-text-muted/60 focus:border-action-primary focus:outline-none resize-y"
          />

          <div className="flex items-center justify-between">
            <button
              onClick={handleSubmit}
              disabled={!intent.trim() || submitting}
              className="h-[28px] rounded-full bg-action-primary px-[14px] text-[11px] font-bold text-action-primary-text hover:bg-action-primary-hover disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit request'}
            </button>

            {result && (
              <span
                className={`text-[11px] ${
                  result.ok ? 'text-success' : 'text-error'
                }`}
              >
                {result.ok
                  ? `Queued (${result.id?.slice(0, 8)}...)`
                  : result.error}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Knob control router ─────────────────────────────────────────────────

function KnobControl({
  name,
  def,
  value,
  onChange,
}: {
  name: string
  def: KnobDef<any>
  value: any
  onChange: (v: any) => void
}) {
  switch (def.kind) {
    case 'boolean':
      return <BooleanKnob label={name} value={!!value} onChange={onChange} />
    case 'text':
      return <TextKnob label={name} value={String(value ?? '')} onChange={onChange} />
    case 'number':
      return (
        <PropNumberKnob
          label={name}
          value={Number(value ?? 0)}
          onChange={onChange}
          min={def.min}
          max={def.max}
          step={def.step}
        />
      )
    case 'select':
      return (
        <SelectKnob
          label={name}
          value={String(value ?? '')}
          onChange={onChange}
          options={def.options.map(String)}
        />
      )
    default:
      return null
  }
}

// ── Error boundary ──────────────────────────────────────────────────────

import { Component, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback: ReactNode
  onError?: (message: string) => void
}

interface ErrorBoundaryState {
  hasError: boolean
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error.message)
  }

  render() {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}
