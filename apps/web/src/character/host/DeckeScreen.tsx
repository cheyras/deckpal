/**
 * Drawing a screen Deck-E composed.
 *
 * The counterpart to `apps/api/src/decke/screens.ts`, and the place its
 * guarantee is cashed in: this is a `switch` over the nine known block kinds,
 * and an unrecognised one renders NOTHING. There is no path here where a string
 * from the model reaches `dangerouslySetInnerHTML`, a `style`, a `className`, a
 * `src` or an `href` — the model chose which components to use and what to put
 * in them, and this file decides what any of that looks like.
 *
 * That is why the palette is small and why it stays small. Every block added
 * here is a new thing the model can express; every prop added is a new thing to
 * be sure about.
 *
 * THE ONE PLACE THAT LOOKS LIKE AN EXCEPTION IS `cardGrid`, AND IT IS NOT ONE.
 * A grid draws real card art now, which means a `src` does eventually get set —
 * but never from anything the model wrote. The model supplies a catalog ID; the
 * app hands that id to its own catalog endpoint and uses the URLs that endpoint
 * returns. The model's string reaches `encodeURIComponent` in a path and stops
 * there. An id that resolves to nothing renders the id as text, which is what
 * this file did for every id before art was wired at all.
 *
 * `apps/web/src/character/host/__tests__/sourceSync.test.ts` is what keeps the
 * switch below and the server's `BLOCK_KINDS` from drifting apart, because
 * `deckpal-web` cannot import `deckpal-api` to share the type.
 */
import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { CardImage } from '../../components/CardImage'
import { artForIds } from '../decke/cardSource'
import type { CardArt } from '../decke/cardArt'

type Block = {
  kind: string
  text?: string
  cards?: string[]
  quantities?: number[]
  value?: string
  percent?: number
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
  editable?: boolean
  columns?: string[]
  rows?: string[][]
  left?: Block[]
  right?: Block[]
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

/**
 * `dense` is what a block knows about being inside a `group`'s column.
 *
 * It is not a styling hook the model can reach — nothing sets it but the group
 * case below. It exists because half the width of a chat panel at 390px is
 * about 150px, and a three-column card grid in there is six cards the reader
 * cannot identify. Two columns of recognisable art beats three of thumbnails.
 */
function Block({
  block: b,
  dense = false,
  onRemoveCard,
}: {
  block: Block
  dense?: boolean
  onRemoveCard?: (id: string) => void
}) {
  switch (b.kind) {
    case 'heading':
      return (
        <h4 className={`font-semibold text-text-primary ${dense ? 'text-[13px]' : 'text-[14px]'}`}>
          {b.text}
        </h4>
      )

    case 'text':
      return <p className="text-[14px] leading-[21px] text-text-body">{b.text}</p>

    case 'cardGrid':
      return <CardGrid block={b} dense={dense} onRemoveCard={onRemoveCard} />

    case 'statTile':
      return (
        <div className="rounded-xl bg-surface-primary px-[12px] py-[10px]">
          <div className="text-[12px] text-text-muted">{b.text}</div>
          <div
            className={`font-bold tabular-nums ${dense ? 'text-[17px]' : 'text-[20px]'} ${TONE[b.tone ?? 'neutral']}`}
          >
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

    case 'table': {
      // The first column is the row label and the rest are figures, which is
      // what "rows and columns of figures" means in practice — "Set / Owned /
      // Total". So column one is left-aligned prose and every other column is
      // right-aligned and tabular, and the model gets that for free by putting
      // the label first rather than by being asked to specify alignment. It has
      // no way to specify alignment, which is the point.
      const columns = b.columns ?? []
      return (
        <div className="flex flex-col gap-[6px]">
          {b.text ? <span className="text-[12px] text-text-muted">{b.text}</span> : null}
          <div className="-mx-[4px] overflow-x-auto px-[4px]">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  {columns.map((c, i) => (
                    <th
                      key={i}
                      scope="col"
                      className={`whitespace-nowrap border-b border-border-default px-[8px] py-[6px] text-[11px] font-semibold uppercase tracking-wide text-text-muted ${
                        i === 0 ? 'text-left' : 'text-right'
                      }`}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(b.rows ?? []).map((row, ri) => (
                  <tr key={ri} className="border-b border-border-default/40 last:border-0">
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className={`px-[8px] py-[6px] ${
                          ci === 0
                            ? 'text-left text-text-body'
                            : 'text-right font-medium tabular-nums text-text-primary'
                        }`}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )
    }

    case 'group':
      // TWO COLUMNS AT EVERY WIDTH, INCLUDING 390px. The temptation is to stack
      // them on a phone like every other two-column layout in this app, and it
      // is wrong here: a group is the block whose whole meaning is "these two
      // things, next to each other". Stacked, it is indistinguishable from four
      // blocks in a row, and the comparison the model was making is gone. So
      // the columns stay and the contents get `dense` instead.
      //
      // A group nested inside a group renders nothing. The server's schema
      // cannot express one, so this only fires for a block that arrived without
      // being validated — the same second-half-of-the-rule as `default` below.
      return dense ? null : (
        <div className="flex flex-col gap-[8px]">
          {b.text ? <span className="text-[12px] text-text-muted">{b.text}</span> : null}
          <div className="grid grid-cols-2 gap-[10px]">
            {(['left', 'right'] as const).map((side) => (
              <div key={side} className="flex min-w-0 flex-col gap-[8px]">
                {(b[side] ?? []).map((inner, i) => (
                  <Block key={i} block={inner} dense onRemoveCard={onRemoveCard} />
                ))}
              </div>
            ))}
          </div>
        </div>
      )

    default:
      // UNKNOWN KINDS RENDER NOTHING. The server drops them with a reason
      // before they get here; this is the second half of the same rule, so a
      // block that somehow arrives unvalidated still cannot draw anything.
      return null
  }
}

/**
 * A grid of the user's actual cards.
 *
 * WHAT THIS USED TO DO, AND WHY IT STOPPED. It rendered the raw catalog id in
 * monospace, with a note saying that was honest and could not become a way for a
 * model-supplied string to reach a `src`. That was the right call while Deck-E
 * had no data tools at all and every id in a grid was one he had invented. Now
 * that the ids come out of the catalog he just read, a grid of ids is a grid of
 * ids where the answer was a grid of cards.
 *
 * THE RESOLUTION IS THE SAFE HALF OF THE OLD ARGUMENT, KEPT. `artForIds` is the
 * character's one module that knows the catalog exists; it calls `GET /cards/:id`
 * and reads `images.low`/`images.high` off the RESPONSE. The model's string is
 * only ever a path segment, and the URLs that end up in `src` are the app's own.
 * There is no arrangement of characters a model can put in `cards` that becomes
 * a URL here — the worst it can do is name a card that does not exist.
 *
 * WHICH IS THE OTHER HALF. An id that does not resolve keeps the old rendering:
 * the id, in monospace, in the box. Not a broken image, not a silently dropped
 * slot — dropping would shift every later card into the wrong place, and a card
 * he named that the catalog does not have is a fact worth showing the reader.
 */
function CardGrid({
  block: b,
  dense,
  onRemoveCard,
}: {
  block: Block
  dense: boolean
  onRemoveCard?: (id: string) => void
}) {
  const ids = b.cards ?? []
  const art = useCardArt(ids)
  return (
    <div className="flex flex-col gap-[6px]">
      {b.text ? <span className="text-[12px] text-text-muted">{b.text}</span> : null}
      <ul className={`grid gap-[8px] ${dense ? 'grid-cols-2' : 'grid-cols-3 nav:grid-cols-4'}`}>
        {ids.map((id, i) => {
          // `undefined` is "still asking", `null` is "asked, and there is no
          // such card". They must look different or a slow network is
          // indistinguishable from a hallucinated card id.
          const found = art[id]
          return (
            <li key={`${id}-${i}`} className="relative">
              {found ? (
                <CardImage
                  low={found.front}
                  high={found.frontLarge ?? found.front}
                  alt={found.name ?? id}
                  radius={6}
                />
              ) : (
                <div
                  className="flex w-full items-center justify-center rounded-md bg-surface-primary p-[6px] text-center"
                  style={{ aspectRatio: '245 / 337' }}
                >
                  {found === null ? (
                    <span className="font-mono text-[10px] leading-[14px] break-words text-text-body">
                      {id}
                    </span>
                  ) : null}
                </div>
              )}
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
          )
        })}
      </ul>
    </div>
  )
}

/**
 * Catalog ids in, art out, keyed by id.
 *
 * NO ABORT SIGNAL, ON PURPOSE. `artForId` memoises the in-flight promise per id
 * and shares it with everything else in the character that wants that card —
 * the stash flight, the four card slots on his body. Cancelling on unmount would
 * settle that SHARED promise as a failure for whoever else was waiting on it, to
 * save one request for a card whose art is immutable and will be asked for
 * again. A `live` flag to skip the `setState` is the whole cleanup that is
 * actually needed.
 *
 * The dependency is the joined id list rather than the array, because a screen
 * re-renders on every chat tick and a fresh array literal each time would
 * re-fetch forever.
 */
function useCardArt(ids: string[]): Record<string, CardArt | null | undefined> {
  const [art, setArt] = useState<Record<string, CardArt | null>>({})
  const key = ids.join(',')
  useEffect(() => {
    if (!key) return
    const wanted = key.split(',')
    let live = true
    artForIds(wanted)
      .then((list) => {
        if (!live) return
        const next: Record<string, CardArt | null> = {}
        list.forEach((a, i) => {
          next[wanted[i]!] = a
        })
        setArt(next)
      })
      .catch(() => {
        // A panel that cannot draw art still draws the ids. There is no state of
        // this app where a decorative texture is worth a console full of red.
      })
    return () => {
      live = false
    }
  }, [key])
  return art
}
