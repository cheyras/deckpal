/**
 * Markdown for what Deck-E says — in BOTH places he says it.
 *
 * The transcript is the obvious one. The speech bubble is the one that gets
 * forgotten, and it is the one that matters more as this pass proceeds: the
 * wayfinding phase routes MORE of his text through the bubble, not less, so a
 * bubble that renders `**604 distinct cards**` with the asterisks intact is a
 * defect that grows.
 *
 * ── THE LAZY SPLIT ───────────────────────────────────────────────────────────
 *
 * `react-markdown` + `remark-gfm` are ~40 KB gzipped. `routes/deck/StrategyTab`
 * already proved the pattern here — a default-exported renderer behind
 * `React.lazy()` — and this is the same pattern, not a second one. The import
 * is at module scope so the chunk starts downloading the first time a
 * `ChatMarkdown` mounts, and never before.
 *
 * ── THE FALLBACK IS THE OLD BEHAVIOUR, DELIBERATELY ──────────────────────────
 *
 * While the chunk is in flight this renders the raw text with
 * `whitespace-pre-wrap`. That is exactly what `DeckeChat` and `DeckeBubble` do
 * today, which makes the worst case of this component "no worse than before"
 * rather than "a bubble that is briefly zero pixels tall". A bubble collapsing
 * to nothing and then reopening is a layout jump on a floating element that is
 * positioned by measurement — `DeckeBubble.place()` would place the empty one.
 *
 * ── SIZING IS THE CALLER'S ───────────────────────────────────────────────────
 *
 * Nothing here sets a base font size or colour. Block elements inherit from the
 * bubble they are in, so the transcript's 14px/21px and the speech bubble's
 * 13px/19px keep working without this component knowing about either. Only
 * elements that must differ from the body — headings, code, table cells — carry
 * their own size.
 */

import { Suspense, lazy, type JSX } from 'react'
import type { ChatMarkdownTone } from './ChatMarkdownBody'

const ChatMarkdownBody = lazy(() => import('./ChatMarkdownBody'))

export type { ChatMarkdownTone }

export function ChatMarkdown({ text, tone }: { text: string; tone: ChatMarkdownTone }): JSX.Element {
  return (
    // `min-w-0` so a wide table or a long code line can scroll inside its own
    // box instead of widening the flex column it sits in; `break-words` so an
    // unbroken 60-character card id cannot do the same.
    <div className="min-w-0 break-words">
      <Suspense fallback={<span className="whitespace-pre-wrap">{text}</span>}>
        <ChatMarkdownBody text={text} tone={tone} />
      </Suspense>
    </div>
  )
}
