/**
 * The pay-what-you-want control.
 *
 * ── $0 IS A BUTTON IN THE ROW, NOT A LINK UNDERNEATH ─────────────────────────
 *
 * This is the whole design, and everything else here follows from it. A
 * pay-what-you-want tier where "nothing" is a small grey link below the real
 * choices is not pay-what-you-want; it is a price list with a guilt tax. So $0
 * is the FIRST preset, the same size and weight as the others, selectable with
 * the same tap, and reads "$0" rather than "No thanks" — because it is an
 * amount, not a refusal, and the copy elsewhere says so out loud.
 *
 * ── "MOST COMMON", NOT "RECOMMENDED" ─────────────────────────────────────────
 *
 * One preset carries a marker. It says what other people pick, which is a fact;
 * "recommended" would be an instruction, and an instruction from the person
 * asking for the money is not a recommendation.
 *
 * ── THE CUSTOM FIELD IS WHOLE DOLLARS ────────────────────────────────────────
 *
 * Matching `normalizeAmountCents` on the server, which is the authority. A
 * control that lets somebody type 4.37 and then rejects it has wasted their
 * time to enforce a rule it could have expressed. `inputMode="numeric"` so a
 * phone opens the number pad.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { formatAmount } from '../../lib/billing'

/** The preset that gets the "most common" marker, in cents. */
const MOST_COMMON_CENTS = 500

export function AmountChooser({
  presetsCents,
  valueCents,
  onChange,
  minCents,
  maxCents,
  disabled,
}: {
  presetsCents: number[]
  valueCents: number
  onChange: (cents: number) => void
  minCents: number
  maxCents: number
  disabled?: boolean
}) {
  const groupId = useId()
  // "Custom" is a mode, not a value: someone who types 7 and then taps $5 and
  // then taps Custom again should find their 7 still there.
  const [custom, setCustom] = useState(() => (presetsCents.includes(valueCents) ? '' : String(valueCents / 100)))
  const [customOpen, setCustomOpen] = useState(() => !presetsCents.includes(valueCents))
  const customRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (customOpen) customRef.current?.focus()
  }, [customOpen])

  const dollars = Number(custom)
  const customCents = Number.isFinite(dollars) ? Math.round(dollars) * 100 : NaN
  const customProblem =
    !customOpen || custom.trim() === ''
      ? null
      : !Number.isFinite(dollars) || !/^\d+$/.test(custom.trim())
        ? 'Whole dollars only, please.'
        : customCents < minCents
          ? `The smallest we can charge is ${formatAmount(minCents)} — or pick $0.`
          : customCents > maxCents
            ? `That is more than ${formatAmount(maxCents)} a month. If you really mean it, email us and we will set it up by hand.`
            : null

  function pickPreset(cents: number) {
    setCustomOpen(false)
    onChange(cents)
  }

  function typeCustom(next: string) {
    // Strip anything that is not a digit as it is typed rather than complaining
    // afterwards — the field cannot hold a value the server would reject.
    const cleaned = next.replace(/[^\d]/g, '').slice(0, 4)
    setCustom(cleaned)
    const c = cleaned === '' ? NaN : Number(cleaned) * 100
    if (Number.isFinite(c) && c >= minCents && c <= maxCents) onChange(c)
  }

  return (
    <div role="group" aria-labelledby={`${groupId}-label`}>
      <div id={`${groupId}-label`} className="mb-[10px] text-[13px] font-semibold text-text-secondary">
        Choose your monthly amount
      </div>

      {/* Six columns from sm up, not five: the five presets plus Custom then sit
          on ONE row. At five, Custom wrapped alone onto a second row and read as
          a different KIND of thing from the presets, which is exactly the
          hierarchy this control is trying not to have. */}
      <div className="grid grid-cols-3 gap-[8px] sm:grid-cols-6">
        {presetsCents.map((cents) => {
          const selected = !customOpen && valueCents === cents
          return (
            <button
              key={cents}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => pickPreset(cents)}
              className={[
                'relative flex h-[54px] flex-col items-center justify-center rounded-[12px] border text-[17px] font-extrabold transition-colors disabled:opacity-50',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-primary',
                selected
                  ? 'border-action-primary bg-action-primary text-action-primary-text'
                  : 'border-action-ghost-border bg-surface-tertiary text-text-primary hover:border-surface-raised',
              ].join(' ')}
            >
              {formatAmount(cents)}
              {cents === MOST_COMMON_CENTS && (
                <span
                  className={[
                    'text-[10px] font-bold uppercase tracking-wide',
                    selected ? 'text-action-primary-text/80' : 'text-text-muted',
                  ].join(' ')}
                >
                  most common
                </span>
              )}
            </button>
          )
        })}

        <button
          type="button"
          disabled={disabled}
          aria-pressed={customOpen}
          onClick={() => setCustomOpen(true)}
          className={[
            'flex h-[54px] items-center justify-center rounded-[12px] border text-[14px] font-bold transition-colors disabled:opacity-50',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-primary',
            customOpen
              ? 'border-action-primary bg-action-primary text-action-primary-text'
              : 'border-dashed border-border-default text-text-secondary hover:bg-surface-tertiary',
          ].join(' ')}
        >
          Custom
        </button>
      </div>

      {customOpen && (
        <div className="mt-[12px]">
          <label htmlFor={`${groupId}-custom`} className="mb-[6px] block text-[13px] font-semibold text-text-secondary">
            Your amount, per month
          </label>
          <div className="flex items-center gap-[10px]">
            <div className="relative">
              <span className="pointer-events-none absolute left-[14px] top-1/2 -translate-y-1/2 text-[17px] font-bold text-text-muted">
                $
              </span>
              <input
                ref={customRef}
                id={`${groupId}-custom`}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="7"
                value={custom}
                disabled={disabled}
                aria-invalid={!!customProblem || undefined}
                aria-describedby={customProblem ? `${groupId}-custom-msg` : undefined}
                onChange={(e) => typeCustom(e.target.value)}
                className={[
                  'w-[132px] rounded-[10px] border bg-surface-tertiary py-[12px] pl-[30px] pr-[14px] text-[17px] font-bold text-text-primary',
                  'placeholder:font-normal placeholder:text-text-muted disabled:opacity-60',
                  customProblem ? 'border-error' : 'border-action-ghost-border focus:border-surface-raised',
                ].join(' ')}
              />
            </div>
            <span className="text-[14px] text-text-muted">per month</span>
          </div>
          {customProblem && (
            <p id={`${groupId}-custom-msg`} className="mt-[6px] text-[13px] text-error">
              {customProblem}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
