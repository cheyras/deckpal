// foil/MaskProvenance.tsx — the workbench's view of mask provenance (sidecar v3).
//
// Two pieces, both phone-first (they live in the 390px single column):
//
//   <MaskProvenanceLine>  a badge + one line under the mask controls: WHO made
//                         this mask, and — on tap — the generator that proposed
//                         it, which of Chey's masks it learned from, and what
//                         he changed when he corrected it.
//   <MaskCorpusPanel>     the corpus at a glance: counts by method, how many
//                         masks a generator is allowed to learn from, the queue
//                         of AI masks awaiting review, and the corrections
//                         recorded so far.
//
// Kept OUT of FoilLab.tsx on purpose: FoilLab is contended (patterns/shader/
// slider work lands there constantly), so the provenance surface is one import
// + two tags there and everything else here.

import { useEffect, useState } from 'react'
import {
  foilApi,
  type FoilCorpusReport,
  type FoilDerivationMethod,
  type FoilMaskSidecar,
} from './api'
import { Section } from './ui'

/** How each method presents itself. Colors carry the review state, not the age. */
const METHOD_STYLE: Record<FoilDerivationMethod, { label: string; short: string; cls: string; blurb: string }> = {
  hand: {
    label: 'Hand-painted',
    short: 'hand',
    cls: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300',
    blurb: 'You painted this from the layout prior. Ground truth — a generator may learn from it.',
  },
  'hand-refined': {
    label: 'Hand-refined',
    short: 'hand-refined',
    cls: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300',
    blurb: 'You painted on top of an existing mask. Ground truth — a generator may learn from it.',
  },
  'ai-corrected': {
    label: 'AI · you corrected it',
    short: 'ai-corrected',
    cls: 'border-sky-400/50 bg-sky-400/15 text-sky-300',
    blurb: 'An AI proposed this and you fixed it. The fix is recorded as training signal (weight 0.6 — anchored by the proposal).',
  },
  ai: {
    label: 'AI · UNREVIEWED',
    short: 'ai',
    cls: 'border-amber-400/60 bg-amber-400/20 text-amber-200',
    blurb: 'A machine proposal nobody has looked at. It can NEVER be an exemplar — correct it to turn it into training signal.',
  },
  'layout-flatten': {
    label: 'Baked window (unpainted)',
    short: 'baked',
    cls: 'border-slate-400/40 bg-slate-400/15 text-slate-300',
    blurb: 'Machine-rasterized geometry — the window rect, no strokes. Not an exemplar: it only teaches the rect the rule already has.',
  },
}

export function MethodBadge({ method, compact = false }: { method: FoilDerivationMethod; compact?: boolean }) {
  const s = METHOD_STYLE[method]
  return (
    <span
      className={`inline-block shrink-0 rounded-full border px-[7px] py-[2px] text-[10px] font-semibold uppercase tracking-[0.04em] ${s.cls}`}
      title={s.blurb}
    >
      {compact ? s.short : s.label}
    </span>
  )
}

const pctOf = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : n.toFixed(3))

/** Where corrections landed, as the sidecar's coarse grid. Tiny by design. */
function CorrectionGrid({ grid }: { grid: { size: number; cells: number[] } }) {
  const max = Math.max(...grid.cells, 0.0001)
  return (
    <div
      className="grid w-[76px] gap-[1px] rounded-[3px] border border-border-default p-[2px]"
      style={{ gridTemplateColumns: `repeat(${grid.size}, minmax(0, 1fr))` }}
      title="Where your corrections concentrate (darker = more changed)"
    >
      {grid.cells.map((c, i) => (
        <div
          key={i}
          className="aspect-square rounded-[1px] bg-sky-400"
          style={{ opacity: 0.12 + 0.88 * (c / max) }}
        />
      ))}
    </div>
  )
}

/**
 * Provenance line for the mask currently on screen. `sidecar` is null while
 * loading or when the mask is unsaved; `liveMethod` lets the caller show what
 * the NEXT save will stamp before it happens.
 */
export function MaskProvenanceLine({
  sidecar,
  aliasOf,
  cardId,
  variantId,
  scope,
  pendingNote,
}: {
  sidecar: FoilMaskSidecar | null
  aliasOf: number | null
  cardId: string
  variantId: number
  scope: string
  /** e.g. "unsaved strokes — will save as hand-refined". */
  pendingNote?: string | null
}) {
  const [open, setOpen] = useState(false)
  if (!sidecar) {
    return pendingNote ? <p className="mt-[6px] text-[11px] text-text-muted">{pendingNote}</p> : null
  }
  const g = sidecar.prior.generator ?? sidecar.correction?.parent.generator ?? null
  const c = sidecar.correction ?? null
  const sup = sidecar.supersedes ?? null
  return (
    <div className="mt-[8px] rounded-md border border-border-default bg-surface-tertiary/50 p-[8px]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-[8px] text-left"
        aria-expanded={open}
      >
        <MethodBadge method={sidecar.derivation_method} />
        <span className="min-w-0 flex-1 truncate text-[11px] text-text-muted">
          {new Date(sidecar.savedAt).toLocaleString()}
          {aliasOf != null ? ` · alias of variant ${aliasOf}` : ''}
        </span>
        <span className="shrink-0 text-[11px] text-text-muted">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-[8px] space-y-[8px] border-t border-border-default pt-[8px] text-[11px] leading-[16px] text-text-muted">
          <p>{METHOD_STYLE[sidecar.derivation_method].blurb}</p>

          <p className="tabular-nums">
            vs era rule: agreement {pctOf(sidecar.diff?.agreement)} · +{sidecar.diff?.addedPx ?? 0}px / −
            {sidecar.diff?.removedPx ?? 0}px · sidecar v{sidecar.version} · prior source “{sidecar.prior.source}”
          </p>

          {g && (
            <div className="rounded-[4px] border border-border-default p-[6px]">
              <p className="font-semibold text-text-primary">
                Generated by {g.name}@{g.version}
                {g.modelId ? ` · ${g.modelId}` : ''}
              </p>
              <p className="tabular-nums">
                run {g.runId} · confidence {g.confidence === null ? 'none emitted' : g.confidence}
              </p>
              <p className="mt-[4px]">
                Learned from {g.exemplars.length} human mask{g.exemplars.length === 1 ? '' : 's'}:
              </p>
              <ul className="ml-[12px] list-disc">
                {g.exemplars.map((e) => (
                  <li key={`${e.cardId}-${e.variantId}`} className="tabular-nums">
                    {e.cardId}/{e.variantId} · {e.method} · weight {e.weight}
                  </li>
                ))}
                {g.exemplars.length === 0 && <li>none — it learned from nothing</li>}
              </ul>
            </div>
          )}

          {sup && (
            <div className="rounded-[4px] border border-amber-400/40 bg-amber-400/10 p-[6px]">
              <p className="font-semibold text-amber-200">
                This REPLACED your {sup.parent.method} mask — you have not agreed to it yet
              </p>
              <div className="mt-[4px] flex items-start gap-[8px]">
                <CorrectionGrid grid={sup.grid} />
                <p className="tabular-nums">
                  agreement with what you drew {sup.agreement} · +{sup.addedPx}px added / −{sup.removedPx}px removed ·{' '}
                  {(sup.changedFraction * 100).toFixed(2)}% of the face changed
                </p>
              </div>
              <div className="mt-[6px] flex gap-[6px]">
                <a
                  className="underline"
                  href={foilApi.maskArtifactUrl(cardId, variantId, 'parent', scope)}
                  target="_blank"
                  rel="noreferrer"
                >
                  your original
                </a>
                <a
                  className="underline"
                  href={foilApi.maskArtifactUrl(cardId, variantId, 'parent-diff', scope)}
                  target="_blank"
                  rel="noreferrer"
                >
                  change map
                </a>
              </div>
              <p className="mt-[6px] break-all">
                Undo, byte-for-byte (archived at <code>{sup.archiveDir}</code>):
                <br />
                <code className="text-text-primary">
                  pnpm --filter deckscout-api exec tsx src/foil/generate-masks.ts revert --run-id {sup.runId}
                </code>
              </p>
            </div>
          )}

          {c && (
            <div className="rounded-[4px] border border-sky-400/30 bg-sky-400/5 p-[6px]">
              <p className="font-semibold text-text-primary">
                Your correction of the previous mask ({c.parent.method})
              </p>
              <div className="mt-[4px] flex items-start gap-[8px]">
                <CorrectionGrid grid={c.grid} />
                <p className="tabular-nums">
                  agreement with what you started from {c.agreement} · +{c.addedPx}px added / −{c.removedPx}px removed ·{' '}
                  {(c.changedFraction * 100).toFixed(2)}% of the face changed
                </p>
              </div>
              <div className="mt-[6px] flex gap-[6px]">
                <a
                  className="underline"
                  href={foilApi.maskArtifactUrl(cardId, variantId, 'parent', scope)}
                  target="_blank"
                  rel="noreferrer"
                >
                  before
                </a>
                <a
                  className="underline"
                  href={foilApi.maskArtifactUrl(cardId, variantId, 'parent-diff', scope)}
                  target="_blank"
                  rel="noreferrer"
                >
                  change map
                </a>
                <a
                  className="underline"
                  href={foilApi.maskArtifactUrl(cardId, variantId, 'diff', scope)}
                  target="_blank"
                  rel="noreferrer"
                >
                  vs era rule
                </a>
              </div>
            </div>
          )}

          {sidecar.lineage && sidecar.lineage.length > 1 && (
            <p>
              lineage:{' '}
              {sidecar.lineage
                .map((l) => l.method + (l.generator ? ` (${l.generator.name}@${l.generator.version})` : ''))
                .join(' → ')}
            </p>
          )}
          {pendingNote && <p className="text-amber-300">{pendingNote}</p>}
        </div>
      )}
      {!open && pendingNote && <p className="mt-[4px] text-[11px] text-amber-300">{pendingNote}</p>}
    </div>
  )
}

// ── Corpus at a glance ─────────────────────────────────────────────────────

const METHOD_ORDER: FoilDerivationMethod[] = ['hand', 'hand-refined', 'ai-corrected', 'ai', 'layout-flatten']

export function MaskCorpusPanel({
  devSurface,
  refreshKey,
  onPick,
}: {
  devSurface: boolean
  /** Bump to refetch after a save. */
  refreshKey: number
  onPick?: (cardId: string, variantId: number) => void
}) {
  const [report, setReport] = useState<FoilCorpusReport | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!devSurface || !open) return
    const ac = new AbortController()
    void foilApi.maskCorpus(ac.signal).then((r) => setReport(r))
    return () => ac.abort()
  }, [devSurface, open, refreshKey])

  if (!devSurface) return null
  return (
    <Section title="Mask corpus">
      <button onClick={() => setOpen((o) => !o)} className="mb-[8px] w-full text-left text-[12px] text-text-muted">
        {open ? '▲ hide' : '▼ show'} provenance report
        {report ? ` — ${report.total} mask${report.total === 1 ? '' : 's'}` : ''}
      </button>
      {open && !report && <p className="text-[11px] text-text-muted">Loading…</p>}
      {open && report && (
        <div className="space-y-[10px] text-[11px] leading-[16px] text-text-muted">
          <div className="flex flex-wrap gap-[6px]">
            {METHOD_ORDER.filter((m) => report.byMethod[m] > 0).map((m) => (
              <span key={m} className="flex items-center gap-[4px]">
                <MethodBadge method={m} compact />
                <span className="tabular-nums text-text-primary">{report.byMethod[m]}</span>
              </span>
            ))}
            {report.total === 0 && <span>No masks yet.</span>}
          </div>

          <p className="tabular-nums">
            mean agreement vs the era rule: <span className="text-text-primary">{pctOf(report.meanAgreement)}</span> ·
            exemplars a generator may learn from:{' '}
            <span className="text-text-primary">{report.exemplarsAvailable.total}</span>
          </p>
          <p className="text-[10px]">
            Unreviewed <code>ai</code> masks are never exemplars — that is the anti-feedback-collapse rule, enforced in
            selection code, not by convention.
          </p>

          {Object.keys(report.byEra).length > 0 && (
            <div>
              <p className="font-semibold text-text-primary">by era</p>
              {Object.entries(report.byEra).map(([k, b]) => (
                <p key={k} className="tabular-nums">
                  {k}: n={b.n} · agree {pctOf(b.meanAgreement)} ·{' '}
                  {Object.entries(b.byMethod)
                    .filter(([, v]) => v)
                    .map(([m, v]) => `${m} ${v}`)
                    .join(', ')}
                </p>
              ))}
            </div>
          )}
          {Object.keys(report.bySet).length > 0 && (
            <div>
              <p className="font-semibold text-text-primary">by set</p>
              {Object.entries(report.bySet).map(([k, b]) => (
                <p key={k} className="tabular-nums">
                  {k}: n={b.n} · agree {pctOf(b.meanAgreement)}
                </p>
              ))}
            </div>
          )}

          <div>
            <p className="font-semibold text-text-primary">
              awaiting review ({report.awaitingReview.length})
            </p>
            {report.awaitingReview.length === 0 && <p>Nothing queued.</p>}
            {report.awaitingReview.map((a) => (
              <button
                key={`${a.cardId}-${a.variantId}`}
                onClick={() => onPick?.(a.cardId, a.variantId)}
                className="block w-full text-left tabular-nums underline decoration-dotted hover:text-text-primary"
              >
                {a.cardId}/{a.variantId} · {a.generator ? `${a.generator.name}@${a.generator.version}` : 'no id'} · conf{' '}
                {a.confidence ?? '—'} · vs-rule {pctOf(a.agreement)}
              </button>
            ))}
          </div>

          <div>
            <p className="font-semibold text-text-primary">corrections recorded ({report.corrections.n})</p>
            {report.corrections.n === 0 && <p>None yet — correct an AI mask to create the first training pair.</p>}
            {report.corrections.entries.map((c) => (
              <p key={`${c.cardId}-${c.variantId}-${c.savedAt}`} className="tabular-nums">
                {c.cardId}/{c.variantId} · fixed a {c.parentMethod}
                {c.generator ? ` (${c.generator})` : ''} · agree {c.agreement} · +{c.addedPx}/−{c.removedPx}px
              </p>
            ))}
          </div>
        </div>
      )}
    </Section>
  )
}
