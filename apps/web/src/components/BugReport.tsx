import { useState, type FormEvent } from 'react'
import { Modal } from './ListModals'
import { Icon } from './Icon'
import { api } from '../lib/api'

// In-app bug reporter. Clicking the top-nav button captures a screenshot of the
// current view *before* the modal opens (so the modal is never in the shot), then
// opens a comment form. Submit POSTs the comment + page URL + screenshot to
// /pokedex/api/bugs, which persists them under the repo's issues/ dir for the
// `fix-issues` skill to work through.
export function BugButton() {
  const [open, setOpen] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [shot, setShot] = useState<string | undefined>(undefined)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function begin() {
    setCapturing(true)
    let dataUrl: string | undefined
    try {
      // Lazy-loaded so html2canvas (~150 KB) never touches the initial bundle —
      // it's fetched only the first time someone opens the bug reporter.
      const html2canvas = (await import('html2canvas')).default
      const bg = getComputedStyle(document.body).backgroundColor || '#15181f'
      const canvas = await html2canvas(document.body, {
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
      })
      dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    } catch {
      /* screenshot is best-effort — the report still submits without one */
    }
    setShot(dataUrl)
    setText('')
    setSavedId(null)
    setError(null)
    setCapturing(false)
    setOpen(true)
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
        disabled={capturing}
        aria-label="Report a bug"
        title="Report a bug"
        className="flex h-[44px] w-[44px] items-center justify-center rounded-full bg-surface-tertiary text-icon-default hover:bg-action-default-hover hover:text-icon-hover disabled:opacity-60 nav:h-[42px]"
      >
        <Icon name="bug" size={20} className={capturing ? 'animate-pulse' : undefined} />
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
              {shot ? (
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
