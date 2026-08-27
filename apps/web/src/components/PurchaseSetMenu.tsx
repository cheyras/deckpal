import { useState } from 'react'
import type { Goal } from '../routes/setSearch'
import { api, type SetMassEntry } from '../lib/api'
import { Icon } from './Icon'
import { Button } from './ui/Button'
import { Modal } from './ListModals'

// "Purchase Set" — preferences menu + TCGplayer Mass Entry deep-link generation
// (issue 2026-07-30_qhfs2f). The link generation lives in the API
// (GET /sets/:setId/massentry) so deckpal-mcp can reuse it.
//
// Real Mass Entry constraints (research/DECK-FORMATS.md §1.9 + live checks):
// printing and condition can NOT be preselected by link — TCGplayer's own page
// has the preferences panel for those. The only honest preferences here are
// what "needed" means: the goal, and (for master/grandmaster) which finishes
// to include. We say so in the menu instead of offering switches that do nothing.

const FINISHES = [
  { code: 'normal', label: 'Normal' },
  { code: 'reverse', label: 'Reverse Holofoil' },
  { code: 'holo', label: 'Holofoil' },
  { code: 'lenticular', label: 'Lenticular' },
  { code: 'metal', label: 'Metal' },
] as const
type FinishCode = (typeof FINISHES)[number]['code']

const GOALS: { key: Goal; label: string; blurb: string }[] = [
  { key: 'complete', label: 'Complete Set', blurb: 'one of any printing per card' },
  { key: 'master', label: 'Master Set', blurb: 'every standard printing' },
  { key: 'grandmaster', label: 'Grandmaster Set', blurb: 'every printing, stamps included' },
]

// The response shape and the request itself live in `lib/api.ts` (api.setMassEntry).
//
// THIS COMPONENT USED TO HAND-ROLL THE FETCH, and it is worth saying why that
// was fatal rather than merely untidy. It wrote the path literal
// `/deckpal/api/sets/…` — correct for self-host behind nginx, and on cloud a
// path `vercel.json` has no rewrite for, so it fell through to the SPA fallback
// and came back as `200 text/html`. `res.ok` was true, `res.json()` then threw
// the browser's parser error, and on iPad that error's whole text is "The
// string did not match the expected pattern." It also sent no `Authorization`
// header and had no 401 refresh, so fixing only the path would have replaced a
// mystery with a 401 for every user. `api.setMassEntry` has all three (#89,
// #113); nothing in apps/web should write an API path literal again, and
// `apps/web/scripts/check-api-base.mjs` now fails the build if it does.

/** The API is asked to build the cart in one request; this is the deadline for it. */
const GENERATE_TIMEOUT_MS = 20_000

/**
 * What to show when generation fails.
 *
 * An aborted fetch surfaces as a `TimeoutError`/`AbortError` DOMException whose
 * message ("signal timed out") describes the plumbing rather than what the
 * person asked for, and this is the one failure a large grandmaster set can hit
 * on a slow connection. Everything else already arrives as an `ApiError` whose
 * message is the API's own, which is what should be shown verbatim.
 */
function generateErrorMessage(err: unknown): string {
  if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return `Building the cart link took longer than ${GENERATE_TIMEOUT_MS / 1000}s — try again, or pick a narrower goal.`
  }
  return (err as Error).message
}

export function PurchaseSetMenu({ setId, pageGoal }: { setId: string; pageGoal: Goal }) {
  const [open, setOpen] = useState(false)
  const [goal, setGoal] = useState<Goal>(pageGoal)
  const [finishes, setFinishes] = useState<Set<FinishCode>>(new Set(FINISHES.map((f) => f.code)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SetMassEntry | null>(null)
  const [copied, setCopied] = useState(false)

  const allFinishes = finishes.size === FINISHES.length
  const reset = () => {
    setResult(null)
    setError(null)
    setCopied(false)
  }

  const generate = async () => {
    setBusy(true)
    reset()
    try {
      const scope: FinishCode[] | null = goal !== 'complete' && !allFinishes ? [...finishes] : null
      setResult(await api.setMassEntry(setId, goal, scope, AbortSignal.timeout(GENERATE_TIMEOUT_MS)))
    } catch (err) {
      setError(generateErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const copyText = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy — select the list below and copy manually.')
    }
  }

  return (
    <>
      <button
        onClick={() => {
          setGoal(pageGoal)
          reset()
          setOpen(true)
        }}
        className="flex h-[40px] items-center gap-[8px] rounded-lg bg-surface-tertiary px-[14px] text-[14px] font-bold text-text-primary hover:bg-action-default-hover"
      >
        <Icon name="cart" size={16} className="text-action-brand" /> Purchase Set
      </button>

      {open && (
        <Modal title="Purchase Set" onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-[16px]">
            <p className="text-[14px] leading-[19px] text-text-secondary">
              Builds a TCGplayer Mass Entry link that pre-fills a cart with every card you still need. Nothing is
              purchased until you check out on TCGplayer.
            </p>

            {/* goal */}
            <fieldset className="flex flex-col gap-[8px]" disabled={busy}>
              <legend className="mb-[6px] text-[14px] font-bold uppercase tracking-wide text-text-muted">
                Needed to finish
              </legend>
              {GOALS.map((g) => (
                <label key={g.key} className="flex cursor-pointer items-center gap-[10px] text-[14px] text-text-primary">
                  <input
                    type="radio"
                    name="massentry-goal"
                    checked={goal === g.key}
                    onChange={() => {
                      setGoal(g.key)
                      reset()
                    }}
                    className="h-[16px] w-[16px] accent-[var(--color-action-primary)]"
                  />
                  <span className="font-semibold">{g.label}</span>
                  <span className="text-[14px] text-text-muted">{g.blurb}</span>
                </label>
              ))}
            </fieldset>

            {/* finishes (variant scope) — only meaningful for master/grandmaster */}
            <fieldset className="flex flex-col gap-[8px]" disabled={busy || goal === 'complete'}>
              <legend className="mb-[6px] text-[14px] font-bold uppercase tracking-wide text-text-muted">
                Printings to include
              </legend>
              <div className={`flex flex-wrap gap-x-[16px] gap-y-[8px] ${goal === 'complete' ? 'opacity-40' : ''}`}>
                {FINISHES.map((f) => (
                  <label key={f.code} className="flex cursor-pointer items-center gap-[6px] text-[14px] text-text-primary">
                    <input
                      type="checkbox"
                      checked={finishes.has(f.code)}
                      onChange={(e) => {
                        const next = new Set(finishes)
                        if (e.target.checked) next.add(f.code)
                        else next.delete(f.code)
                        setFinishes(next)
                        reset()
                      }}
                      className="h-[15px] w-[15px] accent-[var(--color-action-primary)]"
                    />
                    {f.label}
                  </label>
                ))}
              </div>
              {goal === 'complete' && (
                <p className="text-[14px] text-text-muted">Any one printing completes a card, so all printings count.</p>
              )}
            </fieldset>

            <p className="rounded-lg bg-surface-tertiary px-[12px] py-[10px] text-[14px] leading-[17px] text-text-secondary">
              Card condition (NM, LP, …) and the exact printing per card can’t be preselected by link — pick them in
              the preferences panel on TCGplayer’s Mass Entry page after it opens.
            </p>

            <Button
              onClick={generate}
              disabled={goal !== 'complete' && finishes.size === 0}
              loading={busy}
              className="rounded-lg bg-action-primary-strong text-action-primary-strong-text hover:bg-action-primary-strong-hover"
            >
              <Icon name="cart" size={16} />
              {busy ? 'Building cart link…' : 'Generate cart link'}
            </Button>

            {error && <p className="text-[14px] text-error">{error}</p>}

            {result && (
              <div className="flex flex-col gap-[12px] border-t border-border-default pt-[14px]">
                {result.needed.cards === 0 ? (
                  <p className="text-[14px] text-text-primary">
                    Nothing needed — this goal is already finished. 🎉
                  </p>
                ) : (
                  <>
                    <p className="text-[14px] text-text-secondary">
                      <span className="font-semibold text-text-primary">
                        {result.needed.items} card{result.needed.items === 1 ? '' : 's'}
                      </span>{' '}
                      needed across {result.needed.cards} line{result.needed.cards === 1 ? '' : 's'}
                      {result.urls.length > 1 ? ` — split into ${result.urls.length} links (each adds to the same cart)` : ''}
                      .
                    </p>
                    <div className="flex flex-col gap-[8px]">
                      {result.urls.map((u, i) => (
                        <a
                          key={u}
                          href={u}
                          target="_blank"
                          rel="noreferrer"
                          className="flex h-[44px] items-center justify-center gap-[8px] rounded-lg bg-surface-tertiary text-[14px] font-bold text-text-primary hover:bg-action-default-hover"
                        >
                          <Icon name="external" size={15} className="text-action-brand" />
                          {result.urls.length > 1 ? `Open on TCGplayer — part ${i + 1} of ${result.urls.length}` : 'Open cart on TCGplayer'}
                        </a>
                      ))}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[14px] font-bold uppercase tracking-wide text-text-muted">
                        Mass Entry list (fallback)
                      </span>
                      <button
                        onClick={copyText}
                        className="flex items-center gap-[6px] text-[14px] font-semibold text-link hover:text-link-hover"
                      >
                        <Icon name={copied ? 'check' : 'copy'} size={14} /> {copied ? 'Copied' : 'Copy list'}
                      </button>
                    </div>
                    <textarea
                      readOnly
                      value={result.text}
                      rows={Math.min(6, result.lines.length)}
                      className="w-full resize-none rounded-lg border border-border-default bg-surface-primary p-[10px] font-mono text-[12px] leading-[17px] text-text-secondary"
                    />
                  </>
                )}
                {result.unlinkable.length > 0 && (
                  <div className="text-[12px] leading-[18px] text-text-muted">
                    <span className="font-semibold text-text-secondary">
                      Not on TCGplayer ({result.unlinkable.length}):
                    </span>{' '}
                    {result.unlinkable.map((u) => `${u.name} #${u.number}${u.variant ? ` (${u.variant})` : ''}`).join(', ')}
                  </div>
                )}
                {result.warnings
                  .filter((w) => !w.includes('no TCGplayer product')) // already rendered above
                  .map((w) => (
                    <p key={w} className="text-[12px] text-warning">
                      {w}
                    </p>
                  ))}
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}
