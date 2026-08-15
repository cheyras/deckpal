import { useState, type FormEvent } from 'react'
import { Modal } from './ListModals'
import { Icon } from './Icon'
import { Button } from './ui/Button'
import { api } from '../lib/api'

// In-app bug / feature-request reporter. Clicking the top-nav button opens the
// comment form *immediately* and captures a screenshot of the current view in
// the background, attaching it to the preview when ready. Submit POSTs the
// comment + kind ('bug' | 'feature') + page URL + screenshot to
// /deckpal/api/bugs, which — in self-host mode — persists them under the
// repo's issues/ dir for the `fix-issues` skill to work through (cloud mode
// files a labeled GitHub issue instead; see apps/api/src/routes/bugs.ts).
//
// Why open-first-capture-after: html2canvas walks and re-renders the whole
// document, which on heavy/virtualized layouts (table view, big grids) can reflow
// the live page ("rows get taller"), hang, or throw. Doing it *before* setOpen()
// meant a slow or failed capture would delay or entirely prevent the modal from
// appearing. Now the modal is never gated on the screenshot, and the open modal
// itself is excluded from the shot via `ignoreElements` (see below).

// ── Why the clone's images are inlined before the render walk ────────────────
//
// Card art is requested from a *same-origin* path (`/deckpal/images/...`).
// On cloud that path 302-redirects to a Supabase Storage object on a different
// origin, so the bytes that actually arrive are cross-origin. html2canvas only
// sets `crossOrigin="anonymous"` on URLs that *look* cross-origin
// (`useCORS && !isSameOrigin`), so it loads these with no CORS request at all,
// every card taints the render canvas, and `toDataURL()` throws
// `SecurityError: Tainted canvases may not be exported` — after a full,
// successful render. Setting `crossorigin` on the app's own <img> tags would
// not help: html2canvas builds its own Image objects from the URL.
//
// The fix that holds in both deployments and needs no knowledge of where the
// bytes come from: replace every image in the *cloned* document with a `data:`
// URL. An inline image is same-origin by definition and can never taint. The
// fetch is a normal CORS request, which the redirect target answers with
// `access-control-allow-origin: *`, and self-host serves the bytes directly.
// Anything that fails to inline is blanked rather than left in place — one
// tainted image would fail the whole export.
const INLINE_CONCURRENCY = 8
const INLINE_TIMEOUT_MS = 4000

/**
 * The read has to be on a URL the page has not already loaded. An <img> fetches
 * in `no-cors` mode, so by the time the reporter opens, every card URL has a
 * browser-cache entry (and a service-worker entry) that is not CORS-clean, and a
 * later `cors` request for that same URL fails outright — measured on the
 * deployed app: plain fetch, `cache: 'reload'` and `cache: 'no-store'` all throw
 * `TypeError: Failed to fetch`; only a distinct URL succeeds. `bugshot=1` is a
 * fixed marker rather than a random nonce so the CORS copy is itself cacheable
 * and a second report costs nothing, and so the service worker can recognise and
 * skip these reads instead of filling the LRU image cache with duplicates
 * (see src/sw.ts). Both image tiers ignore unknown query parameters.
 */
function corsReadUrl(src: string): string {
  return src + (src.includes('?') ? '&' : '?') + 'bugshot=1'
}

async function fetchAsDataUrl(src: string): Promise<string | null> {
  const ctl = new AbortController()
  const timer = window.setTimeout(() => ctl.abort(), INLINE_TIMEOUT_MS)
  try {
    const res = await fetch(corsReadUrl(src), { signal: ctl.signal, credentials: 'omit' })
    if (!res.ok) return null
    const blob = await res.blob()
    // An opaque response (service-worker cache hit on a no-cors entry) reads as
    // zero bytes — treat it as a miss rather than emitting a broken data URL.
    if (blob.size === 0) return null
    return await new Promise<string | null>((resolve) => {
      const fr = new FileReader()
      fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null)
      fr.onerror = () => resolve(null)
      fr.readAsDataURL(blob)
    })
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

async function inlineImages(doc: Document): Promise<void> {
  const imgs = Array.from(doc.querySelectorAll('img')).filter(
    (img) => img.src && !img.src.startsWith('data:'),
  )
  let next = 0
  const worker = async () => {
    for (let i = next++; i < imgs.length; i = next++) {
      const img = imgs[i]!
      const dataUrl = await fetchAsDataUrl(img.src)
      img.removeAttribute('srcset')
      if (dataUrl) {
        img.src = dataUrl
      } else {
        img.removeAttribute('src')
        img.style.visibility = 'hidden'
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(INLINE_CONCURRENCY, imgs.length) }, worker))
}

// Keep the POST body clear of the platform's request-size ceiling (Vercel caps a
// serverless function request at 4.5 MB; the API caps the decoded image at 8 MB).
// A viewport-sized JPEG is normally well under this, but a 4K/HiDPI viewport is
// not, and a 413 would lose the whole report, not just the picture.
const MAX_DATA_URL_CHARS = 3_000_000

function encodeBounded(canvas: HTMLCanvasElement): string | undefined {
  for (const quality of [0.85, 0.6, 0.4]) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    if (dataUrl.length <= MAX_DATA_URL_CHARS) return dataUrl
  }
  // Still too big: halve the pixels and re-encode once.
  const small = document.createElement('canvas')
  small.width = Math.max(1, Math.round(canvas.width / 2))
  small.height = Math.max(1, Math.round(canvas.height / 2))
  small.getContext('2d')?.drawImage(canvas, 0, 0, small.width, small.height)
  const dataUrl = small.toDataURL('image/jpeg', 0.6)
  return dataUrl.length <= MAX_DATA_URL_CHARS ? dataUrl : undefined
}

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

type ReportKind = 'bug' | 'feature'

const KIND_COPY: Record<ReportKind, { title: string; helper: string; placeholder: string }> = {
  bug: {
    title: 'Report a bug',
    helper:
      "Describe what looks wrong or isn't working. A screenshot of this page and the URL are attached automatically.",
    placeholder: 'What happened, and what did you expect instead?',
  },
  feature: {
    title: 'Request a feature',
    helper:
      "Describe what you'd like to see and why. A screenshot of this page and the URL are attached automatically for context.",
    placeholder: 'What would you like to see, and why?',
  },
}

export function BugButton() {
  const [open, setOpen] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [shot, setShot] = useState<string | undefined>(undefined)
  const [kind, setKind] = useState<ReportKind>('bug')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [issueUrl, setIssueUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Open the modal right away, then kick off the screenshot in the background.
  function begin() {
    setShot(undefined)
    setKind('bug')
    setText('')
    setSavedId(null)
    setIssueUrl(null)
    setError(null)
    setCapturing(true)
    setOpen(true)
    void capture()
  }

  async function capture() {
    let dataUrl: string | undefined
    try {
      // html2canvas-pro, not html2canvas. The original is unmaintained since
      // 1.4.1 (2022) and its colour parser predates CSS Color 4: it throws
      // `Attempting to parse an unsupported color function "oklab"` on the very
      // first element it walks, because Tailwind 4 compiles every `/opacity`
      // utility to `color-mix(in oklab, …)`, which the browser serialises as
      // `oklab(…)` at computed-value time. That threw inside this try, the
      // catch below swallowed it, and every report since the Tailwind 4 upgrade
      // went out with no screenshot (issue #17). The maintained fork parses
      // oklab/oklch/lab/lch/color() and is otherwise API-compatible.
      //
      // Lazy-loaded so it never touches the initial bundle — it's fetched only
      // the first time someone opens the bug reporter.
      const html2canvas = (await import('html2canvas-pro')).default
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
          onclone: inlineImages,
        }),
        // Generous, because inlineImages() now runs inside this window. The
        // modal is never gated on the capture, so the only thing this bounds is
        // how long the preview says "capturing".
        15000,
      )
      dataUrl = encodeBounded(canvas)
    } catch (err) {
      // Best-effort — the report still submits without a screenshot. But it is
      // logged, not swallowed: the silent catch is why issue #17 sat open with
      // "screenshot capture no longer works" and no way to see why.
      console.warn('[bug-report] screenshot capture failed:', err)
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
        kind,
      })
      setSavedId(r.id)
      if (r.issueUrl) setIssueUrl(r.issueUrl)
      // Longer timeout when there's a GitHub link so the user can click it.
      window.setTimeout(() => {
        setOpen(false)
        setShot(undefined)
      }, r.issueUrl ? 4000 : 1600)
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
        aria-label="Report a bug or feature request"
        title="Report a bug or feature request"
        className="flex h-[44px] w-[44px] items-center justify-center rounded-full bg-surface-tertiary text-icon-default hover:bg-action-default-hover hover:text-icon-hover disabled:opacity-60 nav:h-[42px]"
      >
        <Icon name="bug" size={20} />
      </button>

      {open && (
        <Modal
          title={KIND_COPY[kind].title}
          onClose={close}
          // Pinned, so Submit is reachable on a short screen and stays put when
          // the keyboard opens over the textarea. This modal is why: its panel
          // was 750px tall on a 667px phone, which put the actions off-screen.
          footer={
            savedId ? (
              <div className="flex justify-end">
                <Button onClick={close}>Done</Button>
              </div>
            ) : (
              <div className="flex justify-end gap-[10px]">
                <Button variant="secondary" onClick={close} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" form="bug-report-form" disabled={!text.trim()} loading={busy}>
                  {busy ? 'Saving…' : 'Submit'}
                </Button>
              </div>
            )
          }
        >
          {savedId ? (
            <div className="flex flex-col items-center gap-[10px] py-[24px] text-center">
              <span className="text-action-primary">
                <Icon name="check-circle" size={44} />
              </span>
              <p className="text-[15px] font-semibold text-text-primary">Thanks — your report was saved.</p>
              {issueUrl ? (
                <a
                  href={issueUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[14px] font-medium text-action-primary hover:underline"
                >
                  View it on GitHub
                </a>
              ) : (
                <p className="font-mono text-[14px] text-text-muted">issues/{savedId}/</p>
              )}
            </div>
          ) : (
            <form id="bug-report-form" onSubmit={submit} className="flex flex-col gap-[14px]">
              {/* Bug | Feature request toggle — same segmented-control idiom as the
                  Overview/Trends sub-toggle in Insights.tsx */}
              <div className="inline-flex self-start rounded-full bg-surface-tertiary p-[4px]">
                {(['bug', 'feature'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={[
                      'h-[32px] rounded-full px-[16px] text-[13px] font-semibold',
                      kind === k ? 'bg-action-primary text-action-primary-text' : 'text-text-muted hover:text-text-body',
                    ].join(' ')}
                  >
                    {k === 'bug' ? 'Bug' : 'Feature request'}
                  </button>
                ))}
              </div>
              <p className="text-[14px] leading-[19px] text-text-muted">{KIND_COPY[kind].helper}</p>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                data-autofocus
                rows={6}
                placeholder={KIND_COPY[kind].placeholder}
                className="w-full resize-y rounded-lg border border-border-default bg-surface-primary p-[12px] text-[15px] leading-[22px] text-text-primary placeholder:text-text-muted"
              />
              {capturing ? (
                <div className="flex items-center gap-[8px] rounded-lg border border-dashed border-border-default bg-surface-primary px-[12px] py-[16px] text-[14px] text-text-muted">
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
                  <figcaption className="bg-surface-tertiary px-[10px] py-[6px] text-[14px] text-text-muted">
                    Attached screenshot · {window.location.pathname}
                  </figcaption>
                </figure>
              ) : (
                <p className="text-[14px] text-text-muted">
                  (Couldn't capture a screenshot — the report will be submitted without one.)
                </p>
              )}
              {error && <div className="text-[14px] text-error">{error}</div>}
            </form>
          )}
        </Modal>
      )}
    </>
  )
}
