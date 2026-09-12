import type { SetSummary } from '../lib/api'
import { fmtDate } from '../lib/format'

/**
 * An announced set that upstream has not published yet — see apps/api's
 * `upcomingSets.ts`. Same chrome as `SetRow`, three deliberate differences:
 *
 *   1. A `<div>`, not a `<Link>`. There is no set page to go to: `setId` is a
 *      placeholder id, so the route would resolve and then 404 on the fetch.
 *      Kept as a separate component rather than a `disabled` prop on `SetRow`
 *      because "is it an anchor" is the whole difference, and a component that
 *      is sometimes an anchor is the thing that grows a click handler later.
 *   2. NO `data-decke-clickable`. That attribute is the authorisation Deck-E's
 *      `resolveClickTarget` looks for; without it he is told "that is not
 *      something I am allowed to press". The landmark attributes STAY, so he
 *      can still see the row and say the set is coming — being unable to press
 *      it is the point, being unable to perceive it is not. (Belt and braces:
 *      even were the attribute added, the tag/role check refuses a `<div>`.)
 *   3. Muted, with a Coming Soon pill. Deliberately neutral tokens rather than
 *      an accent — "not available yet" is an absence, and every accent in this
 *      palette is already spoken for by a state that IS available.
 */
export function UpcomingSetRow({ set }: { set: SetSummary }) {
  return (
    <div
      className="flex items-stretch overflow-hidden rounded-lg border border-dashed border-border-default bg-surface-tertiary/60"
      role="group"
      aria-label={`${set.name} — coming soon`}
      data-decke-set={set.setId}
      data-decke-landmark={`[data-decke-set="${set.setId}"]`}
      data-decke-label={`the ${set.name} set row, which is not out yet`}
    >
      <div
        className="flex w-[100px] shrink-0 items-center justify-center border-r border-border-default p-[10px] sm:w-[132px]"
        style={{
          background:
            'linear-gradient(135deg, var(--color-surface-quaternary), var(--color-surface-tertiary))',
        }}
      >
        {/* A plain <img>, not <SetLogo>: that component resolves through the
            image tier by TCGdex id, which returns nothing for a set the catalog
            has never seen. This asset ships in the bundle. */}
        {set.logoAssetPath ? (
          <img
            src={set.logoAssetPath}
            alt=""
            className="max-h-[64px] max-w-[80px] object-contain opacity-80 sm:max-w-[112px]"
          />
        ) : (
          <span className="px-[6px] text-center text-[14px] text-text-muted">{set.name}</span>
        )}
      </div>
      <div className="min-w-0 flex-1 p-[14px]">
        {/* On narrow cards the Coming Soon pill stacks UNDER the title so the
            title keeps the full content width and the announced name is never
            squeezed to an ellipsis (the 390px defect: '30th Celebr…' beside a
            fixed 100px logo panel + a nowrap pill). On >=sm the pill returns to
            the right of the title — the desktop appearance is unchanged. The
            title wraps instead of truncating: concealing the announced name is
            worse than a second line. */}
        <div className="flex flex-col gap-[6px] sm:flex-row sm:items-start sm:gap-[10px]">
          <div className="min-w-0 flex-1">
            <div className="font-display text-[16px] font-semibold text-text-body break-words">
              {set.name}
            </div>
            <div className="text-[14px] text-text-muted">{fmtDate(set.releasedOn)}</div>
          </div>
          <span className="self-start shrink-0 whitespace-nowrap rounded-full border border-border-default px-[8px] py-[2px] text-[12px] font-semibold uppercase tracking-wide text-text-secondary">
            Coming Soon
          </span>
        </div>
        <div className="mt-[10px] text-[14px] text-text-muted">
          {set.cardCountTotal > 0 ? `${set.cardCountTotal.toLocaleString()} cards` : 'Not yet listed'}
        </div>
      </div>
    </div>
  )
}
