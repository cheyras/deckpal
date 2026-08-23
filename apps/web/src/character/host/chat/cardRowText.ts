/**
 * The words on a card row, separated from the pixels so they can be tested.
 *
 * Small, but not trivial: every field except `cardId` and `name` is optional,
 * and the difference between "Base Set · Reverse Holo", "Base Set", "Reverse
 * Holo" and "" is four different renderings of the same component.
 */

export type CardRowItem = {
  cardId: string
  name: string
  setName?: string
  variantName?: string
  quantity?: number
}

/** `"Base Set · Reverse Holo"`, or as much of it as we were given. */
export function cardRowSubtitle(item: {
  setName?: string
  variantName?: string
}): string {
  return [item.setName, item.variantName]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' · ')
}

/**
 * `"×3"`, or `''` for one copy.
 *
 * Matches `DeckeScreen`'s `cardGrid`, which shows a count only above one. A row
 * per card already says "one of these"; a `×1` on every row is noise that makes
 * the rows that DO carry a count harder to spot.
 */
export function quantityLabel(quantity?: number): string {
  return typeof quantity === 'number' && quantity > 1 ? `×${quantity}` : ''
}

/**
 * One sentence per row for assistive tech.
 *
 * The visible row is three fragments in three type sizes; read aloud in order
 * that is "Charizard Base Set Reverse Holo 3", which is a shopping list with no
 * grammar. This is the same facts as a sentence.
 */
export function cardRowAnnounce(item: CardRowItem): string {
  const subtitle = cardRowSubtitle(item)
  const qty = typeof item.quantity === 'number' && item.quantity > 1 ? `, ${item.quantity} copies` : ''
  const name = item.name.trim() || item.cardId
  return subtitle ? `${name} — ${subtitle}${qty}` : `${name}${qty}`
}
