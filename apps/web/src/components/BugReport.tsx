import { useState, type FormEvent } from 'react'
import { Modal } from './ListModals'
import { Icon } from './Icon'
import { api } from '../lib/api'

// In-app bug reporter. Clicking the top-nav button opens the comment form
// *immediately* and captures a screenshot of the current view in the background,
// attaching it to the preview when ready. Submit POSTs the comment + page URL +
// screenshot to /pokedex/api/bugs, which persists them under the repo's issues/
// dir for the `fix-issues` skill to work through.
//
// Why open-first-capture-after: html2canvas walks and re-renders the whole
// document, which on heavy/virtualized layouts (table view, big grids) can reflow
// the live page ("rows get taller"), hang, or throw. Doing it *before* setOpen()
// meant a slow or failed capture would delay or entirely prevent the modal from
// appearing. Now the modal is never gated on the screenshot, and the open modal
// itself is excluded from the shot via `ignoreElements` (see below).

// Reject a promise if it hasn't settled within `ms`, so a wedged capture can
// never keep the preview stuck in the "capturing" state.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error('screenshot timed out')), ms)
    p.then(
      (v) => {
        window.clearTimeout(t)
        resolve(v)
      },
      (e) => {
        window.clearTimeout(t)
        reject(e)
      },
    )
  })
}

export function BugButton() {
  const [open, setOpen] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [shot, setShot] = useState<string | undefined>(undefined)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Open the modal right away, then kick off the screenshot in the background.
  function begin() {
    setShot(undefined)
    setText('')
    setSavedId(null)
    setError(null)
    setCapturing(true)
    setOpen(true)
    void capture()
  }

  async function capture() {
    let dataUrl: string | undefined
    try {
      // Lazy-loaded so html2canvas (~150 KB) never touches the initial bundle —
      // it's fetched only the first time someone opens the bug reporter.
      const html2canvas = (await import('html2canvas')).default
      const bg = getComputedStyle(document.body).backgroundColor || '#15181f'
      // Wait for the just-opened modal to actually paint so `ignoreElements` can
      // find and skip it (two frames: one for React commit, one for paint).
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      const canvas = await withTimeout(
        html2canvas(document.body, {
          logging: false,
          useCORS: true,
          scale: 1,
          backgroundColor: bg,
          x: window.scrollX,
          y: window.scrollY,
          width: window.innerWidth,
          height: window.innerHeight,
          windowWidth: document.documentElement.scrollWidth,
          windowHeight: document.documentElement.scrollHeight,
          // Exclude the bug-report modal (already open) and its scrim from the
          // shot — both the dialog itself and any dev overlays we've tagged.
          ignoreElements: (el) =>
            el.getAttribute?.('role') === 'dialog' ||
            el.getAttribute?.('aria-modal') === 'true' ||
            el.hasAttribute?.('data-bug-capture-ignore'),
        }),
        6000,
      )
      dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    } catch {
      /* screenshot is best-effort — the report still submits without one */
      dataUrl = undefined
    }
    setShot(dataUrl)
    setCapturing(false)
  }

  function close() {
    if (busy) return
    setOpen(false)
    setShot(undefined)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const body = text.trim()
    if (!body) return
    setBusy(true)
    setError(null)
    try {
      const r = await api.submitBug({
        text: body,
        page: window.location.pathname + window.location.search,
        screenshot: shot,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        userAgent: navigator.userAgent,
      })
      setSavedId(r.id)
      window.setTimeout(() => {
        setOpen(false)
        setShot(undefined)
      }, 1600)
    } catch (err) {
      setError((err as Error).message || 'Could not save the report.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        onClick={begin}
        aria-label="Report a bug"
        title="Report a bug"
        className="flex h-[44px] w-[44px] items-center justify-center rounded-full bg-surface-tertiary text-icon-default hover:bg-action-default-hover hover:text-icon-hover disabled:opacity-60 nav:h-[42px]"
      >
        <Icon name="bug" size={20} />
      </button>

      {open && (
        <Modal title="Report a bug" onClose={close}>
          {savedId ? (
            <div className="flex flex-col items-center gap-[10px] py-[24px] text-center">
              <span className="text-action-primary">
                <Icon name="check-circle" size={44} />
              </span>
              <p className="text-[15px] font-semibold text-text-primary">Thanks — your report was saved.</p>
              <p className="font-mono text-[12px] text-text-muted">issues/{savedId}/</p>
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-[14px]">
              <p className="text-[13px] leading-[19px] text-text-muted">
                Describe what looks wrong or isn't working. A screenshot of this page and the URL are attached
                automatically.
              </p>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoFocus
                rows={6}
                placeholder="What happened, and what did you expect instead?"
                className="w-full resize-y rounded-lg border border-border-default bg-surface-primary p-[12px] text-[15px] leading-[22px] text-text-primary placeholder:text-text-muted"
              />
              {capturing ? (
                <div className="flex items-center gap-[8px] rounded-lg border border-dashed border-border-default bg-surface-primary px-[12px] py-[16px] text-[12px] text-text-muted">
                  <Icon name="bug" size={16} className="animate-pulse" />
                  Capturing a screenshot of this page…
                </div>
              ) : shot ? (
                <figure className="overflow-hidden rounded-lg border border-border-default">
                  <img
                    src={shot}
                    alt="Screenshot of the current page that will be attached"
                    className="block max-h-[220px] w-full object-cover object-top"
                  />
                  <figcaption className="bg-surface-tertiary px-[10px] py-[6px] text-[11px] text-text-muted">
                    Attached screenshot · {window.location.pathname}
                  </figcaption>
                </figure>
              ) : (
                <p className="text-[12px] text-text-muted">
                  (Couldn't capture a screenshot — the report will be submitted without one.)
                </p>
              )}
              {error && <div className="text-[13px] text-error">{error}</div>}
              <div className="flex justify-end gap-[10px]">
                <button
                  type="button"
                  onClick={close}
                  disabled={busy}
                  className="h-[44px] rounded-full bg-surface-tertiary px-[20px] text-[14px] font-semibold text-text-primary hover:bg-action-default-hover disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy || !text.trim()}
                  className="h-[44px] rounded-full bg-action-primary px-[24px] text-[14px] font-bold text-action-primary-text hover:bg-action-primary-hover disabled:opacity-50"
                >
                  {busy ? 'Saving…' : 'Submit'}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </>
  )
}
