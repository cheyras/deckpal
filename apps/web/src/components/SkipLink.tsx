import type { MouseEvent } from 'react'

export function SkipLink() {
  function skipToContent(event: MouseEvent<HTMLAnchorElement>) {
    const main = document.getElementById('main')
    if (!main) return
    event.preventDefault()
    // Safari's default macOS keyboard setting skips links and buttons unless
    // they carry an explicit tab index. Give the first visible control one so
    // Tab from the focused landmark continues into content in either setting.
    const firstControl = Array.from(main.querySelectorAll<HTMLElement>(
      'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
    )).find((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')
    if (firstControl && !firstControl.hasAttribute('tabindex')) firstControl.tabIndex = 0
    main.focus({ preventScroll: true })
    main.scrollIntoView({ block: 'start' })
  }

  return (
    <a
      href="#main"
      // WebKit on macOS skips ordinary links in its default Tab sequence.
      tabIndex={0}
      onClick={skipToContent}
      className="skip-link sr-only focus:not-sr-only focus:fixed focus:left-[16px] focus:top-[72px] nav:focus:top-[16px] focus:z-(--z-modal) focus:rounded-full focus:px-[16px] focus:py-[10px] focus:text-[14px] focus:font-bold"
    >
      Skip to content
    </a>
  )
}
