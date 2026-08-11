import { setSkin } from '../../lib/skin'
import { useSkin } from '../../lib/useSkin'

/**
 * Live switch between the premium pass and the pre-pass look.
 *
 * It lives in the dev design-system header because that is where the whole
 * component set can be compared side by side — but the preference is stored
 * globally (localStorage), so flipping it here changes the real app too. The
 * same switch is reachable anywhere via `?skin=premium` / `?skin=classic`.
 */
export function SkinToggle() {
  const skin = useSkin()
  return (
    <div
      className="inline-flex rounded-full bg-surface-tertiary p-[3px]"
      role="group"
      aria-label="Visual skin"
    >
      {(['premium', 'classic'] as const).map((option) => {
        const active = skin === option
        return (
          <button
            key={option}
            type="button"
            onClick={() => setSkin(option)}
            aria-pressed={active}
            className={[
              'h-[26px] rounded-full px-[12px] text-[11px] font-bold capitalize',
              active
                ? 'bg-action-primary text-action-primary-text'
                : 'text-text-muted hover:text-text-primary',
            ].join(' ')}
          >
            {option}
          </button>
        )
      })}
    </div>
  )
}
