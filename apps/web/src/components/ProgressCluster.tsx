import type { Progress } from '../lib/api'
import type { Goal } from '../routes/setSearch'
import { GOAL_SHORT_LABEL } from '../routes/setSearch'
import { setLevelLabel } from '../lib/format'
import { ProgressBar } from './ui/Progress'

// The progress cluster (UI-SPEC §3.6, pkmn.gg captures §8/§10) — ONE bar,
// configured to whichever goal is currently selected via the `goal` prop
// (GitHub #30). This used to render two bars (Complete always on top, plus a
// thinner Master/Grandmaster bar below) — see DECISIONS.md 2026-08-11 for the
// reversal of that call ("Corrections to the BRIEF" originally asked for
// exactly that two-bar split; the account owner now wants one bar that
// retargets to the active goal instead).
//
// Bar fill, the badge, and the passed-milestone stars all key off the same
// per-goal accent: gradient salmon→yellow for Complete (kept — distinctive,
// already paired with the milestone dots), flat var(--color-success) for
// Master, flat var(--color-completion-grandmaster) for Grandmaster — the
// same two flat colors bar 2 used to carry, now extended to cover Complete
// too and applied to the single remaining bar.
const GOAL_COLOR: Record<Goal, string> = {
  complete: 'var(--color-action-primary-strong)',
  master: 'var(--color-success)',
  grandmaster: 'var(--color-completion-grandmaster)',
}
// Translucent badge backgrounds, same idiom as LegalBadge/ResultBadge
// (routes/deckShared.tsx, routes/deck/intelShared.tsx): a low-alpha wash of
// the same hue as the text color — derived from the goal's own token rather
// than hardcoded rgb triplets, so a brand recolour carries the badges along.
const GOAL_BADGE_BG: Record<Goal, string> = {
  complete: 'color-mix(in srgb, var(--color-action-primary-strong) 16%, transparent)',
  master: 'color-mix(in srgb, var(--color-success) 16%, transparent)',
  grandmaster: 'color-mix(in srgb, var(--color-completion-grandmaster) 18%, transparent)',
}

export function ProgressCluster({ progress, goal }: { progress: Progress; goal: Goal }) {
  const current = progress[goal]
  const accent = GOAL_COLOR[goal]
  // LVL stays keyed to Complete-Set pct no matter which goal is on screen —
  // it's an account-level "trainer level" reading (verified against
  // pkmn.gg, see lib/format.ts), not a per-goal stat, so it doesn't retarget
  // with the bar below it.
  const lvl = setLevelLabel(progress.complete.pct)

  return (
    <div className="flex items-end gap-[16px]">
      <div className="min-w-[220px] flex-1">
        <div className="mb-[6px] flex items-center gap-[8px] text-[14px] font-bold leading-[15px] text-text-muted">
          <span>
            <span className="text-[15px] font-extrabold text-text-primary">{current.owned}</span>
            /{current.total} Collected
          </span>
          <span
            className="inline-flex shrink-0 items-center rounded-full px-[8px] py-[2px] text-[9px] font-bold uppercase tracking-wide"
            style={{ background: GOAL_BADGE_BG[goal], color: accent }}
          >
            {GOAL_SHORT_LABEL[goal]}
          </span>
        </div>
        {/* One bar, retargeted to the active goal (#30) — rendered by the
            ProgressBar primitive (C4). Complete keeps the primitive's default
            brand gradient; Master/Grandmaster take their flat accent. */}
        <ProgressBar
          pct={current.pct}
          milestones={[25, 50, 75]}
          milestonePassed={(m) => current.pct >= m}
          milestoneColor={accent}
          {...(goal !== 'complete' ? { fill: accent } : {})}
        />
      </div>

      {/* Right cluster: LVL (Complete-Set-based, see above) + the active goal's % */}
      <div className="flex flex-col items-end gap-[1px] pb-[2px]">
        <span className="text-[14px] font-extrabold leading-[15px] text-action-primary">LVL {lvl}</span>
        <span className="text-[15px] font-extrabold leading-[15px] text-text-primary">{current.pct}%</span>
      </div>
    </div>
  )
}
