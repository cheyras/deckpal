/**
 * Drawing a screen Deck-E composed.
 *
 * The counterpart to `apps/api/src/decke/screens.ts`, and the place its
 * guarantee is cashed in: this is a `switch` over seven known block kinds, and
 * an unrecognised one renders NOTHING. There is no path here where a string
 * from the model reaches `dangerouslySetInnerHTML`, a `style`, a `className`, a
 * `src` or an `href` — the model chose which components to use and what to put
 * in them, and this file decides what any of that looks like.
 *
 * That is why the palette is small and why it stays small. Every block added
 * here is a new thing the model can express; every prop added is a new thing to
 * be sure about.
 */
import { Icon } from '../../components/Icon'

type Block = {
  kind: string
  text?: string
  cards?: string[]
  quantities?: number[]
  value?: string
  percent?: number
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
  editable?: boolean
}

export type ScreenSpec = { title: string; blocks: Block[] }

/** Semantic tones, mapped to tokens the design system actually defines. */
const TONE: Record<string, string> = {
  neutral: 'text-text-primary',
  good: 'text-action-primary',
  warn: 'text-text-body',
  bad: 'text-error',
}

export function DeckeScreen({
  spec,
  onRemoveCard,
}: {
  spec: ScreenSpec
  /** Present only when a block asked to be editable — "that one's wrong". */
  onRemoveCard?: (cardId: string) => void
}) {
  return (
    <section
      aria-label={spec.title}
      className="flex flex-col gap-[12px] rounded-2xl border border-border-default bg-surface-secondary p-[14px]"
    >
      <h3 className="text-[15px] font-semibold text-text-primary">{spec.title}</h3>
      {spec.blocks.map((b, i) => (
        <Block key={i} block={b} onRemoveCard={onRemoveCard} />
      ))}
    </section>
  )
}

function Block({ block: b, onRemoveCard }: { block: Block; onRemoveCard?: (id: string) => void }) {
  switch (b.kind) {
    case 'heading':
      return <h4 className="text-[14px] font-semibold text-text-primary">{b.text}</h4>

    case 'text':
      return <p className="text-[14px] leading-[21px] text-text-body">{b.text}</p>

    case 'cardGrid':
      return (
        <ul className="grid grid-cols-3 gap-[8px] nav:grid-cols-4">
          {(b.cards ?? []).map((id, i) => (
            <li key={id} className="relative flex min-h-[64px] items-center justify-center rounded-lg bg-surface-primary p-[8px] text-center">
              {/* THE ID, NOT AN IMAGE, and deliberately for now: `CardImage`
                  takes resolved `low`/`high` URLs rather than a catalog id, so
                  drawing art here means a lookup per card. Rendering the id is
                  honest and cannot become a way for a model-supplied string to
                  reach a `src`. Wiring the real art is a follow-up that should
                  resolve through the catalog, never through the model. */}
              <span className="font-mono text-[11px] leading-[15px] text-text-body">{id}</span>
              {b.quantities?.[i] && b.quantities[i] > 1 ? (
                <span className="absolute bottom-[4px] right-[4px] rounded-full bg-surface-secondary px-[6px] text-[11px] font-bold text-text-primary">
                  ×{b.quantities[i]}
                </span>
              ) : null}
              {b.editable && onRemoveCard ? (
                <button
                  type="button"
                  aria-label={`Remove ${id}`}
                  onClick={() => onRemoveCard(id)}
                  className="absolute right-[2px] top-[2px] flex h-[22px] w-[22px] items-center justify-center rounded-full bg-surface-secondary text-icon-muted hover:text-icon-hover"
                >
                  <Icon name="close" size={12} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )

    case 'statTile':
      return (
        <div className="rounded-xl bg-surface-primary px-[12px] py-[10px]">
          <div className="text-[12px] text-text-muted">{b.text}</div>
          <div className={`text-[20px] font-bold tabular-nums ${TONE[b.tone ?? 'neutral']}`}>
            {b.value}
          </div>
        </div>
      )

    case 'progress': {
      const pct = Math.max(0, Math.min(100, b.percent ?? 0))
      return (
        <div className="flex flex-col gap-[6px]">
          {b.text ? <span className="text-[12px] text-text-muted">{b.text}</span> : null}
          <div
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-[8px] w-full overflow-hidden rounded-full bg-surface-primary"
          >
            <div className="h-full rounded-full bg-action-primary" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )
    }

    case 'status':
      return (
        <p className={`text-[13px] leading-[20px] ${TONE[b.tone ?? 'neutral']}`}>{b.text}</p>
      )

    case 'empty':
      return (
        <p className="py-[8px] text-center text-[13px] text-text-muted">{b.text}</p>
      )

    default:
      // UNKNOWN KINDS RENDER NOTHING. The server drops them with a reason
      // before they get here; this is the second half of the same rule, so a
      // block that somehow arrives unvalidated still cannot draw anything.
      return null
  }
}
