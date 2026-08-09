import type { Progress } from '../lib/api'
import { setLevelLabel } from '../lib/format'

type Goal = 'complete' | 'master' | 'grandmaster'

// The two-bar progress cluster (UI-SPEC §3.6, pkmn.gg captures §8/§10).
// Bar 1 = Complete Set (gradient salmon→yellow, 3 milestone dots at 25/50/75,
// dots become stars once passed). Bar 2 = Master, or Grandmaster when that goal
// is selected — its colour flips green→purple accordingly.
// DECISION (DECISIONS.md): we LABEL bar 2; pkmn.gg leaves it unlabelled.
export function ProgressCluster({ progress, goal }: { progress: Progress; goal: Goal }) {
  const complete = progress.complete
  const second = goal === 'grandmaster' ? progress.grandmaster : progress.master
  const secondLabel = goal === 'grandmaster' ? 'Grandmaster' : 'Master'
  const secondColor = goal === 'grandmaster' ? 'var(--color-completion-grandmaster)' : 'var(--color-success)'
  const lvl = setLevelLabel(complete.pct)

  return (
    <div className="flex items-end gap-[16px]">
      <div className="min-w-[220px] flex-1">
        <div className="mb-[6px] text-[10px] font-bold leading-[15px] text-text-muted">
          <span className="text-[15px] font-extrabold text-text-primary">{complete.owned}</span>
          /{complete.total} Collected
        </div>
        {/* Bar 1 — Complete */}
        <div className="relative h-[6px] w-full overflow-visible rounded-full bg-[#1a1d24]">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(100, complete.pct)}%`,
              background: 'linear-gradient(90deg, var(--color-action-danger), var(--color-action-primary-strong))',
            }}
          />
          {[25, 50, 75].map((m) => {
            const passed = complete.pct >= m
            return (
              <span
                key={m}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px] leading-none"
                style={{ left: `${m}%`, color: passed ? 'var(--color-action-primary-strong)' : 'var(--color-text-muted)' }}
              >
                {passed ? '★' : '●'}
              </span>
            )
          })}
        </div>
        {/* Bar 2 — Master / Grandmaster (thinner, no dots) */}
        <div className="mt-[4px] flex items-center gap-[8px]">
          <div className="relative h-[2px] flex-1 rounded-full bg-[#1a1d24]">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(100, second.pct)}%`, background: secondColor }}
            />
          </div>
          <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: secondColor }}>
            {secondLabel}
          </span>
        </div>
      </div>

      {/* Right cluster: LVL, main %, second % */}
      <div className="flex flex-col items-end gap-[1px] pb-[2px]">
        <span className="text-[9px] font-extrabold leading-[15px] text-action-primary">LVL {lvl}</span>
        <span className="text-[15px] font-extrabold leading-[15px] text-text-primary">{complete.pct}%</span>
        <span className="text-[11px] leading-[15px] text-text-muted">{second.pct}%</span>
      </div>
    </div>
  )
}
