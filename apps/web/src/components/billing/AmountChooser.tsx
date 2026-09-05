/**
 * The pay-what-you-want control.
 *
 * ── $0 IS A BUTTON IN THE ROW, NOT A LINK UNDERNEATH ─────────────────────────
 *
 * This is the whole design, and everything else here follows from it. A
 * pay-what-you-want tier where "nothing" is a small grey link below the real
 * choices is not pay-what-you-want; it is a price list with a guilt tax. So $0
 * is the FIRST cell, the same size and weight as the others, selectable with
 * the same tap, and reads "$0" rather than "No thanks" — because it is an
 * amount, not a refusal, and the copy elsewhere says so out loud.
 *
 * ── "OTHER" IS A CELL, NOT A MODE ────────────────────────────────────────────
 *
 * It used to be a "Custom" button that swapped the control into a different
 * shape with a field underneath. Looking at how the surfaces people actually
 * trust do this — Wikipedia's donation form is the canonical one, and it is
 * the most-tested amount picker on the internet — the grid is UNIFORM and
 * "Other" is simply the last cell, which becomes an input in place. Better for
 * three reasons, all of them about trust rather than taste:
 *
 *   • The layout does not jump. A control that reflows when you touch it feels
 *     unfinished, and this is the moment somebody decides whether to type a
 *     card number.
 *   • One tap and one field, rather than a tap, a reflow, and a hunt for where
 *     the field went.
 *   • Every option looks equally available. A differently-shaped "Custom" reads
 *     as the awkward path, which quietly steers people onto the presets — which
 *     is a thumb on the scale, and this control exists not to have one.
 *
 * ── "MOST PEOPLE PICK $5" IS A CAPTION, NOT A BADGE ON A CELL ────────────────
 *
 * It says what other people pick, which is a fact; "recommended" would be an
 * instruction, and an instruction from the party asking for the money is not a
 * recommendation. Where it goes took three tries and the third is the point:
 *
 *   1. Inside the cell as a second line — made that one button two lines tall
 *      and visibly weightier than its neighbours. A thumb on the scale by
 *      layout.
 *   2. A badge floating on the cell's corner — looked right in isolation and
 *      was wider than a 84px cell, so it overlapped whichever amounts happened
 *      to sit either side of it. Verified in a browser, which is the only way
 *      that was ever going to surface.
 *   3. A caption under the grid. Every cell stays identical, nothing overlaps,
 *      and the fact is still stated plainly.
 *
 * Uniformity is not only tidiness here: the $1 experiment needs the two arms to
 * differ by ONE RUNG and nothing else, and a decoration that lands on a
 * different cell in each arm is a second variable.
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

/** Every cell in the grid is this tall — presets and Other alike. */
const CELL_BASE = [
  'relative flex items-center justify-center rounded-[12px] border h-[56px]',
  'text-[17px] font-extrabold transition-colors disabled:opacity-50',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-primary',
].join(' ')

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
  // "Other" is a mode of the last cell, not a value: someone who types 7, taps
  // $5, then taps Other again should find their 7 still there.
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
      : !/^\d+$/.test(custom.trim())
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
      <div id={`${groupId}-label`} className="mb-[12px] text-[13px] font-semibold text-text-secondary">
        Choose your monthly amount
      </div>

      {/* auto-fit, not a fixed column count. The ladder is 5 or 6 rungs
          depending on the $1 experiment's arm, so a hard column count would
          strand the last cell alone on a second row in one arm and not the
          other — and a control that looks different between arms for a reason
          that is NOT the thing being tested is confounded, not just uneven.
          `minmax` keeps three across at 390px. */}
      <div className="grid gap-[8px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(84px, 1fr))' }}>
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
                CELL_BASE,
                selected
                  ? 'border-action-primary bg-action-primary text-action-primary-text'
                  : 'border-action-ghost-border bg-surface-tertiary text-text-primary hover:border-surface-raised',
              ].join(' ')}
            >
              {formatAmount(cents)}
            </button>
          )
        })}

        {/* The last cell. Identical footprint whether it is a button or a
            field, so nothing in the grid moves when it is chosen. */}
        {customOpen ? (
          <div
            className={[
              CELL_BASE,
              'gap-[2px] px-[10px]',
              customProblem ? 'border-error bg-surface-tertiary' : 'border-action-primary bg-surface-tertiary',
            ].join(' ')}
          >
            <span className="shrink-0 text-[17px] font-bold text-text-muted">$</span>
            <input
              ref={customRef}
              id={`${groupId}-custom`}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="7"
              aria-label="Your own monthly amount, in whole dollars"
              value={custom}
              disabled={disabled}
              aria-invalid={!!customProblem || undefined}
              aria-describedby={customProblem ? `${groupId}-custom-msg` : undefined}
              onChange={(e) => typeCustom(e.target.value)}
              className={[
                'w-full min-w-0 bg-transparent text-[17px] font-extrabold text-text-primary',
                'placeholder:font-normal placeholder:text-text-muted focus:outline-none',
              ].join(' ')}
            />
          </div>
        ) : (
          <button
            type="button"
            disabled={disabled}
            aria-pressed={false}
            onClick={() => setCustomOpen(true)}
            className={[
              CELL_BASE,
              'border-dashed border-border-default text-[14px] font-bold text-text-secondary hover:bg-surface-tertiary',
            ].join(' ')}
          >
            Other
          </button>
        )}
      </div>

      {customProblem ? (
        <p id={`${groupId}-custom-msg`} className="mt-[8px] text-[13px] text-error">
          {customProblem}
        </p>
      ) : (
        presetsCents.includes(MOST_COMMON_CENTS) && (
          <p className="mt-[10px] text-[12px] text-text-muted">
            Most people pick {formatAmount(MOST_COMMON_CENTS)}.
          </p>
        )
      )}
    </div>
  )
}
