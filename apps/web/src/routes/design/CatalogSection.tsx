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
  const result: GalleryMeta<any>[] = []
  for (const mod of Object.values(galleryModules)) {
    for (const exp of Object.values(mod)) {
      if (isGalleryMeta(exp)) result.push(exp)
    }
  }
  return result
}

interface CatalogSectionProps {
  section: 'primitive' | 'component'
  title: string
}

export function CatalogSection({ section, title }: CatalogSectionProps) {
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
        <GalleryEntry key={gallery.name} gallery={gallery} />
      ))}
    </div>
  )
}

// ── Gallery entry ───────────────────────────────────────────────────────

interface GalleryEntryProps {
  gallery: GalleryMeta<any>
}

function GalleryEntry({ gallery }: GalleryEntryProps) {
  const [knobState, setKnobState] = useState<Record<string, any>>({ ...gallery.defaults })
  const [showKnobs, setShowKnobs] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
              <ErrorBoundary
                onError={(msg) => setError(msg)}
                fallback={<div className="text-[11px] text-error">Render error</div>}
              >
                <Component {...variant.props} />
              </ErrorBoundary>
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
              <ErrorBoundary
                onError={() => {}}
                fallback={<div className="text-[11px] text-error">Render error</div>}
              >
                <Component {...knobState} />
              </ErrorBoundary>
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
