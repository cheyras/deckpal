import { Link } from '@tanstack/react-router'

/**
 * What stands where a collection control would be, for a logged-out visitor.
 *
 * The catalog is fully browsable signed-out, so every page has one or two spots
 * that used to hold something per-user: the set page's progress bars, the series
 * card's completion ring, a card's quantity steppers. Leaving those spots empty
 * makes a finished product look like a broken one — the eye reads the gap, not
 * the catalog. Leaving them *populated with zeroes* is worse: it states that the
 * visitor owns nothing, about a visitor who does not exist yet.
 *
 * So the gap gets filled with the reason it is there. One prompt per page, in
 * the place the per-user thing would have been — not a banner stapled to the
 * top, and never one per card.
 *
 *   • `inline` — sits in a header slot beside other content (set page progress,
 *     Pokédex completion). Single row, no background.
 *   • `banner`  — owns a full-width row on its own (series index).
 */
export function SignInPrompt({
  title,
  detail,
  variant = 'inline',
}: {
  title: string
  /** The concrete thing they'd get. Skipped in the tightest slots. */
  detail?: string
  variant?: 'inline' | 'banner'
}) {
  const banner = variant === 'banner'
  return (
    <div
      className={[
        'flex flex-wrap items-center gap-x-[16px] gap-y-[10px]',
        banner
          ? 'justify-between rounded-lg border border-border-default bg-surface-tertiary px-[20px] py-[16px]'
          : 'justify-end',
      ].join(' ')}
    >
      <div className={banner ? 'min-w-0' : 'min-w-0 text-right'}>
        <div className="text-[14px] font-semibold leading-[21px] text-text-primary">{title}</div>
        {detail && <div className="text-[14px] leading-[19px] text-text-muted">{detail}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-[8px]">
        <Link
          to="/auth"
          search={{ mode: 'signup' } as never}
          className="flex h-[38px] items-center rounded-lg bg-action-primary px-[16px] text-[14px] font-semibold text-action-primary-text hover:opacity-90"
        >
          Sign up free
        </Link>
        <Link
          to="/auth"
          className="flex h-[38px] items-center rounded-lg border border-border-default px-[14px] text-[14px] font-semibold text-text-body hover:border-surface-quaternary hover:text-text-primary"
        >
          Sign in
        </Link>
      </div>
    </div>
  )
}
