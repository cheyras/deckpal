/**
 * Cards, as cards.
 *
 * Card results are prose today: he names four cards in a sentence and the
 * reader has to picture them. This is the row form the owner asked for — *"card
 * thumbnails in a row down with the names of the cards and the variant"* — and
 * it is deliberately a NEW LAYOUT OVER OLD PLUMBING. `CardImage` (fixed 245/337
 * box, so geometry is settled before a byte arrives, and a graceful failure that
 * leaves the tertiary box reading as the skeleton) and `cardSource.artForIds`
 * (which resolves ids against OUR catalog endpoint) are the proven pair the
 * `cardGrid` block already uses. Nothing about how a card id becomes a picture
 * is re-invented here.
 *
 * ── A KNOWN GAP. DO NOT PAPER OVER IT ────────────────────────────────────────
 *
 * **The image cannot yet distinguish printings.** `CardArt` has no variant field
 * and `artForIds()` does not resolve one — variant data exists only in the
 * rip/scan flow (`ripSession.ts`, via `api.card(cardId).variants`). So a Normal
 * and a Reverse Holo of the same card resolve to the SAME `cardId` and therefore
 * the SAME image, and this component will draw them identically.
 *
 * `variantName` is therefore taken as a prop and rendered as TEXT, which is
 * honest: the words are right even though the picture is generic. It is not
 * fetched here — a per-card variants request per row would be N requests to
 * decorate a chat message, and the fix belongs in the card-art pipeline where
 * every other consumer would get it too.
 *
 * ── PRESENTATIONAL ───────────────────────────────────────────────────────────
 *
 * No `onClick`, no navigation, no selection. C15's whole lesson is that a thing
 * which looks pressable and is not is worse than a thing that looks inert; these
 * rows look inert because they are.
 */

import { useEffect, useState, type JSX } from 'react'
import { CardImage } from '../../../components/CardImage'
import { artForIds } from '../../decke/cardSource'
import type { CardArt } from '../../decke/cardArt'
import { cardRowAnnounce, cardRowSubtitle, quantityLabel, type CardRowItem } from './cardRowText'

export type { CardRowItem }

/** Thumbnail width. 40px keeps a 12-card list scannable in one panel height. */
const THUMB = 40

export function CardRows({ items }: { items: CardRowItem[] }): JSX.Element {
  const art = useCardArt(items.map((i) => i.cardId))

  return (
    <ul className="flex flex-col gap-[6px]">
      {items.map((item, i) => {
        // `undefined` is "still asking", `null` is "asked, and there is no such
        // card". They must look different, or a slow network is
        // indistinguishable from an id the catalog has never heard of — the
        // same distinction `DeckeScreen`'s grid makes, for the same reason.
        const found = art[item.cardId]
        const subtitle = cardRowSubtitle(item)
        const qty = quantityLabel(item.quantity)
        return (
          <li
            key={`${item.cardId}-${i}`}
            className="flex items-center gap-[10px]"
            // The visible text is three fragments in three sizes; this is the
            // same facts in one sentence.
            aria-label={cardRowAnnounce(item)}
          >
            <div className="shrink-0" style={{ width: THUMB }} aria-hidden="true">
              {found ? (
                // `alt=""`: the name is right there as text. Alt text here would
                // make a screen reader say the card twice.
                <CardImage low={found.front} high={found.frontLarge ?? found.front} alt="" radius={4} />
              ) : (
                <div
                  className="flex w-full items-center justify-center overflow-hidden rounded-sm bg-surface-tertiary p-[2px] text-center"
                  style={{ aspectRatio: '245 / 337' }}
                >
                  {found === null ? (
                    <span className="font-mono text-[8px] leading-[10px] break-all text-text-muted">
                      {item.cardId}
                    </span>
                  ) : null}
                </div>
              )}
            </div>

            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] leading-[19px] text-text-primary">
                {item.name.trim() || item.cardId}
              </span>
              {subtitle ? (
                <span className="truncate text-[11px] leading-[16px] text-text-muted">{subtitle}</span>
              ) : null}
            </div>

            {qty ? (
              <span className="shrink-0 font-mono text-[12px] leading-[18px] tabular-nums text-text-secondary">
                {qty}
              </span>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Catalog ids in, art out, keyed by id.
 *
 * A COPY of the hook inside `DeckeScreen.tsx`, and copied on purpose: that one
 * is a module-private function in a file this component may not edit. Lifting it
 * into a shared module is the right cleanup and it is a change to `DeckeScreen`,
 * so it belongs to whoever owns that file.
 *
 * The two things that make the original correct are preserved verbatim, because
 * both are load-bearing and neither is obvious:
 *
 *  - NO ABORT SIGNAL. `artForId` memoises the in-flight promise per id and
 *    shares it with everything else in the character that wants that card.
 *    Cancelling on unmount would settle that SHARED promise as a failure for
 *    whoever else was waiting on it, to save one request for a card whose art is
 *    immutable. A `live` flag to skip the `setState` is the whole cleanup that
 *    is actually needed.
 *  - The dependency is the JOINED id list, not the array. A chat transcript
 *    re-renders on every streamed token, and a fresh array literal each time
 *    would re-fetch forever.
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
        // A row that cannot draw art still draws the name. There is no state of
        // this app where a decorative texture is worth a console full of red.
      })
    return () => {
      live = false
    }
  }, [key])
  return art
}
