import { setTypeface, TYPEFACES } from '../../lib/typeface'
import { useTypeface } from '../../lib/useTypeface'

/**
 * Live switch between the candidate font pairings. Sits beside the skin toggle
 * in the dev design-system header, but the preference is global (localStorage),
 * so flipping it here changes the real app — which is the point: type has to be
 * judged on actual screens at actual sizes, not on a specimen.
 *
 * Also reachable anywhere via `?type=fraunces` / `bricolage` / `jakarta` / `inter`.
 */
export function TypefaceToggle() {
  const current = useTypeface()
  return (
    <div className="inline-flex rounded-full bg-surface-tertiary p-[3px]" role="group" aria-label="Typeface">
      {TYPEFACES.map((t) => {
        const active = current === t.id
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setTypeface(t.id)}
            aria-pressed={active}
            title={t.note}
            className={[
              'h-[26px] rounded-full px-[10px] text-[11px] font-bold',
              active ? 'bg-action-primary text-action-primary-text' : 'text-text-muted hover:text-text-primary',
            ].join(' ')}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
