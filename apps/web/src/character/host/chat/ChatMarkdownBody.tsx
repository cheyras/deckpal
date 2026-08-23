/**
 * The actual markdown renderer for Deck-E's two text surfaces.
 *
 * Default export ON PURPOSE, exactly like `routes/deck/MarkdownView.tsx`: it is
 * the shape `React.lazy()` wants, so `react-markdown` + `remark-gfm` (~40 KB gz)
 * land in their own chunk and never touch the main bundle. `ChatMarkdown.tsx` is
 * the wrapper that does the lazy import — nothing should import this file
 * directly, or the point of the split is lost.
 *
 * Two tones, one component map builder:
 *
 *   `bubble`     — a floating speech bubble over the page. Two sentences. No
 *                  heading is bigger than the body, margins are small, and
 *                  `remark-gfm` is deliberately NOT applied: a GFM table in a
 *                  280px bubble is a column of broken words, and the bubble is
 *                  not where a table belongs. A pipe table typed into a bubble
 *                  renders as its literal characters, which is the honest
 *                  outcome.
 *   `transcript` — the fuller treatment: real heading hierarchy, lists, GFM
 *                  tables, code blocks, links.
 *
 * The security posture (raw HTML, link protocols, images) lives in
 * `markdownSafety.ts` with its reasoning; read that file before changing
 * anything here.
 */

import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { chatUrlTransform } from '../../../lib/markdownSafety'

export type ChatMarkdownTone = 'bubble' | 'transcript'

/**
 * A link the model wrote.
 *
 * `chatUrlTransform` has already blanked anything outside the protocol
 * allowlist by the time this runs, so an empty `href` means "this was a URL we
 * refused". Rendering it as plain text rather than as `<a href="">` matters:
 * an anchor with no destination is a control that lies about being pressable,
 * which is the exact complaint (C15) this whole pass exists to fix.
 */
function Link({ href, children }: { href?: string; children?: React.ReactNode }) {
  if (!href) return <span className="text-text-body">{children}</span>
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-link hover:text-link-hover">
      {children}
    </a>
  )
}

/**
 * An image the model wrote. Never fetched. See `markdownSafety.ts` (3).
 *
 * The alt text is shown because dropping the node silently would hide from the
 * reader that the model tried to put a picture here.
 */
function ImagePlaceholder({ alt }: { alt?: string }) {
  return (
    <span className="italic text-text-muted">{alt ? `[image: ${alt}]` : '[image omitted]'}</span>
  )
}

function bubbleComponents(): Components {
  return {
    // Every heading collapses to bold body text. A bubble that contains an
    // <h1> is a bubble with a shout in it.
    h1: ({ children }) => <strong className="block text-text-primary">{children}</strong>,
    h2: ({ children }) => <strong className="block text-text-primary">{children}</strong>,
    h3: ({ children }) => <strong className="block text-text-primary">{children}</strong>,
    h4: ({ children }) => <strong className="block text-text-primary">{children}</strong>,
    h5: ({ children }) => <strong className="block text-text-primary">{children}</strong>,
    h6: ({ children }) => <strong className="block text-text-primary">{children}</strong>,
    p: ({ children }) => <p className="mb-[6px] last:mb-0">{children}</p>,
    a: ({ href, children }) => <Link href={href}>{children}</Link>,
    img: ({ alt }) => <ImagePlaceholder alt={alt} />,
    ul: ({ children }) => <ul className="mb-[6px] flex list-disc flex-col gap-[2px] pl-[18px] last:mb-0">{children}</ul>,
    ol: ({ children }) => <ol className="mb-[6px] flex list-decimal flex-col gap-[2px] pl-[18px] last:mb-0">{children}</ol>,
    li: ({ children }) => <li>{children}</li>,
    strong: ({ children }) => <strong className="font-bold text-text-primary">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    code: ({ children }) => (
      <code className="rounded-sm bg-surface-tertiary px-[4px] py-px font-mono text-[11px]">{children}</code>
    ),
    pre: ({ children }) => (
      <pre className="mb-[6px] overflow-x-auto rounded-md bg-surface-tertiary p-[8px] font-mono text-[11px] leading-[16px] last:mb-0 [&_code]:bg-transparent [&_code]:p-0">
        {children}
      </pre>
    ),
    blockquote: ({ children }) => (
      <blockquote className="mb-[6px] border-l-2 border-divider-subtle pl-[8px] text-text-secondary last:mb-0">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-[8px] border-divider-subtle" />,
  }
}

function transcriptComponents(): Components {
  return {
    // Deliberately flatter than MarkdownView's 24px h1: a chat turn is not a
    // document, and a 24px heading inside a 14px transcript reads as a second
    // page rather than as a section of an answer.
    h1: ({ children }) => (
      <h1 className="mb-[6px] mt-[14px] text-[17px] font-bold leading-[24px] text-text-primary first:mt-0">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="mb-[5px] mt-[12px] text-[15px] font-bold leading-[22px] text-text-primary first:mt-0">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="mb-[4px] mt-[10px] text-[14px] font-bold leading-[21px] text-text-primary first:mt-0">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="mb-[3px] mt-[10px] text-[13px] font-bold leading-[20px] text-text-primary first:mt-0">{children}</h4>
    ),
    h5: ({ children }) => <strong className="block text-text-primary">{children}</strong>,
    h6: ({ children }) => <strong className="block text-text-primary">{children}</strong>,
    p: ({ children }) => <p className="mb-[8px] last:mb-0">{children}</p>,
    a: ({ href, children }) => <Link href={href}>{children}</Link>,
    img: ({ alt }) => <ImagePlaceholder alt={alt} />,
    ul: ({ children }) => <ul className="mb-[8px] flex list-disc flex-col gap-[3px] pl-[20px] last:mb-0">{children}</ul>,
    ol: ({ children }) => <ol className="mb-[8px] flex list-decimal flex-col gap-[3px] pl-[20px] last:mb-0">{children}</ol>,
    li: ({ children }) => <li className="leading-[21px]">{children}</li>,
    strong: ({ children }) => <strong className="font-bold text-text-primary">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    code: ({ children }) => (
      <code className="rounded-sm bg-surface-tertiary px-[5px] py-px font-mono text-[12px] text-text-primary">
        {children}
      </code>
    ),
    pre: ({ children }) => (
      <pre className="mb-[10px] overflow-x-auto rounded-lg bg-surface-tertiary p-[10px] font-mono text-[12px] leading-[17px] text-text-primary last:mb-0 [&_code]:bg-transparent [&_code]:p-0">
        {children}
      </pre>
    ),
    blockquote: ({ children }) => (
      <blockquote className="mb-[8px] border-l-2 border-divider-subtle pl-[10px] text-text-secondary last:mb-0">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-[12px] border-divider-subtle" />,
    // The table scrolls inside its own box rather than widening the transcript:
    // the chat panel is a fixed column and a wide table must not be able to push
    // the composer sideways.
    table: ({ children }) => (
      <div className="mb-[10px] max-w-full overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border border-border-default bg-surface-tertiary px-[8px] py-[4px] text-left font-bold text-text-primary">
        {children}
      </th>
    ),
    td: ({ children }) => <td className="border border-border-default px-[8px] py-[4px]">{children}</td>,
  }
}

const BUBBLE = bubbleComponents()
const TRANSCRIPT = transcriptComponents()

export default function ChatMarkdownBody({ text, tone }: { text: string; tone: ChatMarkdownTone }) {
  const bubble = tone === 'bubble'
  return (
    <ReactMarkdown
      // GFM only in the transcript — see the header comment.
      remarkPlugins={bubble ? undefined : [remarkGfm]}
      components={bubble ? BUBBLE : TRANSCRIPT}
      // Stricter than the library default. `markdownSafety.ts` says why.
      urlTransform={chatUrlTransform}
    >
      {text}
    </ReactMarkdown>
  )
}
