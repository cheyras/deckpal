// The sweep mode's instrument panel: what the live detector did with the frame
// on screen, and which stage stopped it.
//
// Deliberately numbers-first and unstyled-looking. The reader is walking around
// a room holding a phone at arm's length, glancing down between aims — so every
// value that matters is a monospace figure at a fixed position, and nothing
// moves or animates. The one coloured element is the stage chip, because "how
// far did this get" is the only thing that has to be readable without focusing.
import type { EngineStatus } from '../ui/useScanEngine'
import { sweepHeadline, type SweepVerdict } from './sweep'

/** Stage → chip colour. `locked`/`tracked` borrow the product's own tones so a
 *  reader who has used /scan reads them without translating; the two rejection
 *  stages take the overlay's diagnostic colours, for the same reason. */
const TONE: Record<SweepVerdict['stage'], string> = {
  locked: 'bg-emerald-400/20 text-emerald-300',
  tracked: 'bg-cyan-400/20 text-cyan-300',
  gated: 'bg-amber-400/20 text-amber-300',
  proposed: 'bg-rose-400/20 text-rose-300',
  none: 'bg-white/10 text-white/40',
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <span className="flex items-baseline gap-[4px]" title={hint}>
      <span className="text-white/40">{label}</span>
      <b className="font-mono text-white/90">{value}</b>
    </span>
  )
}

export function SweepReadout({
  verdict,
  status,
  error,
}: {
  verdict: SweepVerdict | null
  status: EngineStatus
  error: string | null
}) {
  if (status === 'error') {
    return (
      <div className="shrink-0 bg-red-500/15 px-[12px] py-[6px] text-[11px] leading-[15px] text-red-200">
        Live detection failed to start: {error ?? 'unknown error'}. The shutter still works — the
        seed runs on the frozen frame either way.
      </div>
    )
  }
  if (!verdict) {
    return (
      <div className="shrink-0 bg-white/5 px-[12px] py-[6px] text-[11px] leading-[15px] text-white/50">
        {status === 'loading' ? 'Loading the detector…' : 'Waiting for the first detect tick…'}
      </div>
    )
  }

  // `hasObj` against the threshold it was actually judged by — never a
  // constant imported here. See sweep.ts and EngineState.thresholds.
  const gate = verdict.hasObj >= verdict.acquire ? '≥' : '<'

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-[10px] gap-y-[3px] bg-white/5 px-[12px] py-[6px] text-[11px] leading-[16px]">
      <span className={`rounded px-[6px] py-[1px] text-[10px] font-bold uppercase tracking-wide ${TONE[verdict.stage]}`}>
        {verdict.stage}
      </span>
      <span className="min-w-0 flex-1 truncate text-white/60">{sweepHeadline(verdict)}</span>
      <Figure
        label="obj"
        value={`${verdict.hasObj.toFixed(2)} ${gate} ${verdict.acquire.toFixed(2)}`}
        hint="Presence head vs the acquire threshold. Between hold and acquire the gate keeps its previous state — that band is where every measured error lives (gate.ts)."
      />
      {verdict.saturation !== null && (
        <Figure
          label="sat"
          value={`${verdict.saturation.toFixed(3)} / ${verdict.minSaturation.toFixed(2)}`}
          hint="Mean colour saturation inside the quad, against the lock floor. Below the floor a real card can never auto-fire — the postal-envelope gate."
        />
      )}
      <Figure label="obs" value={String(verdict.observed)} hint="Quads the tracker was offered this tick" />
      <Figure label="trk" value={String(verdict.tracked)} hint="Live tracks — what the product would be drawing" />
      <Figure
        label="ms"
        value={`${Math.round(verdict.detectMs)} @ ${verdict.hz.toFixed(1)}Hz`}
        hint="Detect time and tick rate on this device"
      />
    </div>
  )
}
