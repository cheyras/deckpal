// Rendered-markdown view for deck strategy guides, styled to the design tokens.
// Default export so StrategyTab can React.lazy() it — react-markdown + remark-gfm
// (~40 KB gz) land in their own chunk and never touch the main bundle.
//
// THIS RENDERS MODEL OUTPUT, which is not obvious from the file and is the
// whole reason for the two guards below. `strategyMd` is written by Deck-E's
// own `deck_strategy` tool, over a context that includes card text, deck
// descriptions and list names — strings other people typed and strings that
// arrived from an upstream catalog. Every one of them is attacker-influenceable,
// so "the model would not write that" is not a control. The renderer is.
//
// It had two holes, both of them the library's defaults doing exactly what they
// document:
//
//   1. `![](https://attacker.example/p.gif)` in a strategy guide rendered a real
//      remote `<img>` — a tracking beacon that fires on render and leaks the
//      reader's IP and referrer to whoever got a string into the model's
//      context. There was no `img` in the component map, so the default applied.
//   2. `defaultUrlTransform` permits `irc:`, `ircs:` and `xmpp:`, which hand a
//      URL to an external protocol handler and have no business here.
//
// Both are closed by `lib/markdownSafety.ts`, shared with the chat renderer so
// the two cannot drift. Read that file's reasoning before loosening either.

import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { chatUrlTransform } from '../../lib/markdownSafety'

const components: Components = {
  h1: ({ children }) => <h1 className="mb-[10px] mt-[22px] text-[24px] font-bold leading-[30px] text-text-primary first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-[8px] mt-[20px] text-[19px] font-bold leading-[25px] text-text-primary first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-[6px] mt-[16px] text-[16px] font-bold leading-[22px] text-text-primary first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-[4px] mt-[14px] text-[14px] font-bold text-text-primary first:mt-0">{children}</h4>,
  p: ({ children }) => <p className="mb-[10px] text-[14px] leading-[22px] text-text-body last:mb-0">{children}</p>,
  a: ({ href, children }) => (
    // `noopener` as well as `noreferrer`. They are not synonyms — `noreferrer`
    // implies it in modern browsers, but stating it is what makes the intent
    // survive somebody later deciding the referrer is harmless.
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-link hover:text-link-hover">
      {children}
    </a>
  ),
  // NEVER FETCHED. The alt text is shown instead, so the reader still sees that
  // the model tried to place an image and what it called it, and no URL the
  // model produced ever reaches a `src`.
  img: ({ alt }) => (
    <span className="text-[13px] italic text-text-muted">[image{alt ? `: ${alt}` : ''}]</span>
  ),
  ul: ({ children }) => <ul className="mb-[10px] flex list-disc flex-col gap-[3px] pl-[22px]">{children}</ul>,
  ol: ({ children }) => <ol className="mb-[10px] flex list-decimal flex-col gap-[3px] pl-[22px]">{children}</ol>,
  li: ({ children }) => <li className="text-[14px] leading-[21px] text-text-body">{children}</li>,
  strong: ({ children }) => <strong className="font-bold text-text-primary">{children}</strong>,
  code: ({ children }) => (
    <code className="rounded bg-surface-tertiary px-[5px] py-[1px] font-mono text-[12.5px] text-text-primary">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="mb-[12px] overflow-x-auto rounded-lg bg-surface-tertiary p-[12px] font-mono text-[12.5px] leading-[18px] text-text-primary [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-[10px] border-l-2 border-divider-subtle pl-[12px] text-text-secondary">{children}</blockquote>
  ),
  hr: () => <hr className="my-[16px] border-divider-subtle" />,
  table: ({ children }) => (
    <div className="scroll-x mb-[12px]">
      <table className="w-full border-collapse text-[14px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border-default bg-surface-tertiary px-[10px] py-[6px] text-left font-bold text-text-primary">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border-default px-[10px] py-[6px] text-text-body">{children}</td>,
}

// `compact`: the same map with headings stepped down, for markdown nested INSIDE
// a section that already has its own small heading (a battle log's review). A
// guide-sized 24px "## Turning point" there would outrank the page around it.
// Only the headings change, so every safety rule above applies unchanged.
const compactComponents: Components = {
  ...components,
  h1: ({ children }) => <h4 className="mb-[6px] mt-[14px] text-[16px] font-bold leading-[22px] text-text-primary first:mt-0">{children}</h4>,
  h2: ({ children }) => <h4 className="mb-[6px] mt-[14px] text-[15px] font-bold leading-[21px] text-text-primary first:mt-0">{children}</h4>,
  h3: ({ children }) => <h5 className="mb-[4px] mt-[12px] text-[14px] font-bold leading-[20px] text-text-primary first:mt-0">{children}</h5>,
  h4: ({ children }) => <h5 className="mb-[4px] mt-[12px] text-[14px] font-semibold text-text-primary first:mt-0">{children}</h5>,
}

export default function MarkdownView({ markdown, compact = false }: { markdown: string; compact?: boolean }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={compact ? compactComponents : components} urlTransform={chatUrlTransform}>
      {markdown}
    </ReactMarkdown>
  )
}
