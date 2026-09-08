import { setTopbar } from '../../lib/topbar'
import { pushSettings } from '../../lib/settingsSync'
import { useTopbar } from '../../lib/useTopbar'

/**
 * Switch the header between the translucent binder cover and the flat
 * pre-effect bar. Here so the two can be compared on the real chrome, over
 * real content — the effect's whole risk is that it quietly shifts the bar's
 * grey, and that is only visible by flipping back and forth.
 *
 * Also reachable anywhere via `?topbar=cover` / `?topbar=flat`.
 */
export function TopbarToggle() {
  const current = useTopbar()
  return (
    <div className="inline-flex rounded-full bg-surface-tertiary p-[3px]" role="group" aria-label="Top bar">
      {(['cover', 'flat'] as const).map((option) => {
        const active = current === option
        return (
          <button
            key={option}
            type="button"
            onClick={() => {
              setTopbar(option)
              pushSettings({ topbar: option })
            }}
            aria-pressed={active}
            title={option === 'cover' ? 'Translucent, blurred, grained' : 'Opaque — the pre-effect header'}
            className={[
              'h-[26px] rounded-full px-[12px] text-[12px] font-bold capitalize',
              active ? 'bg-action-primary text-action-primary-text' : 'text-text-muted hover:text-text-primary',
            ].join(' ')}
          >
            {option}
          </button>
        )
      })}
    </div>
  )
}
