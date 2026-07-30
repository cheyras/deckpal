// Rendered-markdown view for deck strategy guides, styled to the design tokens.
// Default export so StrategyTab can React.lazy() it — react-markdown + remark-gfm
// (~40 KB gz) land in their own chunk and never touch the main bundle.

import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const components: Components = {
  h1: ({ children }) => <h1 className="mb-[10px] mt-[22px] text-[24px] font-bold leading-[30px] text-text-primary first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-[8px] mt-[20px] text-[19px] font-bold leading-[25px] text-text-primary first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-[6px] mt-[16px] text-[16px] font-bold leading-[22px] text-text-primary first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-[4px] mt-[14px] text-[14px] font-bold text-text-primary first:mt-0">{children}</h4>,
  p: ({ children }) => <p className="mb-[10px] text-[14px] leading-[22px] text-text-body last:mb-0">{children}</p>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-link hover:text-link-hover">
      {children}
    </a>
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
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border-default bg-surface-tertiary px-[10px] py-[6px] text-left font-bold text-text-primary">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border-default px-[10px] py-[6px] text-text-body">{children}</td>,
}

export default function MarkdownView({ markdown }: { markdown: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {markdown}
    </ReactMarkdown>
  )
}
