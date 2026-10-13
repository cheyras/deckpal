/* ─────────────────────────────────────────────────────────────────────────────
 * "What it can do": Read and change, or Read only.
 *
 * The OAuth consent screen (routes/Authorize.tsx) and the new-token form in
 * Profile → Agent access (components/AgentAccess.tsx) both offer this choice,
 * so it is one component over SCOPE_OPTIONS: the two screens cannot describe
 * the same scope two different ways. A native radio group inside a fieldset,
 * so the legend names the group for assistive technology and the arrow keys
 * move between the options.
 * ───────────────────────────────────────────────────────────────────────────── */
import { SCOPE_OPTIONS, type ConsentScope } from '../lib/oauthConsent'

export function ScopeChoice({
  name,
  value,
  onChange,
  disabled = false,
  readOnlyOffered = true,
  className,
}: {
  /** The radio group's name; unique on the page. */
  name: string
  value: ConsentScope
  onChange: (scope: ConsentScope) => void
  disabled?: boolean
  /** False when the server cannot enforce read-only, so only full access is offered. */
  readOnlyOffered?: boolean
  className?: string
}) {
  return (
    <fieldset className={className} disabled={disabled}>
      <legend className="mb-[8px] text-[14px] font-bold text-text-primary">What it can do</legend>
      <div className="flex flex-col gap-[8px]">
        {SCOPE_OPTIONS.filter((option) => option.value === 'full' || readOnlyOffered).map((option) => (
          <label
            key={option.value}
            className={`flex cursor-pointer items-start gap-[10px] rounded-[12px] border p-[12px] transition-colors ${
              value === option.value
                ? 'border-action-primary bg-halo-neutral'
                : 'border-action-ghost-border bg-surface-tertiary hover:border-text-muted'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="mt-[3px] h-[16px] w-[16px] shrink-0 accent-[var(--color-action-primary)]"
            />
            <span className="min-w-0">
              <span className="block text-[14px] font-bold text-text-primary">{option.label}</span>
              <span className="block text-[14px] leading-[1.5] text-text-body">{option.detail}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
